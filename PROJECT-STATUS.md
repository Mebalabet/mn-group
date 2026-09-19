# MN Group — Project Status

Phase 1 — Security        [~] in progress (1 item held for approval)
Phase 2 — Marketplace     [~] in progress
Phase 3 — Payments        [~] abstraction layer built; no live PayU account yet
Phase 4 — B2B Services    [~] quote workflow built end-to-end; official service-line names still needed
Phase 5 — Admin           [x] dashboard/payments/files visibility and paid-buyer digital-file ownership authorization

## Phase 5 detail
- [x] Dashboard — extended with business metrics: revenue (sum of paid
      orders), pending-payment count, quote-status breakdown — all
      computed from existing list functions, no schema change
- [x] Payments visibility — GET /api/admin/payment-events + a Payment
      events table in admin.html, making the webhook idempotency log
      (previously write-only) actually readable
- [x] Digital files — a Digital files table in admin.html, derived
      entirely from the products list admin.html already fetches
      (products carry fileName; admin can now attach/detach files)
- [x] Users, products, orders, quotes, audit logs — already existed,
      unchanged this pass
- [x] Secure administrative actions — unchanged; every admin route was
      already server-gated (auth + adminOnly) before this pass, and stays
      that way; admin.html's client-side redirect is UX only, never the
      actual security boundary
- [x] Digital-file ownership authorization (GET /api/files/:fileId) —
      still explicitly held, not touched this pass either
- [ ] The six real MN Group service lines and the design reference are
      still pending from the user — not touched, as instructed
Phase 6 — Mobile          [~] API-level prep done; no native app work started

## Phase 6 detail
- [x] Same business logic for web/mobile — already true architecturally
      before this pass: one REST JSON API with no web-specific coupling
      (no server-rendered HTML in the API responses, no session cookies).
      Confirmed, not changed.
- [x] API stability — added optional ?limit=&offset= pagination to every
      list endpoint (products, admin products, orders, admin orders,
      quotes, admin quotes, admin users, admin audit log, admin payment
      events). Response body stays a plain array in every case (never
      conditionally wrapped) so nothing existing breaks; total count is
      exposed via an X-Total-Count header instead. Every endpoint defaults
      to fully unbounded (identical to prior behavior) unless a caller
      opts in via ?limit=, except the audit log, which now defaults to a
      200-row cap since it has genuinely unbounded growth and no natural
      cap otherwise (admin.html only ever displayed 30 of them anyway).
- [ ] "Mobile-responsive behavior" — this is frontend/CSS work and falls
      under the redesign hold the user explicitly put in place; not
      touched, not started, waiting for that phase.
- [ ] Native iOS/Android app work, push notifications, app-store
      integration — out of scope without real infrastructure/credentials;
      not started, not invented.
Phase 7 — Launch          [ ]

## Phase 4 detail
- [x] Service detail → Request a Quote flow — storefront service grid
      (reuses the existing .cat-tile visual, no new CSS/redesign) opens a
      detail+form view per service line, wired to the real POST /api/quotes
- [x] Detailed B2B form — name, email, company, service line, budget band,
      timeline, project details (was previously just name/email/details/budget)
- [x] Customer auth/account association — optionalAuth on POST /api/quotes:
      a logged-in requester's quote is linked to their account automatically;
      guests can still submit without one (existing behavior preserved)
- [x] Quote persistence in both JSON and PostgreSQL stores — same
      abstraction pattern as orders/payments (findQuoteById, listQuotesByUser,
      updateQuote mirror findOrderById/listOrdersByBuyer/updateOrderPayment)
- [x] Admin quote-management UI — extended the existing (already-working)
      Quotes table in admin.html with service/company/budget/timeline/status
      columns and status-transition buttons, rather than building a parallel
      interface
