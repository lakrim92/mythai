require('dotenv').config();

['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SITE_URL', 'TABLETTE_PASSWORD', 'ADMIN_PASSWORD'].forEach(k => {
  if (!process.env[k]) { console.error(`❌ Variable d'env requise : ${k}`); process.exit(1); }
});

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const https      = require('https');
const net        = require('net');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3006;

// ── Security headers ──────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com; " +
    "style-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://cdnjs.cloudflare.com 'unsafe-inline'; " +
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; " +
    "connect-src 'self' https://api.stripe.com; " +
    "frame-src https://checkout.stripe.com; " +
    "img-src 'self' data: https:;"
  );
  next();
});

const ORDERS_FILE        = path.join(__dirname, 'orders.json');
const PENDING_ITEMS_FILE = path.join(__dirname, 'pending_items.json');
const PROMO_USED_FILE    = path.join(__dirname, 'promo_used.json');

// ── Delivery zones (CP autorisés) ─────────────────────────
const DELIVERY_ZONES = new Set([
  '78380', // Bougival
  '78230', // Le Pecq
  '78430', // Louveciennes
  '78170', // La Celle-Saint-Cloud
  '78290', // Croissy-sur-Seine
  '78400', // Chatou
  '78160', // Marly-le-Roi
  '92500', // Rueil-Malmaison
  '92210', // Saint-Cloud
]);
const DELIVERY_FEE = 2.50; // €

// ── Mutex (atomic file read-modify-write) ─────────────────
class Mutex {
  constructor() { this._p = Promise.resolve(); }
  run(fn) {
    const next = this._p.then(() => fn());
    this._p = next.then(() => {}, () => {});
    return next;
  }
}
const fileMutex = new Mutex();

// ── Timing-safe string compare ────────────────────────────
function timingSafeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── Rate limiter ──────────────────────────────────────────
const _rlStore = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let slot = _rlStore.get(key);
    if (!slot || now > slot.resetAt) { slot = { count: 0, resetAt: now + windowMs }; _rlStore.set(key, slot); }
    if (++slot.count > max) return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); _rlStore.forEach((v, k) => { if (now > v.resetAt) _rlStore.delete(k); }); }, 60_000);

const rlAuth     = rateLimit(10, 60_000);
const rlCheckout = rateLimit(30, 60_000);

// ── Sessions ──────────────────────────────────────────────
const _sessions = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000;
function createSession(role) {
  const token = crypto.randomBytes(32).toString('hex');
  _sessions.set(token, { role, expiresAt: Date.now() + SESSION_TTL });
  return token;
}
setInterval(() => { const now = Date.now(); _sessions.forEach((v, k) => { if (now > v.expiresAt) _sessions.delete(k); }); }, 60 * 60 * 1000);

// ── Auth middleware ────────────────────────────────────────
function tabletteAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  const session = _sessions.get(token);
  if (!session || Date.now() > session.expiresAt) return res.status(401).json({ error: 'Session expirée' });
  next();
}

// ── Cache mémoire ─────────────────────────────────────────
let _ordersCache       = [];
let _promoUsedCache    = [];
let _pendingItemsCache = {};

// ── Promo première commande ───────────────────────────────
function loadPromoUsed()  { return _promoUsedCache; }
function markPromoUsed(email) {
  const n = email.trim().toLowerCase();
  if (!_promoUsedCache.includes(n)) {
    _promoUsedCache.push(n);
    fs.writeFile(PROMO_USED_FILE, JSON.stringify(_promoUsedCache), err => { if (err) console.error('promo_used write:', err.message); });
  }
}
function isPromoEligible(email) {
  const n = email.trim().toLowerCase();
  if (_promoUsedCache.includes(n)) return false;
  return !_ordersCache.some(o => (o.customerEmail || '').toLowerCase() === n);
}

let _promoCouponId = process.env.PROMO_COUPON_ID || null;
async function getPromoCouponId() {
  if (_promoCouponId) return _promoCouponId;
  const coupon = await stripe.coupons.create({ percent_off: 10, duration: 'once', name: 'Première commande -10%' });
  _promoCouponId = coupon.id;
  console.log(`✅ Coupon créé : ${coupon.id} — ajoutez PROMO_COUPON_ID=${coupon.id} dans .env`);
  return _promoCouponId;
}

// ── Persistance commandes ─────────────────────────────────
function loadOrders()       { return _ordersCache; }
function saveOrders(orders) {
  _ordersCache = orders;
  fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), err => { if (err) console.error('orders write:', err.message); });
}

