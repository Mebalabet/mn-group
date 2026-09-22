// PayU (India) hosted-checkout adapter.
//
// Hash formulas below match PayU's current documented scheme (verified
// against docs.payu.in during this session — confirm again before going
// live, in case their API version changes):
//   request (_payment API):  sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
//   response (reverse hash): sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
//   General API (Verify Payment etc.): sha512(key|command|var1|salt)
// Note: this targets the default _payment API (no api_version=19); that
// variant uses a different, longer hash string with udf6-10 and more
// fields — switch formulas if this integration is ever upgraded to it.
//
// Nothing here works without real credentials — PAYU_MERCHANT_KEY,
// PAYU_MERCHANT_SALT, PAYU_BASE_URL, PAYU_SUCCESS_URL, PAYU_FAILURE_URL
// all come from env and are never hardcoded or defaulted to a test value.

const crypto = require('crypto');
const config = require('../config');

function payuConfig() { return config.payments.payu; }

function isConfigured() {
  const c = payuConfig();
  return Boolean(c.merchantKey && c.merchantSalt && c.baseUrl && c.successUrl && c.failureUrl);
}

function requireConfigured() {
  if (!isConfigured()) {
    const err = new Error(
      'PayU is not fully configured — set PAYU_MERCHANT_KEY, PAYU_MERCHANT_SALT, ' +
      'PAYU_BASE_URL, PAYU_SUCCESS_URL and PAYU_FAILURE_URL.'
    );
    err.code = 'PAYMENT_NOT_CONFIGURED';
    throw err;
  }
}

function generateTxnId() {
  // PayU's txnid must be alphanumeric and reasonably short — our order ids
  // are full UUIDs (36 chars incl. dashes), which risks exceeding PayU's
  // limit and includes a disallowed character, so a fresh compact id is
  // generated per payment attempt instead. The order id itself still
  // travels in udf1 as a correlation backstop.
  return 'mng' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function sha512(str) {
  return crypto.createHash('sha512').update(str, 'utf8').digest('hex');
}

module.exports = {
  kind: 'payu',
  isConfigured,

  // Builds the hosted-checkout redirect: an action URL + form fields the
  // frontend auto-submits as a POST (this is how PayU's hosted checkout
  // works — not a JSON API that returns a session token). Returns the
  // txnid too, so the caller can store it on the order as paymentRef for
  // later correlation with the webhook.
  async createPaymentSession(order, buyer) {
    requireConfigured();
    const { merchantKey, merchantSalt, baseUrl, successUrl, failureUrl } = payuConfig();

    const txnid = generateTxnId();
    const amount = Number(order.total).toFixed(2);
    // PayU caps productinfo length; keep it well under that.
    const productinfo = order.items.map((i) => i.name).join(', ').slice(0, 100);
    const firstname = String(buyer.name || 'Buyer').split(' ')[0].slice(0, 60);
    const email = buyer.email;
    const udf1 = order.id; // correlation backstop alongside txnid
    const udf2 = '', udf3 = '', udf4 = '', udf5 = '';

    const hash = sha512([
      merchantKey, txnid, amount, productinfo, firstname, email,
      udf1, udf2, udf3, udf4, udf5, '', '', '', '', '',
      merchantSalt,
    ].join('|'));

    return {
      actionUrl: baseUrl,
      txnid,
      fields: {
        key: merchantKey, txnid, amount, productinfo, firstname, email,
        udf1, surl: successUrl, furl: failureUrl, hash,
      },
    };
  },

  // Recomputes PayU's response hash (fields as PayU actually sent them,
  // not our local order data) and compares with a constant-time check.
  verifyWebhookSignature(payload) {
    const { merchantKey, merchantSalt } = payuConfig();
    if (!merchantKey || !merchantSalt) return false;
    const {
      status = '', txnid = '', amount = '', productinfo = '', firstname = '', email = '',
      udf1 = '', udf2 = '', udf3 = '', udf4 = '', udf5 = '', hash = '', key = '',
    } = payload || {};
    if (!hash || key !== merchantKey) return false;

    const expected = sha512([
      merchantSalt, status, '', '', '', '', '',
      udf5, udf4, udf3, udf2, udf1, email, firstname, productinfo, amount, txnid, merchantKey,
    ].join('|'));

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(hash).toLowerCase(), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  // Server-to-server reconciliation, per PayU's own recommendation not to
  // rely on the webhook/callback status alone (network issues or a
  // refreshed browser can mean a spoofed or replayed callback arrives
  // without ever having been sent by PayU for this attempt). Optional:
  // requires PAYU_VERIFY_URL. Returns null (not "confirmed", not
  // "denied") when unconfigured or unreachable, so callers must treat
  // null as "couldn't corroborate" rather than either payment outcome.
  async verifyPaymentStatus(txnid) {
    const { merchantKey, merchantSalt, verifyUrl } = payuConfig();
    if (!merchantKey || !merchantSalt || !verifyUrl) return null;
    const hash = sha512([merchantKey, 'verify_payment', txnid, merchantSalt].join('|'));
    try {
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ key: merchantKey, command: 'verify_payment', var1: txnid, hash }).toString(),
      });
      if (!res.ok) return null;
      const data = await res.json();
      // PayU's verify_payment response nests the transaction details under
      // the txnid key; unwrap defensively since the exact shape isn't
      // guaranteed stable across API versions.
      const txn = (data && data.transaction_details && data.transaction_details[txnid]) || null;
      return txn ? String(txn.status || '').toLowerCase() : null;
    } catch {
      return null; // network/parse failure — treat as "couldn't corroborate", not a denial
    }
  },

  // Normalizes a verified PayU webhook payload into the shape server.js's
  // state machine understands. Anything other than an explicit 'success'
  // is treated as non-paid — an unrecognized status never defaults to paid.
  parseWebhookEvent(payload) {
    const rawStatus = String(payload.status || '').toLowerCase();
    const status = rawStatus === 'success' ? 'paid'
      : rawStatus === 'pending' ? 'processing'
      : (rawStatus === 'cancel' || rawStatus === 'usercancelled') ? 'cancelled'
      : 'failed'; // failure, dropped, error, or anything unrecognized
    return {
      provider: 'payu',
      // mihpayid is PayU's own transaction reference — prefer it for
      // idempotency since txnid is ours and status could theoretically be
      // re-delivered under the same txnid across retries.
      eventId: payload.mihpayid || payload.txnid,
      orderId: payload.udf1 || null,
      txnid: payload.txnid,
      status,
      amount: payload.amount,
      raw: payload,
    };
  },
};