- [x] Explicit quote status state machine (quoteState.js) — new → reviewing
      → quoted → accepted → closed, with declined reachable from new/
      reviewing/quoted; terminal states can't move again. Kept as its own
      module (not under payments/) since quotes must stay independent
- [x] Admin/customer communication without leaking sensitive info —
      customerMessage (admin-authored, meant for the customer) vs
      internalNote (admin-only); GET /api/quotes strips internalNote before
      returning a customer's own quotes
- [x] Validation/authorization/rate limiting consistent with the existing
      project — same EMAIL_RE, same length-cap pattern, same quoteLimiter,
      same auth/adminOnly middleware already used elsewhere
- [x] Kept independent from /api/orders/:id/pay — the quote routes never
      call into payments/ or the order state machine, and vice versa
- [ ] MN Group's real six service line names — NOT AVAILABLE. Used six
      clearly-labeled placeholder names (Web Development, Mobile
      Development, Design & Branding, Digital Marketing, Consulting &
      Strategy, Managed Support) in both server.js (SERVICE_LINES, for
      validation) and public/index.html (SERVICE_LINES, for the UI).
      Swapping in the real names is a one-line array edit in each file —
      nothing else in the flow depends on the specific values.
- [ ] Design note: the user described the current site as "premium
      glassmorphism blue/purple" — the actual current design (verified
      directly) is navy-blue + gold accent, solid cards, no purple, no
      glassmorphism beyond one trivial blur(2px) on a small badge. Built
      everything new to match what's actually there rather than introduce
      an unimplemented look.

## Phase 3 detail
- [x] Clean provider abstraction (payments/index.js selects noop or payu by
      PAYMENT_PROVIDER env var — same pattern as db/index.js, storage/index.js)
- [x] Noop provider is the safe default — every method fails clearly
      (PAYMENT_NOT_CONFIGURED) rather than faking success; this is what
      "no fake payment success" means in code, not just a promise
- [x] PayU adapter — hash formulas verified against docs.payu.in this
      session (request hash, reverse/response hash, and the General API
      hash for the Verify Payment reconciliation call). No credentials
      hardcoded; PAYU_MERCHANT_KEY/SALT/BASE_URL/SUCCESS_URL/FAILURE_URL/
      VERIFY_URL all come from env and are unset in this environment
- [x] Order/payment states are server-controlled — payments/orderState.js
      defines every allowed transition explicitly; a terminal state
      (paid/failed/cancelled) can never move to a different status
      afterward, closing off duplicate/delayed/spoofed-webhook downgrades
- [x] Never trusts browser-side "payment success" — the only path that can
      set paymentStatus: paid is the signature-verified webhook handler;
      no client-facing endpoint accepts a payment-status value at all
- [x] Idempotent payment operations — webhook events are recorded via an
      atomic record-or-throw against a UNIQUE(provider, event_id)
      constraint (same pattern as the duplicate-email fix), so a
      redelivered webhook is a clean no-op, not a double-processed event
- [x] Handles pending/processing/success/failure/cancellation — PayU's
      success/failure/pending/cancel statuses are normalized into
      paid/failed/processing/cancelled; an unrecognized status always
      maps to failed, never paid
- [x] Extra reconciliation step (PayU's own "Verify Payment" API, which
      PayU's docs strongly recommend using rather than trusting the
      webhook status alone) — corroborates before accepting a "paid"
      transition; optional (PAYU_VERIFY_URL), degrades safely to
      signature-only verification if unset
- [x] Checkout still creates paymentStatus: pending — unchanged from Phase 2
- [x] Quotes remain fully separate — payments module is never invoked from
      the /api/quotes code path
- [ ] Not done: an actual live PayU merchant account, sandbox testing
      against PayU's real test environment, and a frontend flow that
      redirects the buyer through the hosted checkout / handles
      success+failure return URLs — all blocked on real PayU credentials,
      which were explicitly not requested or fabricated this session

## Phase 2 detail
- [x] Products — storefront now fetches real data from GET /api/products
      (was a hardcoded 13-item mock array)
