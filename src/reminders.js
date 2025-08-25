const schedule = require('node-schedule');
const notifier = require('node-notifier');
const path = require('path');
const fs = require('fs');
const { createEvents } = require('ics');
const { formatLocal } = require('./util');

function localNotify(title, message) {
  try { notifier.notify({ title, message }); } catch {}
}

function scheduleJobs(entry, onPreOpen, onT0) {
  // entry has: id, t0 (luxon DateTime), preOpen (luxon)
  const jobs = {};

  if (entry.preOpen && entry.preOpen > entry.now) {
    jobs.pre = schedule.scheduleJob(entry.preOpen.toJSDate(), () => {
      localNotify('Tatkal Reminder (T-10)', `Train ${entry.train} ${entry.from}->${entry.to} ${entry.class}`);
      onPreOpen && onPreOpen(entry);
    });
  }
  if (entry.t0 && entry.t0 > entry.now) {
    jobs.t0 = schedule.scheduleJob(entry.t0.toJSDate(), () => {
      localNotify('Tatkal NOW', `Window open for Train ${entry.train} ${entry.from}->${entry.to} ${entry.class}`);
      onT0 && onT0(entry);
    });
  }
  return jobs;
}

function writeICS(entries, outFile) {
  const events = entries.map(e => {
    const pre = e.t0.minus({ minutes: 10 });
    const toArr = [e.t0.year, e.t0.month, e.t0.day, e.t0.hour, e.t0.minute];
    const preArr = [pre.year, pre.month, pre.day, pre.hour, pre.minute];
    return [
      {
        start: preArr,
        duration: { minutes: 5 },
        title: `Tatkal T-10: ${e.train} ${e.from}->${e.to} (${e.class})`,
        description: 'Prepare to book. Open IRCTC manually.',
        location: 'IRCTC',
        status: 'CONFIRMED'
      },
      {
        start: toArr,
        duration: { minutes: 5 },
        title: `Tatkal T-0: ${e.train} ${e.from}->${e.to} (${e.class})`,
        description: 'Tatkal window opens. Proceed manually.',
        location: 'IRCTC',
        status: 'CONFIRMED'
      }
    ];
  }).flat();

  const { error, value } = createEvents(events);
  if (!error) {
    fs.writeFileSync(outFile, value);
    return true;
  }
  return false;
}

module.exports = { scheduleJobs, writeICS, localNotify };