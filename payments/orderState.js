// Allowed order.paymentStatus transitions. A transition not listed here is
// rejected outright — most importantly, a terminal state (paid, failed,
// cancelled) can never move to a different status afterward, so a
// duplicate, delayed, or spoofed-but-differently-stated webhook can never
// downgrade an order that's already been marked paid.
const TRANSITIONS = {
  pending: ['processing', 'paid', 'failed', 'cancelled'],
  processing: ['paid', 'failed', 'cancelled'],
  paid: [],
  failed: [],
  cancelled: [],
};

function canTransition(from, to) {
  if (from === to) return true; // the same event arriving twice is a no-op, not an error
  return (TRANSITIONS[from] || []).includes(to);
}

module.exports = { canTransition, TRANSITIONS };
