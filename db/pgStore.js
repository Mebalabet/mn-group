// Production database adapter. Requires `pg` (already in package.json) and
// DATABASE_URL to be set — see db/index.js for how the two adapters are
// selected, and db/schema.sql for the table definitions to run once before
// first boot.
//
// Every method here returns the exact same camelCase JS object shape as
// db/jsonStore.js (id, sellerId, createdAt, ...) even though Postgres itself
// uses snake_case columns — that mapping happens in the mapX() functions
// below, so server.js can use either adapter without caring which one is
// active.

const { Pool } = require('pg');
const { randomUUID } = require('crypto');

let pool = null;
function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  pool = new Pool({
    connectionString: url,
    // Most managed Postgres providers (Neon, Supabase, Render, Railway)
    // require SSL and use certificates not in Node's default trust store.
    // Skipped only for an explicitly local database.
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  return pool;
}

function mapUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, passwordHash: row.password_hash, role: row.role, createdAt: row.created_at.toISOString() };
}
function mapProduct(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, description: row.description, price: Number(row.price),
    category: row.category, fileName: row.file_name, payhipUrl: row.payhip_url || null, sellerId: row.seller_id, sellerName: row.seller_name,
    status: row.status, createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : undefined,
  };
}
function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id, buyerId: row.buyer_id, items: row.items, total: Number(row.total),
    paymentStatus: row.payment_status,
    paymentProvider: row.payment_provider || null,
    paymentRef: row.payment_ref || null,
    paymentUpdatedAt: row.payment_updated_at ? row.payment_updated_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
function mapQuote(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id || null, name: row.name, email: row.email, company: row.company || null,
    serviceLine: row.service_line || null, timeline: row.timeline || null, details: row.details, budget: row.budget,
    status: row.status, customerMessage: row.customer_message || null, internalNote: row.internal_note || null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
function mapAudit(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, action: row.action, details: row.details, createdAt: row.created_at.toISOString() };
}

