const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');

const config = require('./config');
const db = require('./db');
const storage = require('./storage');
const payments = require('./payments');
const { canTransition } = require('./payments/orderState');
const { canTransitionQuote } = require('./quoteState');
const SEED_PRODUCTS = require('./db/seedData');
const aiProvider = require('./ai/provider');
const { buildSupportContext } = require('./ai/supportContext');

const app = express();

// Behind a reverse proxy (Caddy/Nginx) or a PaaS load balancer, this makes
// req.ip and the rate limiter below see the real client IP from
// X-Forwarded-For instead of the proxy's own address.
if (config.trustProxy) app.set('trust proxy', 1);

// helmet's default CSP blocks inline <script> and onclick="" handlers, both
// of which public/index.html relies on throughout — a full CSP overhaul
// needs those reworked into external scripts + addEventListener first,
// which is a frontend task, not a security-foundation one. In the
// meantime this ships a real (if permissive on script/style) CSP rather
// than none at all: object embeds, base-tag hijacking, and framing by
// other origins are blocked now; inline-script XSS mitigation is the
// known follow-up once the frontend is reworked.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://picsum.photos', 'https://*.picsum.photos'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      formAction: ["'self'", 'https://secure.payu.in'],
    },
  },
}));

// multer needs to hand off an in-memory buffer when S3 storage is active
// (storage/s3Storage.js uploads that buffer directly), vs. writing to a
// local uploads/ dir for the local-storage default — see storage/index.js.
// Admin-only endpoint (only a logged-in admin can reach this), but still
// worth an allow-list rather than trusting any content-type: a compromised
// admin session or a mistaken upload shouldn't be able to place an
// executable or script into storage. Covers common digital-product file
// types; extend this list as real product formats are added.
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf', '.zip', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.epub', '.mobi',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.mp3', '.mp4', '.mov', '.wav',
  '.psd', '.ai', '.fig', '.sketch',
]);
function uploadFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type "${ext || '(no extension)'}" is not allowed`));
  }
  cb(null, true);
}
const upload = multer(
  config.storage.bucket
    ? { storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 }, fileFilter: uploadFileFilter }
    : { dest: path.join(__dirname, 'uploads'), limits: { fileSize: 100 * 1024 * 1024 }, fileFilter: uploadFileFilter }
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Only active when CORS_ORIGIN is set — same-origin deployments (the
// default: Express serves public/ itself) don't need this at all.
if (config.corsOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// Brute-force protection on the two endpoints that matter most for it.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a few minutes and try again.' },
});

// /api/quotes is public and unauthenticated (anyone can request a quote
// without an account), so it had no abuse protection at all before this —
// a looser limit than auth, since legitimate repeat use is more plausible.
const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a few minutes and try again.' },
});

// /api/ai/chat is public, unauthenticated, and calls a paid external AI
// API per request — the tightest limit of the three, since abuse here has
// a direct dollar cost, not just a brute-force risk.
const aiChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests to AI support — please wait a few minutes and try again.' },
});

function tokenFor(u) {
  return jwt.sign({ id: u.id, email: u.email, role: u.role, name: u.name }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(h.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
// Populates req.user if a valid Bearer token is present, but never blocks
// the request otherwise — unlike auth(), a missing or invalid token here
// is not an error, it just means an anonymous/guest request continues.
function optionalAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { req.user = jwt.verify(h.slice(7), config.jwtSecret, { algorithms: ['HS256'] }); } catch { /* ignore — proceed as a guest */ }
  }
  next();
}

// Phase 6 (mobile/API stability) prep: optional ?limit=&offset= paging for
// list endpoints. The response body stays a plain array in every case —
// never conditionally wrapped — so nothing that already expects an array
// (the storefront, admin.html) breaks; total count is exposed via an
// X-Total-Count header instead, a standard REST convention that doesn't
// touch the body shape. Everything defaults to fully unbounded (identical
// to current behavior) unless a caller explicitly passes ?limit=, with one
// exception: callers can pass defaultLimit to bound a list even without an
// explicit param — used only for the audit log, the one list here with
// genuinely unbounded growth and no natural cap.
const MAX_PAGE_LIMIT = 500;
function paginate(res, items, req, defaultLimit = null) {
  const total = items.length;
  let offset = req.query.offset !== undefined ? parseInt(req.query.offset, 10) : 0;
  if (!Number.isInteger(offset) || offset < 0) offset = 0;
  let limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : defaultLimit;
  res.set('X-Total-Count', String(total));
  if (limit === null || limit === undefined) return offset > 0 ? items.slice(offset) : items;
  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit || total || 1;
  limit = Math.min(limit, MAX_PAGE_LIMIT);
  return items.slice(offset, offset + limit);
}
async function audit(req, action, details = {}) {
  await db.insertAuditLog({ id: randomUUID(), userId: req.user?.id || null, action, details, createdAt: new Date().toISOString() });
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'MN Group API', time: new Date().toISOString(), db: db.kind, storage: storage.kind, env: config.env }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Name, email and password (8+ characters) are required' });
    if (String(name).trim().length > 200) return res.status(400).json({ error: 'Name is too long' });
    if (password.length > 200) return res.status(400).json({ error: 'Password is too long' });
    const normalized = String(email).trim().toLowerCase();
    if (normalized.length > 320 || !EMAIL_RE.test(normalized)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (await db.findUserByEmail(normalized)) return res.status(409).json({ error: 'An account with this email already exists' });
    const role = 'buyer';
    const user = { id: randomUUID(), name: String(name).trim(), email: normalized, passwordHash: await bcrypt.hash(password, 12), role, createdAt: new Date().toISOString() };
    await db.insertUser(user);
    res.status(201).json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err.code === 'DUPLICATE_EMAIL') return res.status(409).json({ error: err.message });
    next(err);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const normalized = String(email || '').trim().toLowerCase();
    const u = await db.findUserByEmail(normalized);
    if (!u || !(await bcrypt.compare(password || '', u.passwordHash))) {
      await db.insertAuditLog({ id: randomUUID(), userId: null, action: 'auth.login_failed', details: { email: normalized }, createdAt: new Date().toISOString() });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({ token: tokenFor(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  } catch (err) { next(err); }
});

app.get('/api/auth/me', auth, async (req, res, next) => {
  try {
    const u = await db.findUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  } catch (err) { next(err); }
});

app.get('/api/products', async (req, res, next) => {
  try { res.json(paginate(res, await db.listApprovedProducts(), req)); } catch (err) { next(err); }
});

// Public, unauthenticated AI customer-support endpoint. Answers only from
// buildSupportContext()'s public product/service data plus the fixed
// system prompt (ai/systemPrompt.js) — see ai/provider.js for the actual
// call out to the configured AI vendor. Never touches auth, orders,
// payments, or any mutation — it can only read and reply with text.
const AI_MAX_MESSAGES = 12; // conversation turns per request
const AI_MAX_MESSAGE_LENGTH = 1000; // characters per message
app.post('/api/ai/chat', aiChatLimiter, async (req, res, next) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }
    if (messages.length > AI_MAX_MESSAGES) {
      return res.status(400).json({ error: `Conversation is too long (maximum ${AI_MAX_MESSAGES} messages per request)` });
    }
    const cleanMessages = [];
    for (const m of messages) {
      if (!m || m.role !== 'user' || typeof m.content !== 'string') {
        return res.status(400).json({ error: 'Each message must be a user message with string content' });
      }
      if (m.content.length > AI_MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `Each message is limited to ${AI_MAX_MESSAGE_LENGTH} characters` });
      }
      cleanMessages.push({ role: 'user', content: m.content });
    }
    const context = await buildSupportContext();
    const result = await aiProvider.generateSupportReply({ messages: cleanMessages, context });
    if (!result.ok) {
      return res.status(502).json({ error: 'AI support is currently unavailable' });
    }
    res.json({ reply: result.reply });
  } catch (err) { next(err); }
});

const PRODUCT_CATEGORIES = ['software', 'templates', 'design', 'plugins', 'courses', 'services', 'other'];

// Temporary service catalog values. The quote workflow is fully wired,
// but the six official MN Group service names still need business-owner
// confirmation before public launch; frontend ids must match these values.
const SERVICE_LINES = [
  'web-development', 'mobile-development', 'design-branding',
  'digital-marketing', 'consulting-strategy', 'managed-support',
];

app.post('/api/products', auth, async (req, res, next) => {
  try {
    const { name, description, price, category, fileName, payhipUrl } = req.body || {};
    if (!name || !description || price == null) return res.status(400).json({ error: 'name, description and price are required' });
    if (String(name).length > 200) return res.status(400).json({ error: 'Name is too long' });
    if (String(description).length > 5000) return res.status(400).json({ error: 'Description is too long (5000 character limit)' });
    if (category && !PRODUCT_CATEGORIES.includes(category)) return res.status(400).json({ error: `Category must be one of: ${PRODUCT_CATEGORIES.join(', ')}` });
    if (payhipUrl && !/^https:\/\/payhip\.com\/[^\s]+$/i.test(String(payhipUrl))) return res.status(400).json({ error: 'payhipUrl must be a valid Payhip URL' });
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) return res.status(400).json({ error: 'Enter a valid price' });
    const p = {
      id: randomUUID(), name, description, price: priceNum, category: category || 'other', fileName: fileName || null, payhipUrl: payhipUrl || null,
      sellerId: req.user.id, sellerName: req.user.name, status: req.user.role === 'admin' ? 'approved' : 'pending', createdAt: new Date().toISOString(),
    };
    await db.insertProduct(p);
    await audit(req, 'product.created', { productId: p.id, status: p.status });
    res.status(201).json(p);
  } catch (err) { next(err); }
});

app.get('/api/admin/products', auth, adminOnly, async (req, res, next) => {
  try { res.json(paginate(res, await db.listAllProducts(), req)); } catch (err) { next(err); }
});

app.patch('/api/admin/products/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const existing = await db.findProductById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (req.body.status && !['pending', 'approved', 'rejected', 'published'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
    const patch = { status: req.body.status || existing.status, updatedAt: new Date().toISOString() };
    if (Object.prototype.hasOwnProperty.call(req.body, 'fileName')) {
      if (req.body.fileName !== null && (typeof req.body.fileName !== 'string' || req.body.fileName.length > 300)) return res.status(400).json({ error: 'fileName must be null or a valid file id' });
      patch.fileName = req.body.fileName || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'payhipUrl')) {
      if (req.body.payhipUrl !== null && (typeof req.body.payhipUrl !== 'string' || !/^https:\/\/payhip\.com\/[^\s]+$/i.test(req.body.payhipUrl))) return res.status(400).json({ error: 'payhipUrl must be null or a valid Payhip URL' });
      patch.payhipUrl = req.body.payhipUrl || null;
    }
    const updated = await db.updateProduct(req.params.id, patch);
    await audit(req, 'product.updated', { productId: updated.id, status: updated.status, fileName: updated.fileName || null, payhipUrl: updated.payhipUrl || null });
    res.json(updated);
  } catch (err) { next(err); }
});

app.post('/api/quotes', quoteLimiter, optionalAuth, async (req, res, next) => {
  try {
    const { name, email, details, budget, company, serviceLine, timeline } = req.body || {};
    if (!name || !email || !details) return res.status(400).json({ error: 'name, email and details are required' });
    if (!serviceLine || !SERVICE_LINES.includes(serviceLine)) return res.status(400).json({ error: `serviceLine must be one of: ${SERVICE_LINES.join(', ')}` });
    if (String(name).length > 200) return res.status(400).json({ error: 'Name is too long' });
    if (!EMAIL_RE.test(String(email).trim().toLowerCase()) || String(email).length > 320) return res.status(400).json({ error: 'Enter a valid email address' });
    if (String(details).length > 5000) return res.status(400).json({ error: 'Details are too long (5000 character limit)' });
    if (company && String(company).length > 200) return res.status(400).json({ error: 'Company name is too long' });
    if (budget && String(budget).length > 100) return res.status(400).json({ error: 'Budget is too long' });
    if (timeline && String(timeline).length > 100) return res.status(400).json({ error: 'Timeline is too long' });
    const q = {
      id: randomUUID(),
      // Associated automatically when the requester happens to be logged
      // in (optionalAuth) — guests can still submit without an account,
      // matching the existing public behavior of this endpoint.
      userId: req.user ? req.user.id : null,
      name, email, company: company || null, serviceLine, timeline: timeline || null,
      details, budget: budget || null, status: 'new',
      customerMessage: null, internalNote: null, updatedAt: null,
      createdAt: new Date().toISOString(),
    };
    await db.insertQuote(q);
    await audit(req, 'quote.created', { quoteId: q.id, serviceLine });
    res.status(201).json({ message: 'Quote request received', quoteId: q.id });
  } catch (err) { next(err); }
});

// A logged-in customer's own quote requests — mirrors GET /api/orders.
// internalNote is stripped: it's the admin-only side of the "communication
// fields" requirement and must never reach a customer-facing response.
app.get('/api/quotes', auth, async (req, res, next) => {
  try {
    const quotes = paginate(res, await db.listQuotesByUser(req.user.id), req);
    res.json(quotes.map(({ internalNote, ...q }) => q));
  } catch (err) { next(err); }
});

app.get('/api/admin/quotes', auth, adminOnly, async (req, res, next) => {
  try { res.json(paginate(res, await db.listAllQuotes(), req)); } catch (err) { next(err); }
});

// Admin quote management: status transitions go through the same explicit
// state-machine pattern as order payments (payments/orderState.js) — see
// quoteState.js. customerMessage/internalNote can be set independently of
// a status change (an admin might add an internal note without moving the
// quote forward yet).
app.patch('/api/admin/quotes/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const existing = await db.findQuoteById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quote not found' });
    const { status, customerMessage, internalNote } = req.body || {};
    const patch = { updatedAt: new Date().toISOString() };
    if (status !== undefined) {
      if (!canTransitionQuote(existing.status, status)) {
        return res.status(409).json({ error: `Cannot move a quote from "${existing.status}" to "${status}"` });
      }
      patch.status = status;
    }
    if (customerMessage !== undefined) {
      if (customerMessage !== null && String(customerMessage).length > 5000) return res.status(400).json({ error: 'Message is too long (5000 character limit)' });
      patch.customerMessage = customerMessage;
    }
    if (internalNote !== undefined) {
      if (internalNote !== null && String(internalNote).length > 5000) return res.status(400).json({ error: 'Note is too long (5000 character limit)' });
      patch.internalNote = internalNote;
    }
    const updated = await db.updateQuote(req.params.id, patch);
    await audit(req, 'quote.updated', { quoteId: updated.id, status: updated.status });
    res.json(updated);
  } catch (err) { next(err); }
});
app.get('/api/admin/users', auth, adminOnly, async (req, res, next) => {
  try {
    const users = paginate(res, await db.listUsers(), req);
    res.json(users.map(({ passwordHash, ...u }) => u));
  } catch (err) { next(err); }
});
app.get('/api/admin/audit', auth, adminOnly, async (req, res, next) => {
  try { res.json(paginate(res, await db.listAuditLogs(), req, 200)); } catch (err) { next(err); }
});

// Order totals are always recomputed here from the current, real listing
// prices — never trust a client-supplied total or per-item price, since
// both are trivially editable in the browser before the request is sent.
app.post('/api/orders', auth, async (req, res, next) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Order items required' });
    const lineItems = [];
    for (const it of items) {
      const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 0));
      const product = await db.findApprovedProductById(it.id);
      if (!product) return res.status(400).json({ error: `A product in your cart is no longer available (${it.id})` });
      lineItems.push({ id: product.id, name: product.name, price: product.price, qty });
    }
    const total = lineItems.reduce((sum, li) => sum + li.price * li.qty, 0);

    // Idempotency/duplicate-submission guard: if this exact buyer placed an
    // identical order (same items, same total) in the last 30 seconds,
    // return that order instead of creating a second one — protects
    // against double-clicks and network retries without a dedicated
    // idempotency-key column.
    const recentCutoff = Date.now() - 30 * 1000;
    const recent = (await db.listOrdersByBuyer(req.user.id))
      .filter((o) => new Date(o.createdAt).getTime() >= recentCutoff)
      .find((o) => o.total === total && JSON.stringify(o.items) === JSON.stringify(lineItems));
    if (recent) return res.status(200).json(recent);

    const order = {
      id: randomUUID(), buyerId: req.user.id, items: lineItems, total, paymentStatus: 'pending',
      paymentProvider: null, paymentRef: null, paymentUpdatedAt: null,
      createdAt: new Date().toISOString(),
    };
    await db.insertOrder(order);
    await audit(req, 'order.created', { orderId: order.id });
    res.status(201).json(order);
  } catch (err) { next(err); }
});
app.get('/api/orders', auth, async (req, res, next) => {
  try { res.json(paginate(res, await db.listOrdersByBuyer(req.user.id), req)); } catch (err) { next(err); }
});
app.get('/api/admin/orders', auth, adminOnly, async (req, res, next) => {
  try { res.json(paginate(res, await db.listAllOrders(), req)); } catch (err) { next(err); }
});

// Initiates a payment attempt for an order the buyer owns. This never marks
// anything paid — it only hands back whatever the provider needs to start
// a hosted checkout (for PayU: a redirect URL + signed form fields). With
// no provider configured, this returns a clear 503 rather than faking one.
app.post('/api/orders/:id/pay', auth, async (req, res, next) => {
  try {
    const order = await db.findOrderById(req.params.id);
    if (!order || order.buyerId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
    if (!['pending', 'processing'].includes(order.paymentStatus)) {
      return res.status(409).json({ error: `This order is already ${order.paymentStatus} and can't be paid again.` });
    }
    let session;
    try {
      session = await payments.createPaymentSession(order, { name: req.user.name, email: req.user.email });
    } catch (err) {
      if (err.code === 'PAYMENT_NOT_CONFIGURED') return res.status(503).json({ error: 'Payment is not available yet — please check back soon.' });
      throw err;
    }
    const nextStatus = order.paymentStatus === 'pending' ? 'processing' : order.paymentStatus;
    if (!canTransition(order.paymentStatus, nextStatus)) return res.status(409).json({ error: 'Order state changed — please refresh and try again.' });
    await db.updateOrderPayment(order.id, {
      paymentStatus: nextStatus, paymentProvider: payments.kind, paymentRef: session.txnid,
      paymentUpdatedAt: new Date().toISOString(),
    });
    await audit(req, 'payment.initiated', { orderId: order.id, provider: payments.kind, ref: session.txnid });
    res.json({ actionUrl: session.actionUrl, fields: session.fields });
  } catch (err) { next(err); }
});

