// Picks the payment provider at startup, same pattern as db/index.js and
// storage/index.js. With PAYMENT_PROVIDER unset, the app runs the noop
// provider: checkout still works and creates pending orders, but nothing
// can actually initiate or confirm a payment until a real provider is
// configured. There is no "fake success" fallback — ever.

const config = require('../config');

const provider = config.payments.provider === 'payu'
  ? require('./payuProvider')
  : require('./noopProvider');

if (config.payments.provider === 'payu') {
  console.log(
    provider.isConfigured()
      ? '[payments] using PayU provider'
      : '[payments] PAYMENT_PROVIDER=payu but PAYU_MERCHANT_KEY/PAYU_MERCHANT_SALT are not set — ' +
        'payment initiation will be refused until they are configured'
  );
} else {
  console.log('[payments] no payment provider configured (PAYMENT_PROVIDER unset) — orders will stay pending until one is set up');
}

module.exports = provider;
