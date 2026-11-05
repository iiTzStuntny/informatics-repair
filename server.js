const express = require('express');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const ExcelJS = require('exceljs');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 🛡️ ตั้งค่าให้โฟลเดอร์ uploads เข้าถึงได้แบบสาธารณะและเพิ่ม Header ป้องกันหน้าดักของ Pinggy
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Pinggy-No-Screen', 'true'); // คำสั่งพิเศษบอก Pinggy ให้ข้ามหน้า Warning Page
  next();
}, express.static(path.join(__dirname, 'public', 'uploads')));

app.use(express.static('public'));

// -------------------------------------------------------------
// ตั้งค่า Multer สำหรับอัปโหลดและจัดเก็บไฟล์รูปภาพ
// -------------------------------------------------------------
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'repair-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // จำกัดขนาดไฟล์ไม่เกิน 5MB
});

// -------------------------------------------------------------
// LINE Messaging API Credentials
// -------------------------------------------------------------
const LINE_CHANNEL_ACCESS_TOKEN = 'dCYLwi197geGSkCJCK96ZTEvkXM+IFNqyhK4M17PVT6vIpJ+LaiJcVSmTREdVEOyEFQ6LHVWSbuaPhecEp5eIFW4MGd/ZInkxQdFkZhZuqkLdZ7KG3r3HPvEzV15SjlJfxlJBCtS6F8drr6ygMYXHQdB04t89/1O/w1cDnyilFU=';

const POND_USER_ID = 'U19a66f81e33232d58867641f1b2c926f';

const TARGET_LINE_IDS = {
  FACILITY: POND_USER_ID,       
  COMPUTER_LAB: POND_USER_ID,   
  NETWORK: POND_USER_ID        
};

const CATEGORY_NAMES = {
  FACILITY: 'อาคารและกายภาพ',
  COMPUTER_LAB: 'คอมพิวเตอร์และโปรแกรม (Lab)',
  NETWORK: 'ระบบเครือข่ายและอินเทอร์เน็ต'
};

let tickets = [
  {
    id: 'REQ-1001',
    reporterName: 'นริช ประดิษฐ์',
    reporterPhone: '0812345678',
    category: 'COMPUTER_LAB',
    categoryName: 'คอมพิวเตอร์และโปรแกรม (Lab)',
    location: 'ห้อง IF-4B01 ชั้น 4',
    description: 'เครื่องคอมพิวเตอร์เปิดไม่ติด จอภาพไม่แสดงผล',
    imageUrl: '',
    repairNote: 'เปลี่ยน RAM ใหม่ 1 ตัว ใช้งานได้ปกติ',
    lineUserId: POND_USER_ID,
    status: 'COMPLETED',
    createdAt: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
  }
];
let ticketAutoId = 1001;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// 1. API รับเรื่องแจ้งซ่อมใหม่จากฟอร์ม (ส่ง LINE Flex Message)
app.post('/api/tickets', upload.single('image'), async (req, res) => {
  const { reporterName, reporterPhone, category, location, description, lineUserId } = req.body;

  if (!reporterName || !category || !location || !description) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';

  const newTicket = {
    id: `REQ-${++ticketAutoId}`,
    reporterName,
    reporterPhone: reporterPhone || '-',
    category,
    categoryName: CATEGORY_NAMES[category] || category,
    location,
    description,
    imageUrl,
    repairNote: '',
    lineUserId: lineUserId || POND_USER_ID,
    status: 'PENDING',
    createdAt: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
  };

  tickets.push(newTicket);

  const targetLineId = TARGET_LINE_IDS[category];
  if (targetLineId) {
    await sendAdminFlexMessage(targetLineId, newTicket, req);
  }

  res.json({ success: true, ticketId: newTicket.id });
});

app.get('/api/tickets', (req, res) => res.json(tickets));

app.post('/api/tickets/update-status', async (req, res) => {
  const { ticketId, newStatus, repairNote } = req.body;
  const ticket = tickets.find(t => t.id === ticketId);

  if (!ticket) {
    return res.status(404).json({ success: false, message: 'ไม่พบรายการ' });
  }

  ticket.status = newStatus;
  if (repairNote !== undefined) ticket.repairNote = repairNote;
  ticket.updatedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  if (ticket.lineUserId && ticket.lineUserId !== 'WEB_USER') {
    await sendUserStatusUpdate(ticket.lineUserId, ticket, newStatus);
  }

  res.json({ success: true, message: `อัปเดตสถานะเรียบร้อยแล้ว` });
});

