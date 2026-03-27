require('dotenv').config();
const express = require('express');
const cors = require("cors");
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const winston = require('winston');   // ✅ structured logger
const { tatkalMomentISO, formatLocal, safeParseJSON } = require('./util');
const { scheduleJobs, writeICS } = require('./reminders');
const { sendWhatsApp } = require('./whatsapp');
const { sendTelegram } = require('./telegram');


const PORT = process.env.PORT || 4567;
const TZ = process.env.TZ || 'Asia/Kolkata';
const DATA_FILE = path.join(__dirname, '..', 'data', 'entries.json');
const CAL_FILE = path.join(__dirname, '..', 'calendars', 'tatkal-events.ics');

// Ensure directories exist
const dataDir = path.dirname(DATA_FILE);
const calDir = path.dirname(CAL_FILE);

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(calDir)) fs.mkdirSync(calDir, { recursive: true });

const app = express();
// Allow all origins (you can restrict to your frontend domain)
app.use(cors());
// middleware to parse JSON
app.use(express.json());

// (optional) parse URL encoded forms
app.use(express.urlencoded({ extended: true }));

/* ---------------- Logger Setup ---------------- */
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level}: ${message}`;
        })
    ),
    transports: [new winston.transports.Console()]
});

/* ---------------- Helpers ---------------- */
function loadDB() {
    if (!fs.existsSync(DATA_FILE)) return [];
    return safeParseJSON(fs.readFileSync(DATA_FILE, 'utf8'), []);
}
function saveDB(arr) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

function summarize(entry) {
    const names = entry.passengers.map(p => p.name).join(', ');
    return `Tatkal Request Saved:
