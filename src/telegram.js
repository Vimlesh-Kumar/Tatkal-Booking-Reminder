require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.warn('[TELEGRAM] Missing BOT_TOKEN or CHAT_ID');
}

const bot = new TelegramBot(token, { polling: false });

async function sendTelegram(message) {
  if (!token || !chatId) return { ok: false, reason: 'no-credentials' };
  try {
    const booking = formatBookingMessage(message);
    await bot.sendMessage(chatId, booking, { parse_mode: 'Markdown' });
    console.log('[TELEGRAM] Message sent');
    return { ok: true };
  } catch (err) {
    console.error('[TELEGRAM] Failed to send message:', err.message);
    return { ok: false, reason: err.message };
  }
}

function formatBookingMessage(data) {
  let msg = `🚆 *Tatkal Booking Request*\n\n`;
  msg += `📅 Date: *${data.date}*\n`;
  msg += `🚋 Train: *${data.train}*\n`;
  msg += `📍 From: *${data.from}* → To: *${data.to}*\n`;
  msg += `🎟️ Class: *${data.class}*\n`;
  msg += `⚡ Tatkal Type: *${data.tatkalType}*\n\n`;

  msg += `👥 *Passengers:*\n`;
  data.passengers.forEach((p, i) => {
    msg += `\n${i + 1}. *${p.name}* (${p.age}, ${p.gender})\n`;
    msg += `   Berth: ${p.berth || "-"}\n`;
    if (p.idType && p.idNumber) {
      msg += `   ID: ${p.idType} - ${p.idNumber}\n`;
    }
  });

  return msg;
}

module.exports = { sendTelegram };