async function insertProductRow(product) {
  await getPool().query(
    `INSERT INTO products (id,name,description,price,category,file_name,payhip_url,seller_id,seller_name,status,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [product.id, product.name, product.description, product.price, product.category, product.fileName, product.payhipUrl || null, product.sellerId, product.sellerName, product.status, product.createdAt]
  );
  return product;
}

const PRODUCT_COLUMN_MAP = { status: 'status', updatedAt: 'updated_at', name: 'name', description: 'description', price: 'price', category: 'category', fileName: 'file_name', payhipUrl: 'payhip_url' };

module.exports = {
  kind: 'postgres',

  // ---- users ----
  async findUserByEmail(email) {
    const { rows } = await getPool().query('SELECT * FROM users WHERE email = $1', [email]);
    return mapUser(rows[0]);
  },
  async findUserById(id) {
    const { rows } = await getPool().query('SELECT * FROM users WHERE id = $1', [id]);
    return mapUser(rows[0]);
  },
  async insertUser(user) {
    try {
      await getPool().query(
        'INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [user.id, user.name, user.email, user.passwordHash, user.role, user.createdAt]
      );
      return user;
    } catch (err) {
      if (err.code === '23505') {
        const dupErr = new Error('An account with this email already exists');
        dupErr.code = 'DUPLICATE_EMAIL';
        throw dupErr;
      }
      throw err;
    }
  },
  async promoteUserByEmail(email) {
    const { rows } = await getPool().query(
      'UPDATE users SET role = $1 WHERE email = $2 RETURNING *',
      ['admin', email]
    );
    return mapUser(rows[0]);
  },
  async listUsers() {
    const { rows } = await getPool().query('SELECT * FROM users ORDER BY created_at');
    return rows.map(mapUser);
  },
  async countUsers() {
    const { rows } = await getPool().query('SELECT COUNT(*)::int AS n FROM users');
    return rows[0].n;
  },

  // ---- products ----
  async listApprovedProducts() {
    const { rows } = await getPool().query("SELECT * FROM products WHERE status IN ('approved','published') ORDER BY created_at DESC");
    return rows.map(mapProduct);
  },
  async findProductById(id) {
    const { rows } = await getPool().query('SELECT * FROM products WHERE id = $1', [id]);
    return mapProduct(rows[0]);
  },
  async findApprovedProductById(id) {
    const { rows } = await getPool().query("SELECT * FROM products WHERE id = $1 AND status IN ('approved','published')", [id]);
    return mapProduct(rows[0]);
  },
  insertProduct: insertProductRow,
  async listAllProducts() {
    const { rows } = await getPool().query('SELECT * FROM products ORDER BY created_at DESC');
    return rows.map(mapProduct);
  },
  async updateProduct(id, patch) {
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, val] of Object.entries(patch)) {
      const col = PRODUCT_COLUMN_MAP[key];
      if (!col) continue;
      sets.push(`${col} = $${i++}`);
      values.push(val);
    }
    if (sets.length === 0) return this.findProductById(id);
    values.push(id);
    const { rows } = await getPool().query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return mapProduct(rows[0]);
  },
  async countProducts() {
    const { rows } = await getPool().query('SELECT COUNT(*)::int AS n FROM products');
    return rows[0].n;
  },
  async countPendingProducts() {
    const { rows } = await getPool().query("SELECT COUNT(*)::int AS n FROM products WHERE status = 'pending'");
    return rows[0].n;
  },
  async seedIfEmpty(seedProducts) {
    const { rows } = await getPool().query('SELECT COUNT(*)::int AS n FROM products');
    if (rows[0].n > 0) return;
    const now = new Date().toISOString();
    for (const p of seedProducts) {
      await insertProductRow({
        id: randomUUID(), name: p.name, description: p.description, price: p.price,
        category: p.category, fileName: null, sellerId: null, sellerName: p.sellerName,
        status: 'approved', createdAt: now,
      });
    }
    console.log(`[db:postgres] seeded ${seedProducts.length} starter products`);
  },

  // ---- orders ----
  async insertOrder(order) {
    await getPool().query(
      'INSERT INTO orders (id,buyer_id,items,total,payment_status,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [order.id, order.buyerId, JSON.stringify(order.items), order.total, order.paymentStatus, order.createdAt]
    );
    return order;
  },
  async listAllOrders() {
    const { rows } = await getPool().query('SELECT * FROM orders ORDER BY created_at DESC');
    return rows.map(mapOrder);
  },
  async listOrdersByBuyer(buyerId) {
    const { rows } = await getPool().query('SELECT * FROM orders WHERE buyer_id = $1 ORDER BY created_at DESC', [buyerId]);
    return rows.map(mapOrder);
  },
  async findOrderById(id) {
    const { rows } = await getPool().query('SELECT * FROM orders WHERE id = $1', [id]);
    return mapOrder(rows[0]);
  },
  async countOrders() {
    const { rows } = await getPool().query('SELECT COUNT(*)::int AS n FROM orders');
    return rows[0].n;
  },
  // Thin patch-and-save, same contract as jsonStore's version — the payment
  // state machine (payments/orderState.js) is validated by the caller
  // before this is ever invoked. Only these four columns are settable here.
  async updateOrderPayment(orderId, patch) {
    const colMap = { paymentStatus: 'payment_status', paymentProvider: 'payment_provider', paymentRef: 'payment_ref', paymentUpdatedAt: 'payment_updated_at' };
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, val] of Object.entries(patch)) {
      const col = colMap[key];
      if (!col) continue;
      sets.push(`${col} = $${i++}`);
      values.push(val);
    }
    if (sets.length === 0) return this.findOrderById(orderId);
    values.push(orderId);
    const { rows } = await getPool().query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return mapOrder(rows[0]);
  },

  // ---- payment events (webhook idempotency) ----
  async listAllPaymentEvents() {
    const { rows } = await getPool().query('SELECT * FROM payment_events ORDER BY created_at DESC');
    return rows.map((r) => ({
      id: r.id, provider: r.provider, eventId: r.event_id, orderId: r.order_id,
      status: r.status, rawPayload: r.raw_payload, createdAt: r.created_at.toISOString(),
    }));
  },
  // The UNIQUE(provider, event_id) constraint is the actual race-closer
  // here — ON CONFLICT DO NOTHING makes the insert atomic at the database
  // level, and rowCount tells us whether we won that race or a concurrent
  // duplicate delivery got there first.
  async recordPaymentEvent(entry) {
    const { rowCount } = await getPool().query(
      'INSERT INTO payment_events (id,provider,event_id,order_id,status,raw_payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (provider, event_id) DO NOTHING',
      [entry.id, entry.provider, entry.eventId, entry.orderId, entry.status, JSON.stringify(entry.rawPayload || {}), entry.createdAt]
    );
    if (rowCount === 0) {
      const err = new Error('Payment event already processed');
      err.code = 'DUPLICATE_PAYMENT_EVENT';
      throw err;
    }
    return entry;
  },

  // ---- quotes ----
  async insertQuote(quote) {
    await getPool().query(
      `INSERT INTO quotes (id,name,email,details,budget,status,created_at,user_id,company,service_line,timeline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [quote.id, quote.name, quote.email, quote.details, quote.budget, quote.status, quote.createdAt,
       quote.userId, quote.company, quote.serviceLine, quote.timeline]
    );
    return quote;
  },
  async findQuoteById(id) {
    const { rows } = await getPool().query('SELECT * FROM quotes WHERE id = $1', [id]);
    return mapQuote(rows[0]);
  },
  async listAllQuotes() {
    const { rows } = await getPool().query('SELECT * FROM quotes ORDER BY created_at DESC');
    return rows.map(mapQuote);
  },
  async listQuotesByUser(userId) {
    const { rows } = await getPool().query('SELECT * FROM quotes WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return rows.map(mapQuote);
  },
  async countQuotes() {
    const { rows } = await getPool().query('SELECT COUNT(*)::int AS n FROM quotes');
    return rows[0].n;
  },
  // Thin patch-and-save, same contract as updateOrderPayment — the quote
  // status state machine is validated by the caller before this runs.
  async updateQuote(id, patch) {
    const colMap = { status: 'status', customerMessage: 'customer_message', internalNote: 'internal_note', updatedAt: 'updated_at' };
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, val] of Object.entries(patch)) {
      const col = colMap[key];
      if (!col) continue;
      sets.push(`${col} = $${i++}`);
      values.push(val);
    }
    if (sets.length === 0) return this.findQuoteById(id);
    values.push(id);
    const { rows } = await getPool().query(`UPDATE quotes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return mapQuote(rows[0]);
  },

  // ---- audit log ----
  async insertAuditLog(entry) {
    await getPool().query(
      'INSERT INTO audit_logs (id,user_id,action,details,created_at) VALUES ($1,$2,$3,$4,$5)',
      [entry.id, entry.userId, entry.action, JSON.stringify(entry.details || {}), entry.createdAt]
    );
    return entry;
  },
  async listAuditLogs() {
    const { rows } = await getPool().query('SELECT * FROM audit_logs ORDER BY created_at DESC');
    return rows.map(mapAudit);
  },
};