app.get('/api/admin/dashboard', (req, res) => {
  res.json({
    total: tickets.length,
    pending: tickets.filter(t => t.status === 'PENDING').length,
    inProgress: tickets.filter(t => t.status === 'IN_PROGRESS').length,
    completed: tickets.filter(t => t.status === 'COMPLETED').length,
    byCategory: {
      FACILITY: tickets.filter(t => t.category === 'FACILITY').length,
      COMPUTER_LAB: tickets.filter(t => t.category === 'COMPUTER_LAB').length,
      NETWORK: tickets.filter(t => t.category === 'NETWORK').length
    }
  });
});

app.get('/api/export-excel', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('รายการแจ้งซ่อม');

    worksheet.columns = [
      { header: 'รหัสใบแจ้งซ่อม', key: 'id', width: 16 },
      { header: 'วันที่แจ้ง', key: 'createdAt', width: 22 },
      { header: 'หมวดหมู่งานซ่อม', key: 'categoryName', width: 28 },
      { header: 'สถานที่/ห้อง', key: 'location', width: 20 },
      { header: 'รายละเอียดปัญหา', key: 'description', width: 35 },
      { header: 'ชื่อผู้แจ้ง', key: 'reporterName', width: 20 },
      { header: 'เบอร์โทรศัพท์', key: 'reporterPhone', width: 16 },
      { header: 'รูปภาพจุดชำรุด', key: 'image', width: 20 },
      { header: 'สถานะ', key: 'status', width: 15 },
      { header: 'หมายเหตุการซ่อม', key: 'repairNote', width: 35 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      const statusText = t.status === 'COMPLETED' ? 'เสร็จสิ้น' : (t.status === 'IN_PROGRESS' ? 'กำลังซ่อม' : 'รอดำเนินการ');
      const rowIndex = i + 2;

      const row = worksheet.addRow({
        id: t.id,
        createdAt: t.createdAt,
        categoryName: t.categoryName,
        location: t.location,
        description: t.description,
        reporterName: t.reporterName,
        reporterPhone: String(t.reporterPhone || '-'),
        image: '',
        status: statusText,
        repairNote: t.repairNote || '-'
      });

      row.alignment = { vertical: 'middle' };
      row.height = 65;

      const phoneCell = row.getCell('reporterPhone');
      phoneCell.value = String(t.reporterPhone || '-');
      phoneCell.numFmt = '@';

      if (t.imageUrl) {
        const imagePath = path.join(__dirname, 'public', t.imageUrl);
        if (fs.existsSync(imagePath)) {
          try {
            const ext = path.extname(imagePath).toLowerCase().replace('.', '');
            const imageId = workbook.addImage({
              filename: imagePath,
              extension: ext === 'png' ? 'png' : 'jpeg',
            });

            worksheet.addImage(imageId, {
              tl: { col: 7, row: rowIndex - 1 },
              ext: { width: 80, height: 60 },
              editAs: 'oneCell'
            });
          } catch (imgErr) {
            console.error('Image embedding error:', imgErr);
          }
        }
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Informatics_Repair_Report_${todayStr}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export Excel Error:', err);
    res.status(500).send('เกิดข้อผิดพลาดในการสร้างไฟล์ Excel');
  }
});

app.post('/api/webhook', async (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === 'postback') {
      const data = event.postback.data;
      const params = new URLSearchParams(data);

      const action = params.get('action');
      const ticketId = params.get('id');
      const newStatus = params.get('status');

      if (action === 'update' && ticketId && newStatus) {
        const ticket = tickets.find(t => t.id === ticketId);

        if (ticket) {
          if (ticket.status === 'COMPLETED' && newStatus !== 'COMPLETED') {
            await axios.post('https://api.line.me/v2/bot/message/reply', {
              replyToken: event.replyToken,
              messages: [{
                type: 'text',
                text: `⚠️ รายการ [${ticketId}] นี้ปิดงานเรียบร้อยแล้ว ไม่สามารถเปลี่ยนสถานะกลับได้ครับ`
              }]
            }, {
              headers: { 
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              }
            });
            return res.status(200).send('OK');
          }

          ticket.status = newStatus;
          ticket.updatedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

          const statusText = newStatus === 'COMPLETED' ? '✅ ปิดงาน (ซ่อมเสร็จสิ้น)' : '⏳ กำลังดำเนินการ';

          await axios.post('https://api.line.me/v2/bot/message/reply', {
            replyToken: event.replyToken,
            messages: [{
              type: 'text',
              text: `📌 อัปเดตสถานะรายการ [${ticketId}] เรียบร้อยแล้ว!\nสถานะใหม่: ${statusText}`
            }]
          }, {
            headers: { 
              'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          });

          console.log(`✅ อัปเดตสถานะผ่าน LINE Webhook สำเร็จ: ${ticketId} -> ${newStatus}`);
        }
      }
    }
  }

  res.status(200).send('OK');
});

async function sendAdminFlexMessage(targetLineId, ticket, req) {
  try {
    const bodyContents = [
      { type: "text", text: `หมวดหมู่: ${ticket.categoryName}`, weight: "bold", size: "sm", color: "#1e40af" },
      { type: "text", text: `📍 สถานที่: ${ticket.location}`, size: "sm", margin: "sm" },
      { type: "text", text: `📝 รายละเอียด: ${ticket.description}`, size: "sm", color: "#4b5563", margin: "sm", wrap: true },
      { type: "separator", margin: "md" },
      { type: "text", text: `👤 ผู้แจ้ง: ${ticket.reporterName} (${ticket.reporterPhone})`, size: "xs", color: "#6b7280", margin: "md" }
    ];

    const flexBubble = {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0b2545",
        contents: [
          { type: "text", text: "🔔 มีรายการแจ้งซ่อมใหม่", weight: "bold", color: "#ffffff", size: "md" },
          { type: "text", text: `รหัส: ${ticket.id}`, color: "#93c5fd", size: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#16a34a",
            action: {
              type: "postback",
              label: "✅ กดเพื่อปิดงาน (ซ่อมเสร็จสิ้น)",
              data: `action=update&id=${ticket.id}&status=COMPLETED`
            }
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "⏳ กำลังดำเนินการ",
              data: `action=update&id=${ticket.id}&status=IN_PROGRESS`
            }
          }
        ]
      }
    };

    if (ticket.imageUrl && req) {
      const host = req.get('host');
      const fullImageUrl = `https://${host}${ticket.imageUrl}`;

      flexBubble.hero = {
        type: "image",
        url: fullImageUrl,
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      };
    }

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: targetLineId,
      messages: [{
        type: "flex",
        altText: `🚨 แจ้งซ่อมใหม่ [${ticket.id}]: ${ticket.categoryName}`,
        contents: flexBubble
      }]
    }, {
      headers: { 
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ ส่งแจ้งเตือน LINE สำเร็จไปยัง: ${targetLineId}`);
  } catch (err) {
    console.error('❌ ส่ง LINE Flex Message ไม่สำเร็จ:', err.response ? err.response.data : err.message);
  }
}

async function sendUserStatusUpdate(userLineId, ticket, status) {
  try {
    const statusText = status === 'COMPLETED' ? '✅ ซ่อมเสร็จสิ้นแล้ว' : '⏳ กำลังดำเนินการ';
    const noteText = ticket.repairNote ? `\nหมายเหตุช่าง: ${ticket.repairNote}` : '';

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userLineId,
      messages: [{
        type: "text",
        text: `📢 อัปเดตสถานะงานแจ้งซ่อม [${ticket.id}]\nสถานที่: ${ticket.location}\nสถานะปัจจุบัน: ${statusText}${noteText}`
      }]
    }, {
      headers: { 
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✅ ส่งอัปเดตสถานะกลับหาผู้แจ้งสำเร็จ`);
  } catch (err) {
    console.error('❌ ไม่สามารถส่งข้อความกลับทาง LINE ได้:', err.response ? err.response.data : err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Informatics Maintenance System running on http://localhost:${PORT}`));