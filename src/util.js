const { DateTime } = require('luxon');

function tatkalMomentISO(dateISO, tatkalType, zone = 'Asia/Kolkata') {
  // AC -> 10:00 IST, NONAC -> 11:00 IST
  const hour = (tatkalType || '').toUpperCase() === 'AC' ? 10 : 11;
  return DateTime.fromISO(dateISO, { zone }).set({ hour, minute: 0, second: 0, millisecond: 0 });
}
function formatLocal(dt) {
  return dt.toFormat('dd LLL yyyy • HH:mm:ss ZZZZ');
}
function safeParseJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
module.exports = { tatkalMomentISO, formatLocal, safeParseJSON };