Train: ${entry.train} ${entry.from}->${entry.to} ${entry.class}
Date: ${entry.date} (Tatkal ${entry.tatkalType})
Passengers: ${names}
T-10: ${formatLocal(entry.preOpen)}
T-0 : ${formatLocal(entry.t0)}
`;
}

// in-memory scheduled jobs index
const JOBS = new Map();

/* ---------------- Schedulers ---------------- */
function normalizeNotifications(entry) {
    const legacyRecipient = entry.whatsappTo || null;
    const notifications = entry.notifications && typeof entry.notifications === 'object'
        ? { whatsapp: entry.notifications.whatsapp || null, telegram: entry.notifications.telegram || null }
        : { whatsapp: null, telegram: null };

    // Backwards compatibility: older clients used "whatsappTo" for Telegram.
    if (!notifications.whatsapp && !notifications.telegram && legacyRecipient) {
        notifications.telegram = legacyRecipient;
    }

    return notifications;
}

async function notifyAll(notifications, message) {
    const tasks = [];
    if (notifications.whatsapp) tasks.push(sendWhatsApp(notifications.whatsapp, message));
    if (notifications.telegram) tasks.push(sendTelegram(notifications.telegram, message));
    if (tasks.length === 0) return { ok: false, reason: 'no-recipients' };
    await Promise.all(tasks);
    return { ok: true };
}

function scheduleForEntry(entry) {
    const now = DateTime.now().setZone(TZ);
    const t0 = tatkalMomentISO(entry.date, entry.tatkalType, TZ);
    const preOpen = t0.minus({ minutes: 10 });

    const enriched = { ...entry, now, t0, preOpen };
    const notifications = normalizeNotifications(entry);

    logger.info(`[SCHEDULER] Scheduling Tatkal job for Train=${entry.train} Date=${entry.date} Type=${entry.tatkalType}`);

    // schedule
    const jobs = scheduleJobs(
        enriched,
        async (e) => {
            const body = `T-10 min: ${e.train} ${e.from}->${e.to} ${e.class} on ${e.date}\nOpen IRCTC now.`;
            logger.info(`[NOTIFY] Sending T-10 alerts for Train=${e.train}`);
            await notifyAll(notifications, body);
        },
        async (e) => {
            const body = `T-0: Tatkal open for ${e.train} ${e.from}->${e.to} ${e.class} on ${e.date}. Proceed!`;
            logger.info(`[NOTIFY] Sending T-0 alerts for Train=${e.train}`);
            await notifyAll(notifications, body);
        }
    );

    JOBS.set(entry.id, jobs);
    return { ...enriched, jobs: Object.keys(jobs) };
}

/* ---------------- API Routes ---------------- */
app.post('/api/tatkal', async (req, res) => {
    const body = req.body || {};

    logger.debug(`[API] Received Tatkal booking request: ${JSON.stringify(body)}`);

    if (!body.date || !body.train || !body.from || !body.to || !body.class || !body.tatkalType || !Array.isArray(body.passengers)) {
        logger.warn(`[API] Missing fields in request`);
        return res.status(400).json({ ok: false, error: 'Missing required fields.' });
    }

    const db = loadDB();
    const id = 'T' + Date.now();
    const notifications = body.notifications && typeof body.notifications === 'object'
        ? {
            whatsapp: body.notifications.whatsapp || null,
            telegram: body.notifications.telegram || null
        }
        : { whatsapp: null, telegram: null };

    const entry = {
        id,
        date: body.date,
        train: body.train,
        from: body.from,
        to: body.to,
        class: body.class,
        tatkalType: body.tatkalType.toUpperCase(),
        passengers: body.passengers,
        whatsappTo: body.whatsappTo || null,
        notifications
    };
    db.push(entry);
    saveDB(db);

    logger.info(`[DB] Entry saved with id=${id}`);

    // schedule jobs + send immediate confirmation
    const enriched = scheduleForEntry(entry);
    const confirmMsg = summarize(enriched);
    await notifyAll(normalizeNotifications(entry), entry);

    // rewrite ICS for all
    const all = loadDB().map(e => {
        const t0 = tatkalMomentISO(e.date, e.tatkalType, TZ);
        return { ...e, t0 };
    });
    writeICS(all, CAL_FILE);
    logger.info(`[ICS] Calendar file updated with ${all.length} entries`);

    res.json({ ok: true, id, summary: confirmMsg });
});

app.get('/api/list', (req, res) => {
    const db = loadDB();
    logger.debug(`[API] Returning ${db.length} entries`);
    res.json({ ok: true, entries: db });
});

app.get('/api/health', (req, res) => {
    res.status(200).send('OK');
});

app.delete('/api/tatkal/:id', (req, res) => {
    const id = req.params.id;
    const db = loadDB();
    const idx = db.findIndex(x => x.id === id);
    if (idx === -1) {
        logger.warn(`[API] Delete failed. Entry not found: id=${id}`);
        return res.status(404).json({ ok: false, error: 'Not found' });
    }
    db.splice(idx, 1);
    saveDB(db);

    const jobs = JOBS.get(id);
    if (jobs) {
        jobs.pre && jobs.pre.cancel();
        jobs.t0 && jobs.t0.cancel();
        JOBS.delete(id);
    }
    logger.info(`[DB] Entry deleted id=${id}`);

    res.json({ ok: true });
});

/* ---------------- Serve UI ---------------- */
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => {
    logger.debug(`[UI] Serving index.html`);
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/* ---------------- Start Server ---------------- */
app.listen(PORT, () => {
    logger.info(`🚆 Tatkal Agent running on http://localhost:${PORT}`);
    logger.info(`Timezone: ${TZ}`);
    if (!process.env.TWILIO_ACCOUNT_SID) {
        // Just a warning, not critical if using Telegram
        logger.debug('Note: Twilio SID not found (using Telegram mainly).');
    }

    // Restore scheduled jobs from disk
    restoreScheduledJobs();
});

function restoreScheduledJobs() {
    const db = loadDB();
    const now = DateTime.now().setZone(TZ);
    let count = 0;

    db.forEach(entry => {
        // Only schedule if the booking time (T-0) is in the future
        // or if T-0 is past but we want to keep it in memory (though pointless for notifications)
        // Let's being loose: re-schedule everything. The scheduler handles "past" checks.

        // Actually, let's peek to avoid spamming logs for old entries
        const t0 = tatkalMomentISO(entry.date, entry.tatkalType, TZ);
        if (t0 > now.minus({ hours: 1 })) { // Keep if it's recent or future
            scheduleForEntry(entry);
            count++;
        }
    });

    logger.info(`[INIT] Restored ${count} active Tatkal reminders from disk.`);
}
