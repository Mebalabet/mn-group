// Local-dev / zero-config database adapter: the whole dataset lives in one
// JSON file on disk. Every method is async even though the underlying work
// is synchronous, so this is a drop-in swap for db/pgStore.js — server.js
// never needs to know which one it's talking to.
//
// Not suitable for real concurrent production traffic (every write rewrites
// the entire file, and there's no transaction isolation) — see db/pgStore.js
// for the production path. Fine for local development and small/low-traffic
// deployments.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const INITIAL = { users: [], products: [], orders: [], quotes: [], auditLogs: [], paymentEvents: [] };

// Backfills fields that didn't exist in earlier versions of this app's
// schema, so a data/db.json created before this update keeps working
// exactly as-is — no manual migration, no data loss, nothing silently
// dropped. Returns true if anything was actually changed (so the caller
// knows whether to persist the backfilled version back to disk).
function normalize(data) {
  let changed = false;
  for (const key of Object.keys(INITIAL)) {
    if (!Array.isArray(data[key])) { data[key] = []; changed = true; }
  }
  for (const p of data.products) {
    if (p.sellerName === undefined) {
      // Pre-existing listings from before sellerName was snapshotted at
      // creation time (see server.js) — recover the real name from the
      // matching user record when possible, rather than a generic
      // placeholder or a silently-missing field.
      const owner = p.sellerId ? data.users.find((u) => u.id === p.sellerId) : null;
      p.sellerName = owner ? owner.name : 'MN Group Marketplace';
      changed = true;
    }
    if (p.status === undefined) { p.status = 'pending'; changed = true; }
    if (p.fileName === undefined) { p.fileName = null; changed = true; }
  }
  for (const u of data.users) {
    if (u.role === undefined) { u.role = 'buyer'; changed = true; }
  }
  for (const o of data.orders) {
    if (o.paymentStatus === undefined) { o.paymentStatus = 'pending'; changed = true; }
    if (o.paymentProvider === undefined) { o.paymentProvider = null; changed = true; }
    if (o.paymentRef === undefined) { o.paymentRef = null; changed = true; }
    if (o.paymentUpdatedAt === undefined) { o.paymentUpdatedAt = null; changed = true; }
  }
  for (const q of data.quotes) {
    if (q.userId === undefined) { q.userId = null; changed = true; }
    if (q.company === undefined) { q.company = null; changed = true; }
    if (q.serviceLine === undefined) { q.serviceLine = null; changed = true; }
    if (q.timeline === undefined) { q.timeline = null; changed = true; }
    if (q.customerMessage === undefined) { q.customerMessage = null; changed = true; }
    if (q.internalNote === undefined) { q.internalNote = null; changed = true; }
    if (q.updatedAt === undefined) { q.updatedAt = null; changed = true; }
  }
  return changed;
}

function load() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { data: structuredClone(INITIAL), changed: false };
  }
  const changed = normalize(data);
  return { data, changed };
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const loaded = load();
let db = loaded.data;

function save() {
  // Write-then-rename so a crash mid-write can never leave db.json truncated
  // or corrupted — the rename is atomic on POSIX filesystems.
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

// If loading an existing file needed any backfilling, write the healed
// version back immediately so it's there even if the process exits before
// any other write would have triggered a save.
if (loaded.changed) {
  save();
  console.log('[db:json] backfilled missing fields on existing data/db.json (no data was removed)');
}

function seedIfEmpty(seedProducts) {
  if (db.products.length > 0) return;
  const now = new Date().toISOString();
  db.products = seedProducts.map((p) => ({
    id: randomUUID(), name: p.name, description: p.description, price: p.price,
    category: p.category, fileName: null, sellerId: null, sellerName: p.sellerName,
    status: 'approved', createdAt: now,
  }));
  save();
  console.log(`[db:json] seeded ${seedProducts.length} starter products`);
}

module.exports = {
  kind: 'json',

  // ---- users ----
  async findUserByEmail(email) { return db.users.find((u) => u.email === email) || null; },
  async findUserById(id) { return db.users.find((u) => u.id === id) || null; },
  async insertUser(user) {
    if (db.users.some((u) => u.email === user.email)) {
      const err = new Error('An account with this email already exists');
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }
    db.users.push(user);
    save();
    return user;
  },
  async promoteUserByEmail(email) {
    const user = db.users.find((u) => u.email === email);
    if (!user) return null;
    user.role = 'admin';
    save();
    return user;
  },
  async listUsers() { return db.users; },
  async countUsers() { return db.users.length; },

  // ---- products ----
  async listApprovedProducts() { return db.products.filter((p) => p.status === 'approved' || p.status === 'published'); },
  async findProductById(id) { return db.products.find((p) => p.id === id) || null; },
  async findApprovedProductById(id) {
    const p = db.products.find((x) => x.id === id);
    return p && (p.status === 'approved' || p.status === 'published') ? p : null;
  },
  async insertProduct(product) { db.products.push(product); save(); return product; },
  async listAllProducts() { return db.products; },
  async updateProduct(id, patch) {
    const p = db.products.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    save();
    return p;
  },
  async countProducts() { return db.products.length; },
  async countPendingProducts() { return db.products.filter((p) => p.status === 'pending').length; },
  seedIfEmpty,

  // ---- orders ----
  async insertOrder(order) { db.orders.push(order); save(); return order; },
  async findOrderById(id) { return db.orders.find((o) => o.id === id) || null; },
  async listAllOrders() { return db.orders; },
  async listOrdersByBuyer(buyerId) { return db.orders.filter((o) => o.buyerId === buyerId); },
  async countOrders() { return db.orders.length; },
  // Thin patch-and-save — deliberately does not itself enforce the payment
  // state machine (see payments/orderState.js); the caller (server.js) is
  // expected to have already validated the transition before calling this.
  async updateOrderPayment(orderId, patch) {
    const o = db.orders.find((x) => x.id === orderId);
    if (!o) return null;
    Object.assign(o, patch);
    save();
    return o;
  },

  // ---- payment events (webhook idempotency) ----
  async listAllPaymentEvents() { return db.paymentEvents.slice().reverse(); },
  // Atomic record-or-throw, same pattern as insertUser's DUPLICATE_EMAIL:
  // the check-and-push has no await between them, so within this
  // single-threaded store it can't race the way a separate
  // check-then-record pair could.
  async recordPaymentEvent(entry) {
    if (db.paymentEvents.some((e) => e.provider === entry.provider && e.eventId === entry.eventId)) {
      const err = new Error('Payment event already processed');
      err.code = 'DUPLICATE_PAYMENT_EVENT';
      throw err;
    }
    db.paymentEvents.push(entry);
    save();
    return entry;
  },

  // ---- quotes ----
  async insertQuote(quote) { db.quotes.push(quote); save(); return quote; },
  async findQuoteById(id) { return db.quotes.find((q) => q.id === id) || null; },
  async listAllQuotes() { return db.quotes; },
  async listQuotesByUser(userId) { return db.quotes.filter((q) => q.userId === userId); },
  async countQuotes() { return db.quotes.length; },
  // Thin patch-and-save — same contract as updateOrderPayment: the quote
  // status state machine (quoteState.js) is validated by the caller before
  // this is invoked.
  async updateQuote(id, patch) {
    const q = db.quotes.find((x) => x.id === id);
    if (!q) return null;
    Object.assign(q, patch);
    save();
    return q;
  },

  // ---- audit log ----
  async insertAuditLog(entry) { db.auditLogs.push(entry); save(); return entry; },
  async listAuditLogs() { return db.auditLogs.slice().reverse(); },
};
