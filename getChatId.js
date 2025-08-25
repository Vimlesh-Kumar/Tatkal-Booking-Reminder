require('dotenv').config();
const fetch = require('node-fetch');

const token = process.env.TELEGRAM_BOT_TOKEN; // your bot token

async function main() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));

    if (data.result && data.result.length > 0) {
      const chatId = data.result[0].message.chat.id;
      console.log("✅ Your TELEGRAM_CHAT_ID:", chatId);
    } else {
      console.log("⚠️ No messages yet. Send /start to your bot in Telegram and rerun.");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