function loadPendingItems() { return _pendingItemsCache; }
function savePendingItem(sessionId, items) {
  _pendingItemsCache[sessionId] = items;
  fs.writeFile(PENDING_ITEMS_FILE, JSON.stringify(_pendingItemsCache), err => { if (err) console.error('pending_items write:', err.message); });
}
function popPendingItem(sessionId) {
  const items = _pendingItemsCache[sessionId];
  if (items) {
    delete _pendingItemsCache[sessionId];
    fs.writeFile(PENDING_ITEMS_FILE, JSON.stringify(_pendingItemsCache), err => { if (err) console.error('pending_items write:', err.message); });
  }
  return items || null;
}

// ── Impression ESC/POS (Epson TM-m30) ────────────────────
const ESC = 0x1B, GS = 0x1D;
const PR = {
  INIT:    Buffer.from([ESC, 0x40]),
  CP:      Buffer.from([ESC, 0x74, 0x02]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:Buffer.from([ESC, 0x45, 0x00]),
  CTR:     Buffer.from([ESC, 0x61, 0x01]),
  LEFT:    Buffer.from([ESC, 0x61, 0x00]),
  BIG:     Buffer.from([GS,  0x21, 0x11]),
  NRM:     Buffer.from([GS,  0x21, 0x00]),
  FEED:    Buffer.from([ESC, 0x64, 0x04]),
  CUT:     Buffer.from([GS,  0x56, 0x42, 0x00]),
};
function prTxt(s) {
  const map = {'é':0x82,'è':0x8A,'ê':0x88,'ë':0x89,'à':0x85,'â':0x83,'ù':0xA4,'û':0x96,'ô':0x93,'î':0x8C,'ï':0x8B,'ç':0x87,'É':0x90,'È':0xD4,'À':0xB7,'Ç':0x80};
  const out = [];
  for (const ch of String(s||'')) {
    if (map[ch]!==undefined) out.push(map[ch]);
    else if (ch.charCodeAt(0)<0x80) out.push(ch.charCodeAt(0));
  }
  return Buffer.from(out);
}
function prLine(s) { return Buffer.concat([prTxt(s), Buffer.from([0x0A])]); }
function printOrder(order) {
  const host = process.env.PRINTER_HOST;
  const port = parseInt(process.env.PRINTER_PORT||'9100');
  if (!host) return;
  const d = order.delivery||{};
  const now = new Date(order.createdAt);
  const orderNum = String(order.orderNumber).slice(-6);
  const isLiv = d.mode==='livraison';
  const name = `${d.firstname||''} ${d.lastname||''}`.trim();
  const sep = '--------------------------------';
  const chunks = [
    PR.INIT, PR.CP, PR.CTR, PR.BOLD_ON, PR.BIG,
    prLine('MY THAI'),
    PR.NRM, PR.BOLD_OFF,
    prLine(`${now.toLocaleDateString('fr-FR')}  ${now.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`),
    prLine(`Commande #${orderNum}`),
    PR.LEFT, prLine(sep), PR.BOLD_ON,
    prLine(isLiv ? '>>> LIVRAISON <<<' : '>>> A EMPORTER <<<'),
    PR.BOLD_OFF,
  ];
  if (name) chunks.push(prLine(`Client : ${name}`));
  if (d.phone) chunks.push(prLine(`Tel    : ${d.phone}`));
  if (isLiv) {
    const addr = [d.address,d.zip,d.city].filter(Boolean).join(' ');
    if (addr) chunks.push(prLine(`Adresse: ${addr}`));
    if (d.floor) chunks.push(prLine(`Etage  : ${d.floor}`));
    if (d.appt) chunks.push(prLine(`Apt    : ${d.appt}`));
    if (d.code) chunks.push(prLine(`Code   : ${d.code}`));
  }
  chunks.push(prLine(sep));
  (order.items||[]).forEach(item => {
    const price = `${(item.price||0).toFixed(2)}EUR`;
    const label = `${item.qty||1}x ${item.name}`;
    const pad = Math.max(1, 32 - label.length - price.length);
    chunks.push(PR.BOLD_ON, prTxt(label+' '.repeat(pad)+price), Buffer.from([0x0A]), PR.BOLD_OFF);
    if (item.notes) chunks.push(prLine(`  Note: ${item.notes}`));
  });
  chunks.push(prLine(sep));
  chunks.push(PR.BOLD_ON, prLine(`TOTAL  : ${(order.total||0).toFixed(2)} EUR`), PR.BOLD_OFF);
  if (order.promoApplied) chunks.push(prLine('Promo -10% appliquee !'));
  if (d.instructions) chunks.push(prLine(''), prLine(`Note: ${d.instructions}`));
  if (isLiv) chunks.push(prLine(''), PR.BOLD_ON, prLine('+2.50 EUR LIVRAISON'), PR.BOLD_OFF);
  chunks.push(PR.FEED, PR.CUT);
  const socket = new net.Socket();
  socket.setTimeout(5000);
  socket.connect(port, host, () => { socket.write(Buffer.concat(chunks), () => socket.destroy()); console.log(`🖨️  Ticket → ${host}:${port} #${orderNum}`); });
  socket.on('error', err => console.error(`Printer: ${err.message}`));
  socket.on('timeout', () => { socket.destroy(); });
}

// ── SSE (tablette) ────────────────────────────────────────
const sseClients = new Set();
function pushSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => res.write(payload));
}

