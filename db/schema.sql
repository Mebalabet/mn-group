-- Run once against a fresh database before first boot with DATABASE_URL set:
--   psql "$DATABASE_URL" -f db/schema.sql
-- Safe to re-run — every statement is idempotent.

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'buyer',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id             UUID PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  price          NUMERIC(12,2) NOT NULL,
  category       TEXT NOT NULL DEFAULT 'other',
  file_name      TEXT,
  payhip_url     TEXT,
  seller_id      UUID REFERENCES users(id),
  seller_name    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | published
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);

CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY,
  buyer_id        UUID NOT NULL REFERENCES users(id),
  items           JSONB NOT NULL,   -- snapshot of {id,name,price,qty} per line item at purchase time
  total           NUMERIC(12,2) NOT NULL,
  payment_status  TEXT NOT NULL DEFAULT 'pending', -- pending | processing | paid | failed | cancelled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);

-- Payment abstraction (Phase 3): additive columns for whichever provider is
-- eventually plugged in via PAYMENT_PROVIDER. Run this against an existing
-- database with `psql "$DATABASE_URL" -f db/schema.sql` — every ADD COLUMN
-- here is IF NOT EXISTS, so it's safe to re-run and touches no existing rows.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ref TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ;

-- Webhook idempotency: a (provider, event_id) pair can only be recorded
-- once, so a redelivered/duplicate webhook is detected at the database
-- level, not just in application logic.
CREATE TABLE IF NOT EXISTS payment_events (
  id            UUID PRIMARY KEY,
  provider      TEXT NOT NULL,
  event_id      TEXT NOT NULL,      -- provider's own transaction reference (e.g. PayU mihpayid)
  order_id      UUID REFERENCES orders(id),
  status        TEXT NOT NULL,      -- normalized: pending | processing | paid | failed | cancelled
  raw_payload   JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id);

CREATE TABLE IF NOT EXISTS quotes (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  details     TEXT NOT NULL,
  budget      TEXT,
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- B2B quote workflow (Phase 4): additive columns. Run against an existing
-- database the same way as the Phase 3 payment columns — every ADD COLUMN
-- is IF NOT EXISTS, safe to re-run, touches no existing quote rows.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS service_line TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS timeline TEXT;
-- Admin-authored message meant to reach the customer (e.g. a quoted price
-- or next steps). Distinct from internal_note, which never leaves the
-- admin panel — see GET /api/quotes in server.js for the field-stripping.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_message TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS internal_note TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

ALTER TABLE products ADD COLUMN IF NOT EXISTS payhip_url TEXT;
