// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Ensure uploads folder exists
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Simple storage files
const KEYS_FILE = path.join(__dirname, "keys.json");      // product -> list of keys
const ORDERS_FILE = path.join(__dirname, "orders.json");  // stores pending & delivered orders

// create orders file if not exists
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify({ pending: [], delivered: {} }, null, 2));
if (!fs.existsSync(KEYS_FILE)) {
  // fallback sample keys if not exist — you can replace with your own keys
  const sample = {
    "key_1day": { id: "key_1day", name: "1 Day", price: 5.0, keys: ["1D-AAAA-0001","1D-AAAA-0002","1D-AAAA-0003"] },
    "key_3day": { id: "key_3day", name: "3 Day", price: 10.0, keys: ["3D-BBBB-1001","3D-BBBB-1002"] },
    "key_lifetime": { id: "key_lifetime", name: "Lifetime", price: 25.0, keys: ["LIFE-CCCC-9001"] }
  };
  fs.writeFileSync(KEYS_FILE, JSON.stringify(sample, null, 2));
}

// helper read/write JSON
function readJSON(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJSON(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

// Multer for file uploads (proof)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.floor(Math.random()*9000)}${ext}`);
  }
});
const upload = multer({ storage });

// Nodemailer transporter (Gmail App Password)
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
if (!EMAIL_USER || !EMAIL_PASS) {
  console.error("Please set EMAIL_USER and EMAIL_PASS in .env (App Password).");
  process.exit(1);
}
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// ---------- Public API ----------

// GET products (with stock)
app.get("/api/products", (req, res) => {
  const data = readJSON(KEYS_FILE);
  // convert to array with stock count
  const arr = Object.values(data).map(p => ({ id: p.id, name: p.name, price: p.price, stock: (p.keys || []).length }));
  res.json({ ok: true, products: arr });
});

// POST buy: multipart (proof optional) -> create pending order
app.post("/api/buy", upload.single("proof"), (req, res) => {
  try {
    const { productId, qty = 1, email, name } = req.body;
    if (!productId || !email) return res.status(400).json({ ok: false, message: "productId and email required" });

    const keysData = readJSON(KEYS_FILE);
    if (!keysData[productId]) return res.status(400).json({ ok: false, message: "Invalid productId" });

    const totalQty = Number(qty);
    if (totalQty <= 0) return res.status(400).json({ ok: false, message: "Qty must be >= 1" });

    const orderId = `ORD-${Date.now()}-${Math.floor(Math.random()*900+100)}`;
    const proofPath = req.file ? `/uploads/${req.file.filename}` : null;

    const orders = readJSON(ORDERS_FILE);
    const order = {
      orderId,
      productId,
      qty: totalQty,
      name: name || "",
      email,
      total: (keysData[productId].price || 0) * totalQty,
      proofPath,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    orders.pending.unshift(order);
    writeJSON(ORDERS_FILE, orders);

    return res.json({ ok: true, orderId, message: "Order created (pending). Please wait admin verification." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ---------- Admin API (demo, no auth) ----------

// List pending orders
app.get("/api/admin/pending", (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  res.json({ ok: true, pending: orders.pending });
});

// Verify order: allocate keys and send email
app.post("/api/admin/verify", (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ ok: false, message: "orderId required" });

    const orders = readJSON(ORDERS_FILE);
    const idx = orders.pending.findIndex(o => o.orderId === orderId);
    if (idx === -1) return res.status(404).json({ ok: false, message: "Order not found" });

    const order = orders.pending[idx];
    const keysData = readJSON(KEYS_FILE);

    const product = keysData[order.productId];
    if (!product) return res.status(400).json({ ok: false, message: "Product not found" });

    if ((product.keys || []).length < order.qty) return res.status(400).json({ ok: false, message: "Not enough stock" });

    // allocate keys (pop from front)
    const assigned = [];
    for (let i=0;i<order.qty;i++) assigned.push(product.keys.shift());

    // commit updated keys and orders (simple file write)
    keysData[order.productId] = product;
    writeJSON(KEYS_FILE, keysData);

    // move order to delivered
    orders.pending.splice(idx,1);
    orders.delivered[orderId] = {
      ...order,
      assigned: assigned.map(k => ({ key: k, productName: product.name })),
      status: "delivered",
      deliveredAt: new Date().toISOString()
    };
    writeJSON(ORDERS_FILE, orders);

    // send email with keys
    const keyListText = assigned.map(k => `- ${k}`).join("\n");
    const htmlList = assigned.map(k => `<li><code>${k}</code></li>`).join("");
    const mailOptions = {
      from: `"Key Store" <${EMAIL_USER}>`,
      to: order.email,
      subject: `Kunci untuk order ${orderId}`,
      text: `Terima kasih, berikut kunci untuk order ${orderId}:\n${keyListText}\n\nJangan bagikan kunci ini.`,
      html: `<p>Terima kasih, berikut kunci untuk order <b>${orderId}</b>:</p><ul>${htmlList}</ul><p>Jangan bagikan kunci ini.</p>`
    };

    transporter.sendMail(mailOptions)
      .then(() => {
        console.log(`Email sent to ${order.email} for ${orderId}`);
      })
      .catch(err => {
        console.error("Failed to send email:", err);
      });

    return res.json({ ok: true, orderId, assigned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

// Simple endpoint to view delivered orders (for admin)
app.get("/api/admin/delivered", (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  res.json({ ok: true, delivered: orders.delivered });
});

// Cancel order: remove from pending and add to canceled (admin)
app.post("/api/admin/cancel", (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ ok: false, message: "orderId required" });

    const orders = readJSON(ORDERS_FILE);
    const idx = (orders.pending || []).findIndex(o => o.orderId === orderId);
    if (idx === -1) return res.status(404).json({ ok: false, message: "Order not found" });

    const order = orders.pending.splice(idx, 1)[0];
    orders.canceled = orders.canceled || [];
    orders.canceled.push({ ...order, status: 'canceled', canceledAt: new Date().toISOString() });
    writeJSON(ORDERS_FILE, orders);

    return res.json({ ok: true, orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

// Serve uploaded images
app.use("/uploads", express.static(UPLOADS_DIR));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