// ── Email ──────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT||'587'),
  secure: process.env.SMTP_SECURE==='true',
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_HOST||!process.env.SMTP_USER) return;
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM||`"My Thai Street Food" <${process.env.SMTP_USER}>`, to, subject, html });
    console.log(`📧 Email → ${to}`);
  } catch (err) { console.error('Email:', err.message); }
}

// ── Escape HTML ────────────────────────────────────────────
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Bloc marque email ─────────────────────────────────────
function emailBrandBlock() {
  return `<div style="text-align:center;padding:22px 20px 16px;background:#0d0d0d;border-bottom:3px solid #C8390B">
  <div style="font-family:Georgia,serif;line-height:1.1">
    <span style="font-size:2rem;font-weight:900;color:#ffffff;letter-spacing:2px">MY THAI</span>
    <br>
    <span style="font-size:.85rem;font-weight:400;color:#F5A623;letter-spacing:6px;text-transform:uppercase">Street Food</span>
  </div>
  <p style="margin:6px 0 0;font-size:.68rem;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:2px;font-family:Arial,sans-serif">Bougival · 78380</p>
</div>`;
}

// ── Traitement commande ────────────────────────────────────
async function processOrder(session) {
  const savedItems = popPendingItem(session.id);
  let items;
  if (savedItems) {
    items = savedItems;
  } else {
    const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 50 });
    items = li.data.map(i => ({ name: i.description, qty: i.quantity, price: i.amount_total/100 }));
  }
  let delivery = {};
  try { delivery = JSON.parse(session.metadata?.delivery||'{}'); } catch {}
  if (session.metadata?.promoEmail) markPromoUsed(session.metadata.promoEmail);

  const promoApplied = !!session.metadata?.promoEmail;
  const subtotal     = (session.amount_subtotal||session.amount_total)/100;
  const discount     = promoApplied ? Math.round((subtotal - session.amount_total/100)*100)/100 : 0;
  const isLiv        = delivery.mode === 'livraison';

  const order = {
    id:            session.id,
    orderNumber:   Date.now(),
    createdAt:     new Date().toISOString(),
    status:        'nouveau',
    customerEmail: session.customer_details?.email||'',
    items,
    delivery,
    total:         session.amount_total/100,
    promoApplied,
    discount,
  };

  let skipped = false;
  await fileMutex.run(() => {
    const orders = loadOrders();
    if (orders.find(o => o.id===session.id)) { skipped=true; return; }
    orders.unshift(order);
    saveOrders(orders);
  });
  if (skipped) { console.log(`⚠️  Doublon ${session.id}`); return; }

  pushSSE('new-order', order);

  const itemsHtml = items.filter(i => i.name !== 'Frais de livraison').map(i => {
    const price = typeof i.price==='number' ? i.price.toFixed(2) : '—';
    const notes = i.notes ? `<br><span style="color:#555;font-size:.82em">${escHtml(i.notes)}</span>` : '';
    return `<tr><td style="padding:5px 0">${i.qty||1}× <strong>${escHtml(i.name)}</strong>${notes}</td><td align="right" style="vertical-align:top;padding-top:5px">${price}€</td></tr>`;
  }).join('');

  const addrLine = isLiv ? [delivery.address, delivery.zip, delivery.city].filter(Boolean).join(' ') : '';
  const modeLabel = isLiv ? 'Livraison' : 'À emporter';
  const prenom = delivery.firstname||'';

  // Email client
  console.log(`📧 Email client : ${order.customerEmail || '(aucun email)'}`);
  if (order.customerEmail) {
    await sendEmail(order.customerEmail, '🍜 Votre commande My Thai est confirmée !', `
      ${emailBrandBlock()}
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:#C8390B;padding:24px 32px">
          <h1 style="color:#fff;margin:0;font-size:1.5rem">🍜 Commande confirmée !</h1>
        </div>
        <div style="padding:28px 32px">
          <p style="margin-top:0">Bonjour <strong>${escHtml(prenom)}</strong>,</p>
          <p>Votre commande est bien enregistrée et en cours de préparation.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:.92rem">${itemsHtml}
            <tr><td colspan="2" style="padding:4px 0"><hr style="border:none;border-top:1px solid #eee"/></td></tr>
            ${isLiv ? `<tr><td style="color:#666">Frais de livraison</td><td align="right">2.50€</td></tr>` : ''}
            ${promoApplied ? `<tr><td style="color:#16a34a;font-size:.88rem">🎉 Réduction -10%</td><td align="right" style="color:#16a34a;font-size:.88rem">-${discount.toFixed(2)}€</td></tr>` : ''}
            <tr><td><strong>Total payé</strong></td><td align="right"><strong>${order.total.toFixed(2)}€</strong></td></tr>
          </table>
          <p><strong>Mode :</strong> ${modeLabel}${isLiv && addrLine ? ` — ${escHtml(addrLine)}` : ''}</p>
          <p style="color:#666;font-size:.88rem">⏱ Temps estimé : ~30 minutes</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
          <p style="color:#999;font-size:.8rem;margin:0">My Thai Street Food — 30 Av. Jean-Moulin, 78380 Bougival</p>
        </div>
      </div>`);
  }

  // Email admin
  console.log(`📧 Email admin : ${process.env.ADMIN_EMAIL || '(ADMIN_EMAIL non défini)'}`);
  if (process.env.ADMIN_EMAIL) {
    await sendEmail(process.env.ADMIN_EMAIL,
      `🔔 Nouvelle commande${promoApplied?' 🎉 -10%':''} — ${escHtml(prenom)} ${escHtml(delivery.lastname||'')} — ${order.total.toFixed(2)}€`,
      `${emailBrandBlock()}
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
        <div style="background:#C8390B;padding:20px 28px"><h1 style="color:#fff;margin:0;font-size:1.3rem">🔔 Nouvelle commande</h1></div>
        <div style="padding:24px 28px">
          <table style="width:100%;font-size:.9rem;margin-bottom:16px">
            <tr><td style="color:#666;width:130px">Client</td><td><strong>${escHtml(prenom)} ${escHtml(delivery.lastname||'')}</strong></td></tr>
            <tr><td style="color:#666">Téléphone</td><td>${escHtml(delivery.phone||'—')}</td></tr>
            <tr><td style="color:#666">Mode</td><td><strong>${escHtml(modeLabel)}</strong></td></tr>
            ${isLiv && addrLine ? `<tr><td style="color:#666">Adresse</td><td>${escHtml(addrLine)}</td></tr>` : ''}
            ${delivery.floor ? `<tr><td style="color:#666">Étage/Apt</td><td>${escHtml(delivery.floor)}${delivery.appt?' — Apt '+escHtml(delivery.appt):''}</td></tr>` : ''}
            ${delivery.code ? `<tr><td style="color:#666">Code accès</td><td>${escHtml(delivery.code)}</td></tr>` : ''}
            ${delivery.instructions ? `<tr><td style="color:#666">Instructions</td><td>${escHtml(delivery.instructions)}</td></tr>` : ''}
          </table>
          <h3 style="margin-bottom:8px">Articles</h3>
          <table style="width:100%;border-collapse:collapse;font-size:.9rem">${itemsHtml}
            <tr><td colspan="2"><hr style="border:none;border-top:1px solid #eee"/></td></tr>
            ${isLiv ? `<tr><td>Livraison</td><td align="right">2.50€</td></tr>` : ''}
            ${promoApplied ? `<tr><td style="color:#16a34a">🎉 Promo -10%</td><td align="right" style="color:#16a34a">-${discount.toFixed(2)}€</td></tr>` : ''}
            <tr><td><strong>Total</strong></td><td align="right"><strong>${order.total.toFixed(2)}€</strong></td></tr>
          </table>
          <p style="color:#999;font-size:.78rem;margin-top:16px">Session : ${session.id}</p>
        </div>
      </div>`);
  }

  printOrder(order);
  console.log(`✅ Commande #${order.orderNumber} — ${order.total}€ (${modeLabel})`);
}