- [x] Categories — real category values wired through (with a safe
      fallback for category:'other', which the backend allows)
- [~] Search/filtering/sorting — wired to real product data; "sort by
      popularity" will read as roughly unsorted until a real reviews
      feature exists (rating/reviews honestly default to 0, not faked)
- [x] Cart — wired to real product IDs (was already ID-keyed, so this
      mostly fell out of the data-source change)
- [x] Checkout — now requires login (real orders require auth); "Pay Now"
      creates a real order via POST /api/orders, paymentStatus: pending;
      no fake order IDs, no PayU integration/simulation
- [x] Orders — creation wired to real backend; duplicate-submission guard
      added (30s window, same buyer+items+total → returns existing order)
- [x] Order history — GET /api/orders (buyer's own orders) added
- [ ] Buyer account page — [x] now covered by the My Orders modal (see below)
- [x] Digital delivery access control — paid buyers can retrieve files attached to products in their paid orders
- [x] Admin product management UI — already existed (dashboard, approve/
      reject listings) — my earlier note calling this "not built yet" was
      wrong, corrected this session
- [x] Admin order management UI — the Orders data was already being
      fetched by admin.html but never rendered (a real, silent gap); added
      an Orders table this session
- [~] Customer management — users list already existed in admin.html
      (view-only, no promote/demote from the UI — intentional, matches the
      CLI-only admin bootstrap design from Phase 1)
- [x] Buyer order history UI — added an "Account" → My Orders modal on
      the storefront, wired to GET /api/orders (previously the Account
      button just showed a toast; the backend endpoint existed with no UI)
- Quotes/services (/api/quotes) — untouched, remains separate from the
  product checkout flow, as instructed

## Phase 1 detail
- [x] Authentication (register/login, bcrypt(12), JWT HS256)
- [x] Admin/buyer separation (server-side role checks, no client-trust)
- [x] JWT security (algorithm pinned, prod hard-fails on default secret)
- [x] Registration security (buyer-only, no first-user-admin path)
- [x] Race-condition protection (duplicate-email registration, both
      adapters; duplicate order submission, 30s window)
- [x] Rate limiting (auth endpoints, quote endpoint)
- [x] CORS (opt-in allowlist, no wildcard default)
- [x] Security headers (helmet + real CSP, object/frame/base-uri locked
      down; imgSrc allows picsum.photos, the placeholder-image CDN the
      storefront actually uses)
- [x] Input validation (email format, field length caps, category
      allow-list)
- [x] Safe error handling (generic messages in production, no stack
      leaks; multer/validation errors surfaced as clean 400s)
- [x] Secure uploads (admin-only, size-capped, MIME/extension allow-list)
- [x] Digital-file access control — GET /api/files/:fileId now requires a paid order containing the product attached to that file; admins retain access.
      The existing product.fileName + order item product ID relationship is used, so no destructive schema migration is required.
- [x] Audit logging (product/order/upload/quote events, failed logins,
      admin creation/promotion via CLI script)
- [x] Production configuration (env-driven, safe defaults, trust proxy)
- [x] Secrets management (env vars only, .env gitignored, no secrets in repo)

## Finishing-touch additions — 2026-09-19

- [x] Added optional `payhipUrl` to products with validation and PostgreSQL migration support.
- [x] Product detail Buy action opens the configured Payhip checkout URL when present.
- [x] Admin product management can attach/detach a stored file ID and configure/clear a Payhip product URL.
- [x] Added PayU transaction-reference matching before payment state changes.
- [x] PayU hosted checkout CSP now permits the official secure PayU payment endpoint.
- [x] Seller listing form now creates a real pending product instead of showing a demo-only success message.
- [x] Storefront/admin monetary labels updated to INR (₹).
- [ ] Real MN Group product catalog, product files, Payhip URLs, and official six service-line names still require business-owner data.