// PayU also posts the buyer-facing success/failure callback to the URLs
// configured in the hosted checkout. The signed webhook remains the only
// authority for changing payment state; these pages merely return the buyer
// to the storefront after PayU has completed its browser round-trip.
app.get('/payment/success', (req, res) => res.redirect('/?payment=success'));
app.post('/payment/success', (req, res) => res.redirect('/?payment=success'));
app.get('/payment/failure', (req, res) => res.redirect('/?payment=failure'));
app.post('/payment/failure', (req, res) => res.redirect('/?payment=failure'));

// PayU (or whichever provider is configured) posts here server-to-server —
// this can never carry the buyer's JWT, so it's intentionally unauthenticated.
// Signature verification is what stands in for auth. This is the ONLY path
// that can ever move an order to paymentStatus: paid — nothing client-facing
// can do that, by design. The named PayU callback route below reuses this exact
// handler; it is an alias, not a second payment-processing implementation.
const handlePaymentWebhook = async (req, res) => {
  try {
    if (req.params.provider !== payments.kind || !payments.isConfigured()) {
      // Don't distinguish "wrong provider" from "not configured" in the
      // response — no reason to hand a prober that detail.
      return res.status(404).end();
    }
    if (!payments.verifyWebhookSignature(req.body)) {
      await db.insertAuditLog({ id: randomUUID(), userId: null, action: 'payment.webhook_rejected', details: { provider: req.params.provider, reason: 'invalid signature' }, createdAt: new Date().toISOString() });
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = payments.parseWebhookEvent(req.body);
    const order = event.orderId ? await db.findOrderById(event.orderId) : null;
    if (!order) {
      await db.insertAuditLog({ id: randomUUID(), userId: null, action: 'payment.webhook_unmatched', details: { provider: payments.kind, eventId: event.eventId, orderId: event.orderId }, createdAt: new Date().toISOString() });
      return res.status(200).json({ ok: true }); // ack so the provider stops retrying; nothing to apply
    }

    if (!order.paymentRef || !event.txnid || event.txnid !== order.paymentRef) {
      await db.insertAuditLog({ id: randomUUID(), userId: order.buyerId, action: 'payment.txnid_mismatch', details: { orderId: order.id, expected: order.paymentRef, received: event.txnid }, createdAt: new Date().toISOString() });
      return res.status(400).json({ error: 'Payment transaction mismatch' });
    }

    // Never mark an order paid for the wrong amount. The order total was
    // recomputed server-side when the order was created; compare it with the
    // signed provider amount before any paid transition is considered.
    const providerAmount = Number(event.amount);
    if (!Number.isFinite(providerAmount) || Math.abs(providerAmount - Number(order.total)) > 0.005) {
      await db.insertAuditLog({ id: randomUUID(), userId: order.buyerId, action: 'payment.amount_mismatch', details: { orderId: order.id, expected: order.total, received: event.amount, txnid: event.txnid }, createdAt: new Date().toISOString() });
      return res.status(400).json({ error: 'Payment amount mismatch' });
    }

    // Defense-in-depth beyond the signature check: for the highest-stakes
    // transition (marking an order paid), corroborate with the provider's
    // own server-to-server reconciliation call when one is configured.
    // A signature can be valid on a stale or reused webhook; this catches
    // cases where PayU's own records disagree with what the webhook claims.
    let status = event.status;
    if (status === 'paid') {
      const reconciled = await payments.verifyPaymentStatus(event.txnid);
      if (reconciled !== null && reconciled !== 'success') {
        status = 'failed';
        await db.insertAuditLog({ id: randomUUID(), userId: order.buyerId, action: 'payment.reconciliation_mismatch', details: { orderId: order.id, webhookStatus: event.status, reconciledStatus: reconciled }, createdAt: new Date().toISOString() });
      }
    }

    try {
      await db.recordPaymentEvent({
        id: randomUUID(), provider: payments.kind, eventId: event.eventId, orderId: order.id,
        status, rawPayload: event.raw, createdAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err.code === 'DUPLICATE_PAYMENT_EVENT') return res.status(200).json({ ok: true, duplicate: true });
      throw err;
    }

    if (!canTransition(order.paymentStatus, status)) {
      await db.insertAuditLog({ id: randomUUID(), userId: order.buyerId, action: 'payment.transition_rejected', details: { orderId: order.id, from: order.paymentStatus, to: status }, createdAt: new Date().toISOString() });
      return res.status(200).json({ ok: true }); // event recorded for audit; state intentionally left unchanged
    }

    await db.updateOrderPayment(order.id, {
      paymentStatus: status, paymentProvider: payments.kind,
      paymentRef: event.txnid || order.paymentRef, paymentUpdatedAt: new Date().toISOString(),
    });
    await db.insertAuditLog({ id: randomUUID(), userId: order.buyerId, action: 'payment.status_updated', details: { orderId: order.id, status }, createdAt: new Date().toISOString() });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    // A genuine internal error (e.g. a transient DB failure) should get a
    // 5xx so the provider's retry mechanism has a chance to succeed later
    // — unlike the branches above (bad signature, duplicate, unmatched
    // order), which are not transient and don't benefit from a retry.
    res.status(500).json({ ok: false });
  }
};

app.post('/api/payments/webhook/:provider', handlePaymentWebhook);
app.post('/api/payments/payu/callback', (req, res, next) => {
  req.params.provider = 'payu';
  return handlePaymentWebhook(req, res, next);
});

app.post('/api/admin/upload', auth, adminOnly, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File required' });
    const saved = await storage.save(req.file);
    await audit(req, 'file.uploaded', { file: saved.originalName });
    res.status(201).json(saved);
  } catch (err) { next(err); }
});