// ── Webhook Stripe ─────────────────────────────────────────
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook sig error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    try { await processOrder(event.data.object); } catch (err) { console.error('Webhook order error:', err.message); }
  }
  res.json({ received: true });
});

app.use(express.json());

// ── Confirmation après paiement ───────────────────────────
app.get('/api/confirm', rlCheckout, async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id manquant' });
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Paiement non complété' });
    await processOrder(session);
    res.json({ ok: true });
  } catch (err) {
    console.error('Confirm error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Horaires ──────────────────────────────────────────────
function isRestaurantOpen() {
  if (process.env.FORCE_OPEN === 'true') return true;
  const now = new Date();
  const day = now.getDay();
  const hm  = now.getHours()*60 + now.getMinutes();
  if (day === 1) return false; // lundi fermé
  return (hm >= 11*60 && hm < 15*60) ||
         (hm >= 18*60 && hm < 23*60);
}

// ── Vérif zone livraison ──────────────────────────────────
app.get('/api/check-delivery-zone', rlCheckout, (req, res) => {
  const cp = (req.query.zip||'').trim();
  res.json({ ok: DELIVERY_ZONES.has(cp), zones: [...DELIVERY_ZONES] });
});

// ── Vérif promo ───────────────────────────────────────────
app.get('/api/check-promo', rlCheckout, (req, res) => {
  const email = (req.query.email||'').trim();
  if (!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ eligible: false });
  res.json({ eligible: isPromoEligible(email) });
});

// ── Checkout Stripe ───────────────────────────────────────
app.post('/api/checkout', rlCheckout, async (req, res) => {
  try {
    const { items, delivery, applyPromo, promoEmail } = req.body;

    if (!items||!Array.isArray(items)||items.length===0)
      return res.status(400).json({ error: 'Panier vide' });

    for (const item of items) {
      if (typeof item.name!=='string'||!item.name.trim())
        return res.status(400).json({ error: 'Article invalide' });
      const price = parseFloat(item.price);
      if (isNaN(price)||price<0||(price>0&&price<2)||(price>200))
        return res.status(400).json({ error: 'Prix invalide' });
      const qty = parseInt(item.qty??1,10);
      if (!Number.isInteger(qty)||qty<1||qty>20)
        return res.status(400).json({ error: 'Quantité invalide' });
    }

    const isLiv = delivery?.mode === 'livraison';

    // Minimum commande
    const cartTotal = items.reduce((s,i) => s+parseFloat(i.price)*parseInt(i.qty||1,10), 0);
    const minOrder = isLiv ? 20 : 12;
    if (cartTotal < minOrder)
      return res.status(400).json({ error: `Minimum de commande : ${minOrder}€` });

    // Validation zone livraison
    if (isLiv) {
      const cp = (delivery?.zip||'').trim();
      if (!DELIVERY_ZONES.has(cp))
        return res.status(400).json({ error: `Zone de livraison non couverte (CP : ${cp}). Zones : ${[...DELIVERY_ZONES].join(', ')}` });
    }

    if (!isRestaurantOpen())
      return res.status(403).json({ error: 'Le restaurant est actuellement fermé.' });

    const line_items = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: { name: String(item.name).trim().slice(0,250) },
        unit_amount: Math.round(parseFloat(item.price)*100),
      },
      quantity: parseInt(item.qty||1,10),
    }));

    // Frais de livraison
    if (isLiv) {
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Frais de livraison' },
          unit_amount: Math.round(DELIVERY_FEE*100),
        },
        quantity: 1,
      });
    }

    // Promo -10%
    let promoApplied = false;
    if (applyPromo && promoEmail) {
      await fileMutex.run(() => {
        if (isPromoEligible(promoEmail)) { markPromoUsed(promoEmail); promoApplied=true; }
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.SITE_URL}/#commander`,
      locale: 'fr',
      ...(promoApplied ? { discounts: [{ coupon: await getPromoCouponId() }] } : {}),
      metadata: {
        source:     'site_mythai',
        delivery:   JSON.stringify(delivery||{}),
        promoEmail: promoApplied ? promoEmail.trim().toLowerCase() : '',
      },
    });

    savePendingItem(session.id, items);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Erreur paiement' });
  }
});

