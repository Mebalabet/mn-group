# 2026-09-19 — Finishing-touch release

- Added validated Payhip product URLs and PostgreSQL schema support.
- Added admin controls for product file attachment and Payhip URL management.
- Added PayU transaction-reference matching to webhook processing.
- Allowed the official PayU hosted checkout endpoint in CSP.
- Made seller product submission create a real pending listing.
- Updated storefront/admin monetary display to INR.
- Preserved existing protected digital-download authorization and payment state-machine work.

# Changelog

## 2026-09-12 — Phase 1 security hardening (session 3)
**Files changed:** server.js, scripts/create-admin.js
**Changed:**
- Added a real Content-Security-Policy (was fully disabled) — script/style
  still allow inline (frontend uses inline scripts/onclick, unreworked),
  but object-src, base-uri, and frame-ancestors are now locked down.
- Added email-format + length-cap validation to registration, login intake,
  quotes, and product creation; added a category allow-list to product
  creation (verified against actual seeded/used categories first).
- Added audit-log entries for failed login attempts, quote submissions, and
  admin creation/promotion via the CLI script.
**Tested:** STATIC VERIFIED — node --check on all changed files, manual
  code-path review, category allow-list cross-checked against seedData.js
  and data/db.json. NOT TESTED live (sandbox has no network access).
**Not changed:** GET /api/files/:fileId ownership check — explicitly held
  pending user approval (requires order-to-file schema change).
**Result:** data/db.json untouched; only the two listed files differ from
  the prior backup.

## 2026-09-12 — Phase 1 security audit (session 2)
**Files changed:** server.js, config.js, db/jsonStore.js, db/pgStore.js,
  README.md, .env.example, public/index.html
**Changed:**
- Fixed stale "first account becomes admin" claims in README, .env.example,
  and the live registration modal (was showing users false info).
- Removed unused ADMIN_EMAIL config (dead code).
- Closed a duplicate-email registration race (bcrypt.hash created an await
  gap between the pre-check and insert) in both DB adapters, mapped to a
  clean 409.
- Pinned JWT algorithm to HS256 explicitly on sign/verify.
- Added rate limiting to the public /api/quotes endpoint (previously none).
**Tested:** STATIC VERIFIED only (node --check, diff against backup). Live
  test script (live-security-test.sh) delivered for user to run in Termux.
**Result:** data/db.json untouched.

## 2026-09-11/12 — Prior security work (from handoff, verified in code)
- Public registration hardcoded to buyer role; first-user-admin path removed.
- scripts/create-admin.js added for controlled admin bootstrap.
- promoteUserByEmail added to both DB adapters.
- Production JWT secret configured; hard-fail on default secret in prod.
- Admin login verified to return role: admin.
- Unauthenticated /api/admin/dashboard verified to return 401.

## 2026-09-12 — Phase 1 completion + Phase 2 start (session 4)
**Files changed:** server.js, db/jsonStore.js, db/pgStore.js
**Changed:**
- Added upload MIME/extension allow-list (admin-only endpoint, defense-in-
  depth) via multer fileFilter; mapped its rejection + multer's own errors
  (e.g. file-too-large) to clean 400s instead of a hidden generic 500.
- Added GET /api/orders (buyer's own order history) + listOrdersByBuyer in
  both DB adapters — buyers could previously create orders but never see
  them again; only admins could list orders.
**Tested:** STATIC VERIFIED only (node --check, diff against backup).
**Result:** data/db.json untouched.

### Finding — not yet acted on, needs a decision
public/index.html's storefront (product grid, search/filter/sort, cart,
checkout) runs entirely on a hardcoded 13-item `const PRODUCTS = [...]`
array in the frontend — it never calls GET /api/products, and "Pay Now"
generates a fake client-side order ID (`completeOrder()`) without ever
calling POST /api/orders. The checkout UI itself is honest about this
("This is a demo checkout — no real payment is processed"), so this looks
like intentional placeholder state pending Phase 3, not a bug — but it
means the real backend's product/order APIs (already built and audited)
are currently disconnected from the live site. Reconnecting this is real
Phase 2 scope (not cosmetic), but touches a business-rule decision: should
checkout create a real order (paymentStatus: pending) now, ready for PayU
to fill in later, or wait until Phase 3? Flagged to the user rather than
assumed.