// Digital files are protected by purchase ownership, not by possession of
// a file ID. A buyer may download a file only when the product is included
// in one of that buyer's paid orders. Admins retain access for fulfillment
// and QA. The file ID itself is never accepted as an authorization token.
app.get('/api/files/:fileId', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      const orders = await db.listOrdersByBuyer(req.user.id);
      const paidOrders = orders.filter((o) => o.paymentStatus === 'paid');
      let entitled = false;
      for (const order of paidOrders) {
        for (const item of (order.items || [])) {
          const product = await db.findProductById(item.id);
          if (product && product.fileName === req.params.fileId) { entitled = true; break; }
        }
        if (entitled) break;
      }
      if (!entitled) return res.status(403).json({ error: 'You do not have access to this file' });
    }
    const ok = await storage.streamTo(req.params.fileId, res);
    if (!ok) res.status(404).json({ error: 'File not found' });
  } catch (err) { next(err); }
});

// Returns only files the signed-in buyer is entitled to download. Keeping
// this separate from the order payload avoids exposing storage identifiers
// before payment is complete and gives the UI a simple download list.
app.get('/api/orders/:id/downloads', auth, async (req, res, next) => {
  try {
    const order = await db.findOrderById(req.params.id);
    if (!order || order.buyerId !== req.user.id) return res.status(404).json({ error: 'Order not found' });
    if (order.paymentStatus !== 'paid') return res.status(409).json({ error: 'Downloads become available after payment is confirmed.' });
    const downloads = [];
    for (const item of (order.items || [])) {
      const product = await db.findProductById(item.id);
      if (product && product.fileName) downloads.push({ productId: product.id, name: product.name, fileId: product.fileName, url: `/api/files/${encodeURIComponent(product.fileName)}` });
    }
    res.json(downloads);
  } catch (err) { next(err); }
});