// ── SSE tablette ──────────────────────────────────────────
app.get('/api/orders/stream', tabletteAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  sseClients.add(res);
  res.write(`event: init\ndata: ${JSON.stringify(loadOrders())}\n\n`);
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(hb); } }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

app.get('/api/orders', tabletteAuth, (req, res) => res.json(loadOrders()));

app.post('/api/orders/:id/print', tabletteAuth, (req, res) => {
  const order = loadOrders().find(o => o.id===req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (!process.env.PRINTER_HOST) return res.status(503).json({ error: 'Imprimante non configurée' });
  printOrder(order);
  res.json({ ok: true });
});

app.patch('/api/orders/:id/status', tabletteAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const valid = ['nouveau','en_preparation','pret','livre'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  let order = null;
  await fileMutex.run(() => {
    const orders = loadOrders();
    order = orders.find(o => o.id===id);
    if (!order) return;
    order.status = status;
    saveOrders(orders);
  });
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  pushSSE('status-update', { id, status });
  res.json({ ok: true });

  // Emails statut client
  const prenom = escHtml(order.delivery?.firstname||'');
  const isLiv  = order.delivery?.mode==='livraison';
  const email  = order.customerEmail;
  if (!email) return;

  const emails = {
    en_preparation: {
      sub: '👨‍🍳 Votre commande My Thai est en préparation',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><div style="background:#C8390B;padding:20px 28px"><h1 style="color:#fff;margin:0;font-size:1.3rem">👨‍🍳 En préparation !</h1></div><div style="padding:24px 28px;background:#fff"><p>Bonjour <strong>${prenom}</strong>,</p><p>Votre commande est en cours de préparation. Nos chefs thaï s'affairent en cuisine 🍜</p><hr style="border:none;border-top:1px solid #eee;margin:16px 0"/><p style="color:#999;font-size:.8rem;margin:0">My Thai Street Food — 30 Av. Jean-Moulin, 78380 Bougival</p></div></div>`,
    },
    pret: isLiv ? {
      sub: '🛵 Votre commande My Thai est en route !',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><div style="background:#2563eb;padding:20px 28px"><h1 style="color:#fff;margin:0;font-size:1.3rem">🛵 En route !</h1></div><div style="padding:24px 28px;background:#fff"><p>Bonjour <strong>${prenom}</strong>,</p><p>Votre commande est prête et notre livreur est en route !</p><hr style="border:none;border-top:1px solid #eee;margin:16px 0"/><p style="color:#999;font-size:.8rem;margin:0">My Thai Street Food — 78380 Bougival</p></div></div>`,
    } : {
      sub: '✅ Votre commande My Thai est prête !',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><div style="background:#d97706;padding:20px 28px"><h1 style="color:#fff;margin:0;font-size:1.3rem">✅ Prête à retirer !</h1></div><div style="padding:24px 28px;background:#fff"><p>Bonjour <strong>${prenom}</strong>,</p><p>Votre commande est prête. Venez la récupérer !</p><p style="font-weight:700">📍 30 Av. Jean-Moulin, 78380 Bougival</p><hr style="border:none;border-top:1px solid #eee;margin:16px 0"/><p style="color:#999;font-size:.8rem;margin:0">My Thai Street Food</p></div></div>`,
    },
    livre: {
      sub: '🙏 Merci pour votre commande My Thai !',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto"><div style="background:#C8390B;padding:20px 28px"><h1 style="color:#fff;margin:0;font-size:1.3rem">🙏 Merci !</h1></div><div style="padding:24px 28px;background:#fff"><p>Bonjour <strong>${prenom}</strong>,</p><p>Nous espérons que votre commande vous a régalé ! 🍜</p><p>Toute l'équipe My Thai vous remercie et vous donne rendez-vous très bientôt.</p><p style="color:#666;font-size:.88rem">N'hésitez pas à nous laisser un avis — cela nous aide énormément 🌟</p><hr style="border:none;border-top:1px solid #eee;margin:16px 0"/><p style="color:#999;font-size:.8rem;margin:0">My Thai Street Food — 30 Av. Jean-Moulin, 78380 Bougival</p></div></div>`,
    },
  };
  const e = emails[status];
  if (e) sendEmail(email, e.sub, e.html).catch(err => console.error('Email statut:', err.message));
});

// ── Auth tablette ─────────────────────────────────────────
app.post('/api/auth/tablette', rlAuth, (req, res) => {
  const { password } = req.body;
  if (
    (process.env.TABLETTE_PASSWORD && timingSafeEquals(String(password||''), process.env.TABLETTE_PASSWORD)) ||
    (process.env.ADMIN_PASSWORD    && timingSafeEquals(String(password||''), process.env.ADMIN_PASSWORD))
  ) {
    res.json({ ok: true, token: createSession('tablette') });
  } else {
    res.json({ ok: false });
  }
});

// ── Auth admin ────────────────────────────────────────────
app.post('/api/auth/admin', rlAuth, (req, res) => {
  const { password } = req.body;
  const expected = process.env.ADMIN_PASSWORD || process.env.TABLETTE_PASSWORD;
  if (expected && timingSafeEquals(String(password || ''), expected)) {
    res.json({ ok: true, token: createSession('admin') });
  } else {
    res.json({ ok: false });
  }
});

app.get('/api/auth/verify', (req, res) => {
  const token = req.headers['x-admin-password'] || req.headers['x-session-token'];
  const s = token && _sessions.get(token);
  if (s && Date.now() < s.expiresAt) return res.json({ ok: true, role: s.role });
  res.status(401).json({ ok: false });
});

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-password'];
  const s = token && _sessions.get(token);
  if (s && Date.now() < s.expiresAt && s.role === 'admin') return next();
  res.status(401).json({ error: 'Non autorisé' });
}