## 2026-09-12 — Phase 2: real storefront wiring (session 5)
**Files changed:** public/index.html, server.js
**Decision (user-approved):** proceed with real backend order creation now;
  reconnect storefront to live product data; do not integrate/simulate PayU.
**Changed:**
- Replaced the hardcoded 13-item mock `PRODUCTS` array with a real fetch
  from GET /api/products, via a normalizeProduct() adapter (maps
  category→cat, description→desc, sellerName→seller; rating/reviews
  default to 0 — not fabricated, there's no reviews feature yet).
- Fixed "sort by new" (previously parsed a numeric suffix out of mock IDs
  like 'p1' — silently broken on real UUID ids) to sort by real createdAt.
- Replaced hardcoded NEW_IDS mock-id list with a real createdAt-based
  "new" check.
- Guarded two category-label lookups that would throw on category:'other'
  (a value the backend allows as a default but the frontend's curated
  category list didn't include).
- Added a loading/error/no-matches distinction on the product grid's empty
  state (previously always said "No matches", which is misleading during
  initial load or a fetch failure).
- Checkout now requires login before opening (POST /api/orders requires
  auth; guest checkout can't create a real order under the current schema).
- "Pay Now" now calls POST /api/orders with real product ids/qty, creating
  a real order with paymentStatus: pending. No client-generated fake order
  ID, no PayU integration/simulation, no browser-side "paid" marking.
- Fixed a pre-existing bug: the confirmation screen read from the cart
  after it had already been cleared (always showed $0.00 / no items) —
  now reads the real order object returned by the API.
- Confirmation copy corrected to honestly state payment is pending, not
  processed ("Order placed — payment pending" / "Amount due (pending)"
  instead of "Order confirmed" / "Total paid" / claiming download links
  were already sent).
- Added a server-side duplicate-submission guard on order creation
  (identical items+total from the same buyer within 30s returns the
  existing order instead of creating a second one) — no schema change,
  reuses listOrdersByBuyer.
- Fixed a CSP regression from the prior session: product/category/
  testimonial images load from picsum.photos, which the CSP's imgSrc
  didn't allow yet — would have silently broken every image on the page.
- Quotes (/api/quotes) untouched — remain fully separate from product
  checkout, as instructed.
**Tested:** STATIC VERIFIED only — node --check on server.js and both
  extracted inline <script> blocks from index.html; manual review of every
  field the mock data provided (rating/reviews/specs/cat/desc/seller) to
  confirm graceful handling of real API data; category allow-list and
  labels cross-checked against actual CATEGORIES/CAT_COLOR definitions.
  NOT TESTED live — this sandbox still has no network access, so the
  actual fetch/checkout/order flow has not been exercised in a browser.
**Not changed:** GET /api/files/:fileId ownership check — still held.
**Result:** data/db.json untouched; only public/index.html and server.js
  differ from the pre-session backup.

## 2026-09-12 — Phase 2 continued: admin orders + buyer order history (session 6)
**Files changed:** public/admin.html, public/index.html
**Correction:** my prior session's finding "admin product/order management UI —
  not built yet" was wrong. admin.html already had a full working admin
  panel (dashboard, listing approvals, users, quotes, audit log) wired to
  the real API — I mischaracterized it from a line-count glance instead of
  reading its content. Corrected in PROJECT-STATUS.md.
**Real gap found and fixed:** admin.html fetched orders via
  Promise.all(...) but never rendered them anywhere — the data was
  silently dropped. Added an Orders table (order id, buyer, items, total,
  payment status, date) matching the existing table style.
**Added:** buyer-facing "My Orders" — a modal on the storefront (same
  pattern as the existing checkout/sell modals) fetching GET /api/orders.
  Wired the "Account" button for non-admin users to open it (previously
  just showed a toast with their name; admins still go to /admin.html).
**Tested:** STATIC VERIFIED only — node --check on both extracted
  index.html script blocks and the extracted admin.html script; grepped
  reference counts for ordersModal/openMyOrders to confirm no dangling
  refs. NOT TESTED live (still no network access in this sandbox).
**Not changed:** GET /api/files/:fileId ownership check — still held.
**Result:** data/db.json untouched; only admin.html and index.html differ
  from the pre-session backup.

## 2026-09-12 — Phase 3: payment abstraction layer (session 7)
**Files changed:** config.js, server.js, db/jsonStore.js, db/pgStore.js,
  db/schema.sql
**Files added:** payments/index.js, payments/noopProvider.js,
  payments/payuProvider.js, payments/orderState.js
**Decision (user-approved):** build the payment abstraction only — no PayU
  credentials, no simulated success, keep checkout creating pending orders.
**Research:** verified PayU's hash formulas and webhook/reconciliation API
  shapes against current docs.payu.in via web search this session (request
  hash, reverse/response hash, General API hash, Verify Payment endpoint
  and fields) — not from training-data memory alone.
**Added:**
- Provider abstraction (payments/index.js) selecting noop or payu via
  PAYMENT_PROVIDER env var, mirroring db/index.js's pattern.
- Noop provider: the default when unconfigured — every method fails
  clearly (PAYMENT_NOT_CONFIGURED) rather than faking success.
- PayU adapter: createPaymentSession (hosted-checkout redirect + signed
  form fields), verifyWebhookSignature (constant-time reverse-hash check),
  parseWebhookEvent (normalizes PayU's status vocabulary), and
  verifyPaymentStatus (optional server-to-server reconciliation, per
  PayU's own recommendation not to trust the webhook status alone).
- Order state machine (payments/orderState.js): explicit allowed
  transitions only; paid/failed/cancelled are terminal and can never be
  overwritten by a later event.
- POST /api/orders/:id/pay (auth, ownership-checked) — initiates a payment
  attempt; 503 if no provider configured, 409 if the order isn't
  pending/processing.
- POST /api/payments/webhook/:provider (public — webhooks are
  server-to-server, can't carry a JWT) — the only path that can ever set
  paymentStatus: paid. Verifies signature, corroborates "paid" claims via
  verifyPaymentStatus when configured, records the event idempotently,
  applies the transition only if the state machine allows it.
- Order schema gained payment_provider/payment_ref/payment_updated_at
  (all nullable, additive); new payment_events table with
  UNIQUE(provider, event_id) for idempotency. jsonStore backfills existing
  orders with null values for the new fields — no data loss.
- db/schema.sql updated with the same additive columns/table (ADD COLUMN
  IF NOT EXISTS / CREATE TABLE IF NOT EXISTS throughout — safe to re-run
  against an existing database, matching the file's existing contract).
**Idempotency fix during implementation:** the first draft used a
  separate hasProcessedPaymentEvent check before recordPaymentEvent — the
  same race class as the duplicate-email bug fixed earlier this project.
  Replaced with an atomic record-or-throw (DUPLICATE_PAYMENT_EVENT),
  backed by the database's own UNIQUE constraint for the Postgres adapter.
**Tested:**
- PASS (actually executed, not just reviewed): DB layer payment functions
  (findOrderById, updateOrderPayment, recordPaymentEvent + duplicate
  rejection) run against a throwaway copy of the real data — never against
  the live file. Payments module provider-selection logic (noop default,
  payu-without-credentials refusal) executed directly. PayU hash math
  cross-checked by independently computing the reverse hash with the same
  formula from a separate code path and confirming it matches the
  provider's own verifyWebhookSignature — including a tamper case
  (modified amount, same hash) correctly failing. All 11 order-state
  transition cases (valid and invalid) executed and passed.
- STATIC VERIFIED: node --check on every changed/added file.
- NOT TESTED: anything requiring a real PayU sandbox account (actual
  hosted-checkout redirect, a real webhook delivery, the Verify Payment
  API against PayU's actual servers) — impossible without real
  credentials, which were deliberately not created or requested.
**Not changed:** GET /api/files/:fileId ownership check — still held.
**Result:** data/db.json confirmed byte-identical to the pre-session
  backup throughout (checked after every DB-layer test).

## 2026-09-13 — Phase 4: B2B quote workflow (session 8)
**Files changed:** server.js, db/jsonStore.js, db/pgStore.js, db/schema.sql,
  public/admin.html, public/index.html
**Files added:** quoteState.js
**Decision (user-approved):** build the full quote workflow now, keeping
  it independent from /api/orders/:id/pay; extend existing abstractions
  rather than build parallel ones; preserve the current design as-is.
**Inspection findings before building (as instructed):**
- "Services" was only a product category, sellable via the same cart/
  checkout as any other product — no dedicated service-line concept
  existed anywhere in the code.
- The "Request custom work" flow (openSell(e, true)) was a complete
  client-side fake — it never called /api/quotes, just showed a toast.
  Same disconnected-mock pattern found and fixed for checkout in Phase 2.
- MN Group's real six service line names are not present anywhere in this
  codebase and were not provided this session — used six clearly-labeled
  placeholder names instead (one-line swap later, not a re-architecture).
- The actual current design is navy-blue + gold accent, solid cards — not
  glassmorphism, no purple anywhere (checked directly). Built everything
  new using the existing actual design, not the described-but-unbuilt one.
**Added:**
- quoteState.js: explicit quote status transitions (new → reviewing →
  quoted → accepted → closed, declined reachable from new/reviewing/
  quoted), same pattern as payments/orderState.js but a separate module.
- db/schema.sql: quotes table extended (user_id, company, service_line,
  timeline, customer_message, internal_note, updated_at) — additive,
  IF NOT EXISTS throughout, matching the Phase 3 migration's contract.
- Both DB adapters: findQuoteById, listQuotesByUser, updateQuote, mirroring
  the exact order/payment function shapes already established.
- POST /api/quotes: now takes company/serviceLine/timeline in addition to
  name/email/details/budget; serviceLine required and validated against
  SERVICE_LINES; uses new optionalAuth middleware to associate the quote
  with an account when the requester is logged in, without requiring login
  (guests can still submit, matching prior behavior).
- GET /api/quotes: a logged-in customer's own quote requests, mirroring
  GET /api/orders — strips internalNote before returning.
- PATCH /api/admin/quotes/:id: status transitions validated against
  quoteState.js; can also set customerMessage/internalNote independently
  of a status change.
- admin.html: extended the existing (already-working, not previously
  identified as a stub) Quotes table with service/company/budget/timeline/
  status columns and per-status action buttons (mirrors the product-
  approval button pattern already used), plus Message/Note actions.
- index.html: real services grid (reuses .cat-tile, no new CSS), service
  detail + quote form wired to POST /api/quotes with real loading/error
  handling, replacing the fake toast-only mock. Added an esc() helper
  (mirroring admin.html's) for the new interpolations only — not
  retrofitted onto pre-existing unescaped rendering elsewhere in the file.
**Bug caught and fixed during implementation:** a str_replace edit meant
  to add a second init call accidentally deleted renderCatGrid()'s forEach
  closing lines and function-closing brace, breaking index.html's syntax
  entirely. Caught by node --check before delivery, root-caused via diff
  against the pre-session backup, and fixed by restoring the deleted lines.
**Tested:**
- PASS (actually executed): quote DB layer (insertQuote, findQuoteById,
  listQuotesByUser — including the "wrong user finds nothing" case,
  updateQuote across multiple sequential status/message/note changes) run
  against a throwaway copy of the real data, never the live file. All 16
  quote state-transition cases (valid and invalid) executed and passed.
  Email-regex and service-line allow-list validation logic tested in
  isolation against valid/invalid/empty/undefined inputs.
- STATIC VERIFIED: node --check on every changed/added file, including
  both extracted <script> blocks from index.html and the extracted script
  from admin.html (this is what caught the syntax-breaking bug above).
- NOT TESTED: the actual Express route handlers (POST/GET /api/quotes,
  PATCH /api/admin/quotes/:id) end-to-end — this sandbox has no
  node_modules and no network to install them, so server.js itself cannot
  be executed here, only statically reviewed and syntax-checked. The
  storefront UI (service grid, quote form, admin table rendering) has not
  been exercised in an actual browser.
**Not changed:** GET /api/files/:fileId ownership check — still held.
**Result:** data/db.json confirmed byte-identical to the pre-session
  backup, checked after every DB-layer test this session.

### Addendum (continuation of session 8, after a context checkpoint)
- Completed the renderServiceGrid() wiring into page init (was mid-edit
  when the previous response ended) — confirmed via view that the
  intended edit had actually already succeeded.
- Full syntax sweep re-run across every backend file and both index.html
  script blocks: all pass.
- Additional functional tests executed against a fresh throwaway copy of
  the real data: insertQuote (guest and account-associated), listQuotesByUser
  correctly scoped per user, updateQuote applied across sequential
  status/customerMessage/internalNote changes, and — specifically — the
  exact destructuring transform GET /api/quotes uses
  (`({ internalNote, ...q }) => q`) verified to actually remove the field
  while leaving every other field intact.
- data/db.json reconfirmed byte-identical to the pre-Phase-4 backup after
  this additional round of tests.

## 2026-09-13 — Phase 5: admin platform visibility (session 8)
**Files changed:** server.js, db/jsonStore.js, db/pgStore.js, public/admin.html
**Files NOT changed:** public/index.html (storefront) — deliberately untouched
  per instruction to preserve existing frontend structure and defer the
  glassmorphism redesign to its own phase.
**Decision (user-directed):** proceed with Phase 5 (admin platform) before
  the visual redesign; do not invent the six service lines or a design
  reference; freeze everything else exactly as implemented.
**Inspected before building:** admin.html already covered dashboard/users/
  products/orders/quotes/audit logs. Genuine gaps against the original
  Phase 5 checklist were: payments visibility (webhook events were
  recorded but never displayed), digital files (no inventory view), and
  business metrics (dashboard only had raw counts, no revenue/pending/
  quote-breakdown). "Secure administrative actions" was already satisfied
  — every admin route was already server-gated; nothing needed changing
  there, just confirmed.
**Added:**
- Dashboard (GET /api/admin/dashboard) extended with revenue (sum of paid
  orders' totals), pendingPayments (orders still pending/processing), and
  quotesByStatus (counts per status) — computed from existing list
  functions, no schema change.
- GET /api/admin/payment-events (admin-only) + listAllPaymentEvents in
  both DB adapters — makes the payment_events table (write-only since
  Phase 3) actually visible.
- admin.html: extended stats grid (revenue/pending-payments/quotes-by-
  status cards), a Payment events table, and a Digital files table.
  Digital files needed no new backend endpoint — derived entirely from
  the products list admin.html already fetches (products already carried
  fileName since Phase 2).
**Tested:**
- PASS (executed against a throwaway data copy, never the real file):
  listAllPaymentEvents (empty case, then populated + most-recent-first
  ordering), the exact revenue/pendingPayments/quotesByStatus aggregation
  logic reproduced line-for-line from server.js against seeded test
  orders/quotes with known expected results (all matched exactly), and
  the digital-files filter logic against representative product shapes.
- STATIC VERIFIED: node --check on every changed file, including all
  extracted <script> blocks from both admin.html and index.html (index.html
  reconfirmed unchanged as part of this sweep).
- NOT TESTED: the actual HTTP routes / browser rendering — still no
  node_modules or network access in this sandbox.
**Not changed:** GET /api/files/:fileId ownership check — still held. The
  six service line names and the design reference — still pending from
  the user, not invented or substituted.
**Result:** data/db.json confirmed byte-identical to the pre-session
  backup, rechecked after the functional tests (which ran only against a
  /tmp copy).

## 2026-09-13 — Phase 6: API stability for mobile (session 9)
**Files changed:** server.js
**Files NOT changed:** public/index.html, public/admin.html, data/db.json —
  all confirmed unchanged; this pass deliberately stayed backend-only,
  since "mobile-responsive behavior" (frontend/CSS) falls under the
  redesign hold still in place.
**Interpreted "continue 6" as Phase 6 (Mobile) from the roadmap** — flagged
  as an assumption; only "6" in context, and its actual ask (API/backend
  prep, not app development) fit what could safely proceed without the
  two still-pending inputs.
**Inspected before building:** "same business logic for web/mobile" was
  already true — a single REST JSON API with no web-specific coupling.
  Error format was already consistent ({error: "..."}) across every route.
  CORS doesn't affect native mobile clients (browser-only mechanism), so
  no change needed there. The one real, concrete gap: every list endpoint
  returned a fully unbounded array — most conspicuously the audit log,
  which grows forever and had no cap at all (admin.html only ever
  displayed 30 of whatever it received).
**Fixed a mistake made while implementing this:** an early edit
  accidentally deleted `async` from the `audit()` helper instead of
  inserting new content beside it — would have turned every `await
  audit(...)` call into an unhandled-rejection risk (errors inside
  db.insertAuditLog would stop propagating through callers' try/catch).
  Caught immediately via diff/sed inspection before running any tests,
  reverted, and confirmed via node --check before proceeding.
**Added:** a shared paginate(res, items, req, defaultLimit) helper —
  response body always stays a plain array (no conditional shape change,
  so the storefront and admin.html keep working exactly as before without
  passing any query params), total count exposed via X-Total-Count header
  instead of the body. Applied to: GET /api/products, GET
  /api/admin/products, GET /api/orders, GET /api/admin/orders, GET
  /api/quotes, GET /api/admin/quotes, GET /api/admin/users, GET
  /api/admin/audit (200-row default cap — the one exception), GET
  /api/admin/payment-events.
**Tested:**
- PASS (executed): the pagination logic itself, extracted and confirmed
  byte-identical to what's actually in server.js, run through 8 cases —
  no-params (matches old unpaginated behavior exactly), explicit limit,
  limit+offset together, over-limit clamping, invalid non-numeric limit
  falling back gracefully, negative offset clamped to zero, and the
  audit-log-style bounded default both under and over the cap.
- STATIC VERIFIED: node --check on every backend file; full sweep of both
  admin.html's and index.html's extracted <script> blocks (confirming
  neither was touched, as instructed).
- NOT TESTED: the actual HTTP query-string parsing / live requests — no
  node_modules or network access in this sandbox, same standing
  limitation as every other phase.
**Not changed:** the file-ownership hold, the six service lines, the
  design reference — none touched, none invented, per explicit instruction.
**Result:** data/db.json and both frontend files confirmed byte-identical
  to the pre-session backup.

## 2026-09-18 — Glassmorphism visual redesign, structure preserved (session 9)
**Files changed:** public/index.html (`<style>` block only)
**Files NOT changed:** everything else — server.js, all backend/DB files,
  admin.html, and the <script> content of index.html itself.
**Reference material:** a screenshot of an approved MN Group UI mockup
  (dark navy + blue/purple/pink gradient branding, frosted glass cards)
  and a separate unrelated HTML file used only for its glassmorphism CSS
  technique (backdrop-filter blur amounts, glass border/background
  tokens, accent palette) — its actual content (a Teachers' Day page) was
  not MN Group material and was not used.
**Deliberately not replicated from the screenshot** (flagged to the user
  rather than assumed): the sidebar navigation layout (existing top-nav
  structure was kept), the stats bar with specific numbers like "8,452
  products / ₹2.45M sales / 12K+ clients" (clearly mockup-tool placeholder
  data, not real MN Group figures — inventing these would violate "do not
  invent business data"), and the mockup's different category names
  (Digital Products/Physical Products/etc. — the real six service lines
  are still pending from the user; existing categories/services were kept
  unchanged).
**What changed:** every CSS custom property in :root and the property
  values of every existing selector — dark radial-gradient navy
  background, translucent glass surfaces (rgba background + backdrop-
  filter: blur) on cards/nav/modals/drawers/tooltips, a blue→purple→pink
  gradient applied to the wordmark, hero accent text, and primary CTAs,
  gold kept as the secondary accent (ratings, "New" ribbons, secondary
  buttons) consistent with the original palette. Every selector name is
  character-for-character identical to before — only property values
  changed, so no class was renamed, added, or removed for the sake of
  this pass, and no id/onclick/JS was touched.
**Verification performed:**
- Diffed both <script> blocks of index.html against the pre-redesign
  backup — byte-identical (confirmed programmatically, not just visually).
- Diffed every id="..." attribute — identical set, none added or removed.
- Diffed every onclick="..." handler in document order — identical.
- node --check on both extracted <script> blocks — pass.
- CSS brace-balance check (281 open / 281 close) — balanced.
- Cross-checked every var(--x) reference in the file against the new
  :root definitions — all resolve (two references intentionally rely on
  their existing CSS fallback value, e.g. var(--blue-hov,#2b5bc4), which
  was already the pattern before this change).
- Confirmed the CSP (styleSrc/fontSrc/imgSrc in server.js, untouched)
  still covers everything this page uses — no new external resource was
  introduced.
**NOT tested:** actual rendering in a browser — this sandbox has no way
  to render/screenshot the page, so visual correctness (contrast, spacing,
  the glass blur actually looking right) could not be confirmed directly,
  only that the CSS is syntactically valid and every token resolves.
**Result:** data/db.json confirmed byte-identical to the pre-session
  backup. Exactly one file changed project-wide.

## 2026-09-20 — Production v2
- Added schema-aware one-time `scripts/import-json-data.js` migration from `data/db.json` to PostgreSQL.
- Preserves existing UUIDs, bcrypt hashes, timestamps, payment metadata, quotes, payment events, audit logs, and product records.
- Migration is transactional, idempotent for matching rows, conflict-detecting, and never modifies `data/db.json`.
- Added `npm run db:import-json`.