app.get('/api/admin/dashboard', auth, adminOnly, async (req, res, next) => {
  try {
    const [orders, quotes] = await Promise.all([db.listAllOrders(), db.listAllQuotes()]);
    const revenue = orders.filter((o) => o.paymentStatus === 'paid').reduce((sum, o) => sum + Number(o.total), 0);
    const pendingPayments = orders.filter((o) => ['pending', 'processing'].includes(o.paymentStatus)).length;
    const quotesByStatus = quotes.reduce((acc, q) => { acc[q.status] = (acc[q.status] || 0) + 1; return acc; }, {});
    res.json({
      users: await db.countUsers(),
      products: await db.countProducts(),
      pendingProducts: await db.countPendingProducts(),
      orders: await db.countOrders(),
      quotes: await db.countQuotes(),
      revenue,
      pendingPayments,
      quotesByStatus,
    });
  } catch (err) { next(err); }
});

// Payments visibility for admins — the webhook handler already records
// every processed event for idempotency; this just makes that log
// readable instead of write-only. Read-only, admin-gated, no interaction
// with the held file-ownership item.
app.get('/api/admin/payment-events', auth, adminOnly, async (req, res, next) => {
  try { res.json(paginate(res, await db.listAllPaymentEvents(), req)); } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError || /not allowed/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: config.isProduction ? 'Internal server error' : String(err.message || err) });
});

(async () => {
  // Never seed fictional/demo catalog entries into production. Production
  // starts from the durable database (and can be populated through the admin
  // workflow); local development keeps the existing starter catalog.
  if (!config.isProduction) await db.seedIfEmpty(SEED_PRODUCTS);
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`MN Group running on port ${config.port} (env: ${config.env}, db: ${db.kind}, storage: ${storage.kind})`);
  });

  // Containerized/PaaS hosting sends SIGTERM on redeploy or scale-down —
  // finish in-flight requests and exit cleanly instead of dropping them.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref(); // force-exit if close() hangs
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();