// ── Stats admin ────────────────────────────────────────────
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const orders = loadOrders();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7);

  const todayOrders = orders.filter(o => o.createdAt.startsWith(todayStr));
  const monthOrders = orders.filter(o => o.createdAt.startsWith(monthStr));
  const totalRevenue = orders.reduce((s, o) => s + (o.total || 0), 0);
  const avgBasket = orders.length ? totalRevenue / orders.length : 0;

  const byStatus = { nouveau: 0, en_preparation: 0, pret: 0, livre: 0 };
  orders.forEach(o => { if (byStatus[o.status] !== undefined) byStatus[o.status]++; });

  const byMode = { livraison: 0, emporter: 0 };
  orders.forEach(o => {
    if (o.delivery?.mode === 'livraison') byMode.livraison++;
    else byMode.emporter++;
  });

  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const dayOrders = orders.filter(o => o.createdAt.startsWith(ds));
    last30.push({
      date:    ds,
      revenue: parseFloat(dayOrders.reduce((s, o) => s + (o.total || 0), 0).toFixed(2)),
      count:   dayOrders.length,
    });
  }

  const itemCount = {};
  orders.forEach(o => {
    (o.items || []).forEach(i => {
      if (!itemCount[i.name]) itemCount[i.name] = { name: i.name, qty: 0, revenue: 0 };
      itemCount[i.name].qty     += (i.qty || 1);
      itemCount[i.name].revenue += (i.price || 0) * (i.qty || 1);
    });
  });
  const topItems = Object.values(itemCount)
    .sort((a, b) => b.qty - a.qty).slice(0, 8)
    .map(i => ({ ...i, revenue: parseFloat(i.revenue.toFixed(2)) }));

  res.json({
    today:     { revenue: parseFloat(todayOrders.reduce((s, o) => s + (o.total || 0), 0).toFixed(2)), orders: todayOrders.length },
    month:     { revenue: parseFloat(monthOrders.reduce((s, o) => s + (o.total || 0), 0).toFixed(2)), orders: monthOrders.length },
    total:     { revenue: parseFloat(totalRevenue.toFixed(2)), orders: orders.length },
    avgBasket: parseFloat(avgBasket.toFixed(2)),
    byStatus, byMode, last30, topItems,
    serverTime: new Date().toISOString(),
  });
});

