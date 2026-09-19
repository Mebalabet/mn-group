// The default payment provider. On purpose, it does nothing successfully —
// every method either returns a clear "not configured" state or throws.
// This is what keeps checkout honest before a real provider is wired up:
// orders can be created (paymentStatus: pending) but never marked paid.

module.exports = {
  kind: 'none',

  isConfigured() { return false; },

  // Would normally return whatever the buyer's browser needs to start a
  // hosted checkout (a redirect URL + signed form fields, for PayU). With
  // no provider configured there is nothing to return, so this throws a
  // typed error the route handler turns into a clean 503.
  async createPaymentSession() {
    const err = new Error('No payment provider is configured yet.');
    err.code = 'PAYMENT_NOT_CONFIGURED';
    throw err;
  },

  // Never returns true — there is no secret to verify a signature against,
  // so no webhook can ever be treated as authentic by this provider.
  verifyWebhookSignature() { return false; },

  async verifyPaymentStatus() { return null; },

  parseWebhookEvent() {
    const err = new Error('No payment provider is configured — cannot parse webhook payloads.');
    err.code = 'PAYMENT_NOT_CONFIGURED';
    throw err;
  },
};
