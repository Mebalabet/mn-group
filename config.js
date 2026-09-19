// Centralizes every environment-driven setting in one place, with sane
// local-dev defaults and hard failures for the ones that are genuinely
// unsafe to run with a default value in production.

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const DEFAULT_JWT_SECRET = 'mn-group-dev-secret-change-me';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (IS_PRODUCTION && JWT_SECRET === DEFAULT_JWT_SECRET) {
  // Booting with the default secret in production means anyone can forge a
  // valid admin session token. This is exactly the kind of mistake that's
  // easy to make once (copy .env.example, forget to fill it in) and
  // catastrophic to leave in place, so refuse to start rather than warn.
  console.error(
    '[config] Refusing to start: NODE_ENV=production but JWT_SECRET is unset ' +
    'or still the default placeholder. Set a long random JWT_SECRET (e.g. ' +
    "`openssl rand -hex 32`) in your environment before deploying."
  );
  process.exit(1);
}
if (!IS_PRODUCTION && JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.warn('[config] Using the default JWT_SECRET — fine for local dev, never for production.');
}

// Production must use durable infrastructure. Failing closed here prevents
// an accidental deploy from silently writing buyers/orders to the ephemeral
// container filesystem or serving digital files from local disk.
if (IS_PRODUCTION && !process.env.DATABASE_URL) {
  console.error('[config] Refusing to start: NODE_ENV=production requires DATABASE_URL.');
  process.exit(1);
}
if (IS_PRODUCTION) {
  const requiredStorage = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missingStorage = requiredStorage.filter((key) => !process.env[key]);
  if (missingStorage.length) {
    console.error(`[config] Refusing to start: production requires S3 object storage. Missing: ${missingStorage.join(', ')}`);
    process.exit(1);
  }
}

const config = {
  env: NODE_ENV,
  isProduction: IS_PRODUCTION,
  port: Number(process.env.PORT || 3000),
  jwtSecret: JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // Database: Postgres in production (DATABASE_URL set), local JSON file
  // otherwise. See db/index.js.
  databaseUrl: process.env.DATABASE_URL || null,

  // Object storage: S3-compatible (AWS S3, Cloudflare R2, Backblaze B2,
  // DigitalOcean Spaces all work) when configured, local disk otherwise.
  // See storage/index.js.
  storage: {
    bucket: process.env.S3_BUCKET || null,
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || null, // required for R2/B2/Spaces; omit for real AWS S3
    accessKeyId: process.env.S3_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || null,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || null, // CDN/public URL prefix, if the bucket serves files directly
  },

  // Comma-separated list of allowed origins for cross-origin requests, only
  // relevant if the frontend is ever hosted on a different domain than the
  // API (e.g. a static frontend on a CDN calling api.yourdomain.com). Same-
  // origin deployments (the default — Express serves public/ itself) don't
  // need this at all.
  corsOrigins: (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),

  // Behind a reverse proxy (Caddy/Nginx) or a PaaS load balancer, Express
  // needs to be told to trust the X-Forwarded-* headers so req.ip and
  // rate limiting see the real client IP, not the proxy's.
  trustProxy: process.env.TRUST_PROXY !== 'false',

  // Payment provider: unset (null) until real credentials exist. See
  // payments/index.js — the app runs fine with no provider configured
  // (checkout still creates pending orders), it just can't actually
  // initiate or verify a payment yet. No test/fake credentials, ever.
  payments: {
    provider: process.env.PAYMENT_PROVIDER || null, // e.g. 'payu'
    payu: {
      merchantKey: process.env.PAYU_MERCHANT_KEY || null,
      merchantSalt: process.env.PAYU_MERCHANT_SALT || null,
      // PayU's hosted-checkout base URL differs between their test and
      // production environments — set explicitly per environment rather
      // than defaulting to either one.
      baseUrl: process.env.PAYU_BASE_URL || null,
      // Server-to-server "Verify Payment" reconciliation endpoint (also
      // differs test vs production — e.g. test.payu.in vs info.payu.in per
      // PayU's docs). Optional: without it, the webhook's verified
      // signature is still required and honored, this just adds PayU's
      // own recommended extra reconciliation step.
      verifyUrl: process.env.PAYU_VERIFY_URL || null,
      successUrl: process.env.PAYU_SUCCESS_URL || null,
      failureUrl: process.env.PAYU_FAILURE_URL || null,
    },
  },
};

module.exports = config;