// ── Liste commandes paginée + filtres ─────────────────────
app.get('/api/admin/orders', adminAuth, (req, res) => {
  let orders = loadOrders();
  const { status, mode, search, from, to, page = 1, limit = 25, sort = 'desc' } = req.query;
  const safePage  = Math.max(1, parseInt(page)  || 1);
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 25), 100);

  if (status) orders = orders.filter(o => o.status === status);
  if (mode)   orders = orders.filter(o => o.delivery?.mode === mode);
  if (from)   orders = orders.filter(o => o.createdAt >= from);
  if (to)     orders = orders.filter(o => o.createdAt <= to + 'T23:59:59');
  if (search) {
    const q = search.toLowerCase();
    orders = orders.filter(o => {
      const d = o.delivery || {};
      return (
        (d.firstname || '').toLowerCase().includes(q) ||
        (d.lastname  || '').toLowerCase().includes(q) ||
        (d.phone     || '').includes(q) ||
        (o.customerEmail || '').toLowerCase().includes(q)
      );
    });
  }
  orders.sort((a, b) => sort === 'asc'
    ? new Date(a.createdAt) - new Date(b.createdAt)
    : new Date(b.createdAt) - new Date(a.createdAt)
  );
  const total     = orders.length;
  const pages     = Math.ceil(total / safeLimit) || 1;
  const paginated = orders.slice((safePage - 1) * safeLimit, safePage * safeLimit);
  res.json({ orders: paginated, total, pages, page: safePage });
});

