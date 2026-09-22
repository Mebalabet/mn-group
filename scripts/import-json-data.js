#!/usr/bin/env node
/**
 * One-time, safe migration of the existing JSON datastore into PostgreSQL.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." NODE_ENV=production node scripts/import-json-data.js
 *
 * This script:
 *   - never modifies data/db.json
 *   - applies db/schema.sql first (idempotent)
 *   - imports users, products, orders, payment events, quotes and audit logs
 *   - preserves UUIDs, timestamps, password hashes and payment state
 *   - uses ON CONFLICT DO NOTHING so it can safely be re-run
 *   - verifies that conflicting existing rows are identical instead of silently overwriting them
 *   - rolls back all data inserts if any migration error occurs
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const DB_JSON = path.join(ROOT, 'data', 'db.json');
const SCHEMA_SQL = path.join(ROOT, 'db', 'schema.sql');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is required.');
  process.exit(1);
}

if (!fs.existsSync(DB_JSON)) {
  console.error(`❌ Source file not found: ${DB_JSON}`);
  process.exit(1);
}

if (!fs.existsSync(SCHEMA_SQL)) {
  console.error(`❌ Schema file not found: ${SCHEMA_SQL}`);
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

function readSource() {
  const raw = fs.readFileSync(DB_JSON, 'utf8');
  const data = JSON.parse(raw);
  for (const key of ['users', 'products', 'orders', 'quotes', 'auditLogs']) {
    if (!Array.isArray(data[key])) data[key] = [];
  }
  if (!Array.isArray(data.paymentEvents)) data.paymentEvents = [];
  return data;
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function requireField(record, field, collection) {
  if (record[field] === undefined || record[field] === null || record[field] === '') {
    throw new Error(`${collection} record ${record.id || '<unknown>'} is missing required field: ${field}`);
  }
}

async function verifyExisting(client, table, id, expected, columns) {
  const { rows } = await client.query(
    `SELECT ${columns.join(', ')} FROM ${table} WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return false;

  const actual = rows[0];
  for (const [column, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[column];
    const normalize = (value, col) => {
      if (value == null) return null;
      if (col === 'created_at' || col === 'updated_at' || col === 'payment_updated_at') return new Date(value).toISOString();
      return String(value);
    };
    if (!same(normalize(actualValue, column), normalize(expectedValue, column))) {
      throw new Error(
        `Conflict detected for ${table}.${id}: ${column} differs from data/db.json. ` +
        'Migration stopped without overwriting the existing PostgreSQL row.'
      );
    }
  }
  return true;
}

async function migrate() {
  const source = readSource();
  const sourceHash = require('crypto').createHash('sha256').update(fs.readFileSync(DB_JSON)).digest('hex');
  const client = await pool.connect();

  const counts = {
    users: source.users.length,
    products: source.products.length,
    orders: source.orders.length,
    paymentEvents: source.paymentEvents.length,
    quotes: source.quotes.length,
    auditLogs: source.auditLogs.length,
  };

  console.log('📦 MN Group JSON → PostgreSQL migration');
  console.log(`Source: ${DB_JSON}`);
  console.log(`Source SHA-256: ${sourceHash}`);
  console.log('Source counts:', counts);

  try {
    // The schema is idempotent. This makes the one-time import usable against
    // a newly created managed PostgreSQL database without a separate psql step.
    const schema = fs.readFileSync(SCHEMA_SQL, 'utf8');
    await client.query(schema);
    console.log('✅ PostgreSQL schema verified/applied.');

    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('mn-group-json-import-v1'))");

    // 1. Users first because products/orders/quotes/audit logs may reference them.
    for (const u of source.users) {
      requireField(u, 'id', 'users');
      requireField(u, 'name', 'users');
      requireField(u, 'email', 'users');
      requireField(u, 'passwordHash', 'users');
      requireField(u, 'createdAt', 'users');

      const exists = await verifyExisting(client, 'users', u.id, {
        name: u.name,
        email: u.email,
        password_hash: u.passwordHash,
        role: u.role || 'buyer',
        created_at: u.createdAt,
      }, ['name', 'email', 'password_hash', 'role', 'created_at']);

      if (!exists) {
        await client.query(
          `INSERT INTO users (id,name,email,password_hash,role,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [u.id, u.name, u.email, u.passwordHash, u.role || 'buyer', u.createdAt]
        );
      }
    }
    console.log(`✅ Users imported/verified: ${counts.users}`);

    // 2. Products.
    for (const p of source.products) {
      for (const field of ['id', 'name', 'description', 'price', 'category', 'sellerName', 'status', 'createdAt']) {
        requireField(p, field, 'products');
      }

      const expected = {
        name: p.name,
        description: p.description,
        price: p.price,
        category: p.category,
        file_name: p.fileName == null ? null : p.fileName,
        payhip_url: p.payhipUrl == null ? null : p.payhipUrl,
        seller_id: p.sellerId == null ? null : p.sellerId,
        seller_name: p.sellerName,
        status: p.status,
        created_at: p.createdAt,
      };
      const exists = await verifyExisting(client, 'products', p.id, expected,
        ['name', 'description', 'price', 'category', 'file_name', 'payhip_url', 'seller_id', 'seller_name', 'status', 'created_at']);

      if (!exists) {
        await client.query(
          `INSERT INTO products
           (id,name,description,price,category,file_name,payhip_url,seller_id,seller_name,status,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [p.id, p.name, p.description, p.price, p.category, p.fileName || null,
           p.payhipUrl || null, p.sellerId || null, p.sellerName, p.status, p.createdAt]
        );
      }
    }
    console.log(`✅ Products imported/verified: ${counts.products}`);

    // 3. Orders, including payment metadata and the original line-item snapshot.
    for (const o of source.orders) {
      for (const field of ['id', 'buyerId', 'items', 'total', 'paymentStatus', 'createdAt']) {
        requireField(o, field, 'orders');
      }

      const expected = {
        buyer_id: o.buyerId,
        items: JSON.stringify(o.items),
        total: o.total,
        payment_status: o.paymentStatus,
        payment_provider: o.paymentProvider == null ? null : o.paymentProvider,
        payment_ref: o.paymentRef == null ? null : o.paymentRef,
        payment_updated_at: o.paymentUpdatedAt == null ? null : o.paymentUpdatedAt,
        created_at: o.createdAt,
      };
      const { rows } = await client.query(
        `SELECT buyer_id, items, total, payment_status, payment_provider, payment_ref, payment_updated_at, created_at
         FROM orders WHERE id = $1`, [o.id]
      );
      if (rows[0]) {
        const actual = rows[0];
        const checks = [
          ['buyer_id', String(actual.buyer_id), String(expected.buyer_id)],
          ['items', JSON.stringify(actual.items), expected.items],
          ['total', String(actual.total), String(expected.total)],
          ['payment_status', String(actual.payment_status), String(expected.payment_status)],
          ['payment_provider', actual.payment_provider == null ? null : String(actual.payment_provider), expected.payment_provider == null ? null : String(expected.payment_provider)],
          ['payment_ref', actual.payment_ref == null ? null : String(actual.payment_ref), expected.payment_ref == null ? null : String(expected.payment_ref)],
          ['payment_updated_at', actual.payment_updated_at == null ? null : new Date(actual.payment_updated_at).toISOString(), expected.payment_updated_at == null ? null : new Date(expected.payment_updated_at).toISOString()],
          ['created_at', new Date(actual.created_at).toISOString(), new Date(expected.created_at).toISOString()],
        ];
        for (const [field, a, e] of checks) if (a !== e) throw new Error(`Conflict detected for orders.${o.id}: ${field} differs from data/db.json.`);
      } else {
        await client.query(
          `INSERT INTO orders
           (id,buyer_id,items,total,payment_status,created_at,payment_provider,payment_ref,payment_updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [o.id, o.buyerId, JSON.stringify(o.items), o.total, o.paymentStatus, o.createdAt,
           o.paymentProvider || null, o.paymentRef || null, o.paymentUpdatedAt || null]
        );
      }
    }
    console.log(`✅ Orders imported/verified: ${counts.orders}`);

    // 4. Payment events (webhook idempotency history).
    for (const e of source.paymentEvents) {
      for (const field of ['id', 'provider', 'eventId', 'status', 'createdAt']) requireField(e, field, 'paymentEvents');
      const { rows } = await client.query(
        `SELECT provider,event_id,order_id,status,raw_payload,created_at FROM payment_events WHERE id = $1`, [e.id]
      );
      if (rows[0]) {
        const a = rows[0];
        const checks = [
          ['provider', String(a.provider), String(e.provider)],
          ['event_id', String(a.event_id), String(e.eventId)],
          ['order_id', a.order_id == null ? null : String(a.order_id), e.orderId == null ? null : String(e.orderId)],
          ['status', String(a.status), String(e.status)],
          ['raw_payload', JSON.stringify(a.raw_payload || {}), JSON.stringify(e.rawPayload || {})],
          ['created_at', new Date(a.created_at).toISOString(), new Date(e.createdAt).toISOString()],
        ];
        for (const [field, av, ev] of checks) if (av !== ev) throw new Error(`Conflict detected for payment_events.${e.id}: ${field} differs from data/db.json.`);
      } else {
        await client.query(
          `INSERT INTO payment_events (id,provider,event_id,order_id,status,raw_payload,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [e.id, e.provider, e.eventId, e.orderId || null, e.status, JSON.stringify(e.rawPayload || {}), e.createdAt]
        );
      }
    }
    console.log(`✅ Payment events imported/verified: ${counts.paymentEvents}`);

    // 5. Quotes.
    for (const q of source.quotes) {
      for (const field of ['id', 'name', 'email', 'details', 'status', 'createdAt']) requireField(q, field, 'quotes');
      const { rows } = await client.query(
        `SELECT name,email,details,budget,status,created_at,user_id,company,service_line,timeline,customer_message,internal_note,updated_at
         FROM quotes WHERE id = $1`, [q.id]
      );
      if (rows[0]) {
        const a = rows[0];
        const checks = [
          ['name', a.name, q.name], ['email', a.email, q.email], ['details', a.details, q.details],
          ['budget', a.budget ?? null, q.budget ?? null], ['status', a.status, q.status],
          ['user_id', a.user_id == null ? null : String(a.user_id), q.userId == null ? null : String(q.userId)],
          ['company', a.company ?? null, q.company ?? null], ['service_line', a.service_line ?? null, q.serviceLine ?? null],
          ['timeline', a.timeline ?? null, q.timeline ?? null], ['customer_message', a.customer_message ?? null, q.customerMessage ?? null],
          ['internal_note', a.internal_note ?? null, q.internalNote ?? null],
          ['updated_at', a.updated_at == null ? null : new Date(a.updated_at).toISOString(), q.updatedAt == null ? null : new Date(q.updatedAt).toISOString()],
          ['created_at', new Date(a.created_at).toISOString(), new Date(q.createdAt).toISOString()],
        ];
        for (const [field, av, ev] of checks) if (av !== ev) throw new Error(`Conflict detected for quotes.${q.id}: ${field} differs from data/db.json.`);
      } else {
        await client.query(
          `INSERT INTO quotes
           (id,name,email,details,budget,status,created_at,user_id,company,service_line,timeline,customer_message,internal_note,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [q.id, q.name, q.email, q.details, q.budget || null, q.status, q.createdAt,
           q.userId || null, q.company || null, q.serviceLine || null, q.timeline || null,
           q.customerMessage || null, q.internalNote || null, q.updatedAt || null]
        );
      }
    }
    console.log(`✅ Quotes imported/verified: ${counts.quotes}`);

    // 6. Audit logs. These reference users but are otherwise independent.
    for (const a of source.auditLogs) {
      for (const field of ['id', 'action', 'createdAt']) requireField(a, field, 'auditLogs');
      const { rows } = await client.query(
        `SELECT user_id,action,details,created_at FROM audit_logs WHERE id = $1`, [a.id]
      );
      if (rows[0]) {
        const r = rows[0];
        const checks = [
          ['user_id', r.user_id == null ? null : String(r.user_id), a.userId == null ? null : String(a.userId)],
          ['action', String(r.action), String(a.action)],
          ['details', JSON.stringify(r.details || {}), JSON.stringify(a.details || {})],
          ['created_at', new Date(r.created_at).toISOString(), new Date(a.createdAt).toISOString()],
        ];
        for (const [field, av, ev] of checks) if (av !== ev) throw new Error(`Conflict detected for audit_logs.${a.id}: ${field} differs from data/db.json.`);
      } else {
        await client.query(
          `INSERT INTO audit_logs (id,user_id,action,details,created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [a.id, a.userId || null, a.action, JSON.stringify(a.details || {}), a.createdAt]
        );
      }
    }
    console.log(`✅ Audit logs imported/verified: ${counts.auditLogs}`);

    // Final count verification inside the same transaction.
    const tables = ['users', 'products', 'orders', 'payment_events', 'quotes', 'audit_logs'];
    const expected = [counts.users, counts.products, counts.orders, counts.paymentEvents, counts.quotes, counts.auditLogs];
    for (let i = 0; i < tables.length; i++) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${tables[i]}`);
      if (rows[0].n < expected[i]) {
        throw new Error(`Verification failed: ${tables[i]} contains ${rows[0].n} rows but source has ${expected[i]}.`);
      }
    }

    await client.query('COMMIT');

    // Verify source was not modified while the migration was running.
    const finalHash = require('crypto').createHash('sha256').update(fs.readFileSync(DB_JSON)).digest('hex');
    if (finalHash !== sourceHash) throw new Error('Source data/db.json changed during migration. PostgreSQL transaction was committed, but the source must be investigated before launch.');

    console.log('\n🚀 Migration completed successfully.');
    console.log('data/db.json was NOT modified.');
    console.log(`Verified source SHA-256: ${finalHash}`);
    console.log('PostgreSQL is now ready to serve the migrated records.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('\n❌ Migration failed. PostgreSQL data inserts were rolled back.');
    console.error(err.stack || err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err.stack || err);
  process.exitCode = 1;
});
