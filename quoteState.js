// Allowed quote.status transitions for the B2B quote workflow. Same pattern
// as payments/orderState.js (explicit allow-list, terminal states can't
// move again) — kept as its own module rather than living under payments/,
// since quotes are required to stay architecturally independent from the
// order/payment system.
const TRANSITIONS = {
  new: ['reviewing', 'declined'],
  reviewing: ['quoted', 'declined'],
  quoted: ['accepted', 'declined'],
  accepted: ['closed'],
  declined: [],
  closed: [],
};

function canTransitionQuote(from, to) {
  if (from === to) return true; // same status arriving again is a no-op
  return (TRANSITIONS[from] || []).includes(to);
}

module.exports = { canTransitionQuote, TRANSITIONS };