// ── Export CSV ─────────────────────────────────────────────
app.get('/api/admin/export/csv', adminAuth, (req, res) => {
  const orders = loadOrders();
  const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const rows = [
    ['Date','N° commande','Statut','Client','Email','Téléphone','Mode','Adresse','Articles','Total (€)'].map(escape).join(','),
    ...orders.map(o => {
      const d = o.delivery || {};
      const name  = `${d.firstname || ''} ${d.lastname || ''}`.trim();
      const addr  = [d.address, d.zip, d.city, d.floor, d.code].filter(Boolean).join(' ');
      const items = (o.items || []).map(i => `${i.qty || 1}x ${i.name}`).join(' | ');
      return [
        o.createdAt.slice(0, 16).replace('T', ' '),
        String(o.orderNumber).slice(-6),
        o.status, name, o.customerEmail || '',
        d.phone || '', d.mode || '', addr, items,
        (o.total || 0).toFixed(2),
      ].map(escape).join(',');
    }),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mythai-commandes-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('\uFEFF' + rows.join('\r\n'));
});

// ── Supprimer commande ─────────────────────────────────────
app.delete('/api/admin/orders/:id', adminAuth, (req, res) => {
  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Introuvable' });
  orders.splice(idx, 1);
  saveOrders(orders);
  res.json({ ok: true });
});

// ── Test email (temporaire) ───────────────────────────────
app.get('/api/test-email', async (req, res) => {
  const to = req.query.to || process.env.ADMIN_EMAIL;
  if (!to) return res.status(400).json({ error: 'Paramètre ?to= requis' });
  const fakeOrder = {
    orderNumber: Date.now(), total: 18.50, promoApplied: false, discount: 0,
    customerEmail: to,
    items: [{ name: 'Pad Thai Crevettes', qty: 1, price: 13.50 }, { name: 'Spring Rolls', qty: 2, price: 5.00 }],
    delivery: { mode: 'emporter', firstname: 'Test', lastname: 'Client', phone: '06 00 00 00 00' },
    createdAt: new Date().toISOString(),
  };
  const itemsHtml = fakeOrder.items.map(i =>
    `<tr><td style="padding:5px 0">${i.qty}× <strong>${i.name}</strong></td><td align="right">${i.price.toFixed(2)}€</td></tr>`
  ).join('');
  // Email client
  await sendEmail(to, '🍜 [TEST] Votre commande My Thai est confirmée !', `
    ${emailBrandBlock()}
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#C8390B;padding:24px 32px"><h1 style="color:#fff;margin:0;font-size:1.5rem">🍜 Commande confirmée !</h1></div>
      <div style="padding:28px 32px">
        <p style="margin-top:0">Bonjour <strong>Test</strong>,</p>
        <p>Votre commande est bien enregistrée et en cours de préparation.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:.92rem">${itemsHtml}
          <tr><td colspan="2"><hr style="border:none;border-top:1px solid #eee"/></td></tr>
          <tr><td><strong>Total payé</strong></td><td align="right"><strong>18.50€</strong></td></tr>
        </table>
        <p><strong>Mode :</strong> À emporter</p>
        <p style="color:#666;font-size:.88rem">⏱ Temps estimé : ~30 minutes</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
        <p style="color:#999;font-size:.8rem;margin:0">My Thai Street Food — 30 Av. Jean-Moulin, 78380 Bougival</p>
      </div>
    </div>`);
  // Email admin
  await sendEmail(to, '🔔 [TEST] Nouvelle commande — Test Client — 18.50€', `
    ${emailBrandBlock()}
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#C8390B;padding:20px 28px"><h1 style="color:#fff;margin:0;font-size:1.3rem">🔔 Nouvelle commande</h1></div>
      <div style="padding:24px 28px">
        <table style="width:100%;font-size:.9rem;margin-bottom:16px">
          <tr><td style="color:#666;width:130px">Client</td><td><strong>Test Client</strong></td></tr>
          <tr><td style="color:#666">Téléphone</td><td>06 00 00 00 00</td></tr>
          <tr><td style="color:#666">Mode</td><td><strong>À emporter</strong></td></tr>
        </table>
        <h3 style="margin-bottom:8px">Articles</h3>
        <table style="width:100%;border-collapse:collapse;font-size:.9rem">${itemsHtml}
          <tr><td colspan="2"><hr style="border:none;border-top:1px solid #eee"/></td></tr>
          <tr><td><strong>Total</strong></td><td align="right"><strong>18.50€</strong></td></tr>
        </table>
      </div>
    </div>`);
  res.json({ ok: true, sent_to: to });
});

// ── Static files ──────────────────────────────────────────
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  maxAge: '1d',
  etag: true,
}));

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Startup ───────────────────────────────────────────────
function loadFile(file, def) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return def; }
}
_ordersCache       = loadFile(ORDERS_FILE, []);
_promoUsedCache    = loadFile(PROMO_USED_FILE, []);
_pendingItemsCache = loadFile(PENDING_ITEMS_FILE, {});

app.listen(PORT, () => {
  console.log(`\n🍜 My Thai Street Food — http://localhost:${PORT}`);
  console.log(`   Commandes : ${_ordersCache.length} en base`);
  console.log(`   Zones livraison : ${[...DELIVERY_ZONES].join(', ')}\n`);
});
