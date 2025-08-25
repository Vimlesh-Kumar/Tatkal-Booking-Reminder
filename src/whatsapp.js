require('dotenv').config();
const fetch = require('node-fetch');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

async function sendWhatsApp(to, body) {
  if (!token || !phoneNumberId) {
    console.warn('[WHATSAPP] Missing credentials; message not sent. Body:', body);
    return { ok: false, reason: 'no-credentials' };
  }
  if (!to) {
    console.warn('[WHATSAPP] No destination number provided.');
    return { ok: false, reason: 'no-destination' };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace('+', ''), // WhatsApp expects E.164 without +
          type: 'text',
          text: { body }
        })
      }
    );

    const data = await res.json();
    if (data.error) {
      console.error('[WHATSAPP] Send failed:', data.error);
      return { ok: false, reason: data.error.message };
    }
    return { ok: true, id: data.messages?.[0]?.id };
  } catch (err) {
    console.error('[WHATSAPP] Send failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendWhatsApp };
