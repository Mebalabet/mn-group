// Builds the only data the AI provider ever sees beyond the fixed system
// prompt and the customer's own message history. Everything here is public
// information a visitor could already see on the storefront — nothing
// requires a login, and nothing here is a secret.
//
// Reuses the existing db.listApprovedProducts() safe read path (same one
// GET /api/products uses) instead of touching the raw store or db.json
// directly, so this file can never accidentally surface a field the public
// product API itself doesn't already expose.

const db = require('../db');

// Mirrors the service-line slugs/labels used elsewhere: SERVICE_LINES in
// server.js (quote-request validation) and the SERVICE_LINES array in
// public/index.html (the "Services" quote-request UI). All three must
// agree on the six slugs — this file adds nothing new, it just gives the
// same six a human-readable blurb for the assistant to draw on, same as
// the frontend copy already does for display.
const SERVICE_LINES = [
  { id: 'web-development', label: 'Web Development', blurb: 'Custom websites and web applications built to your spec.' },
  { id: 'mobile-development', label: 'Mobile Development', blurb: 'Native and cross-platform mobile apps for iOS and Android.' },
  { id: 'design-branding', label: 'Design & Branding', blurb: 'Brand identity, UI/UX design, and visual design systems.' },
  { id: 'digital-marketing', label: 'Digital Marketing', blurb: 'SEO, paid campaigns, and growth strategy.' },
  { id: 'consulting-strategy', label: 'Consulting & Strategy', blurb: 'Technical advisory and product strategy engagements.' },
  { id: 'managed-support', label: 'Managed Support', blurb: 'Ongoing maintenance, support, and monitoring.' },
];

// Cap how much product data goes into every single AI call — this is a
// cost/token control, not a security one (the full approved-products list
// is already public via GET /api/products regardless of this cap).
const MAX_PRODUCTS_IN_CONTEXT = 40;
const MAX_DESC_LENGTH = 240;

async function buildSupportContext() {
  const products = await db.listApprovedProducts();

  const publicProducts = products.slice(0, MAX_PRODUCTS_IN_CONTEXT).map((p) => ({
    name: p.name,
    description: (p.description || '').slice(0, MAX_DESC_LENGTH),
    price: p.price,
    category: p.category || 'other',
    sellerName: p.sellerName || 'MN Group',
    // Deliberately excluded: id, sellerId, fileName, payhipUrl, status,
    // createdAt — none of these are needed to answer a customer's public
    // question, and the assistant has no use for internal identifiers.
  }));

  const categories = [...new Set(publicProducts.map((p) => p.category))].sort();

  return {
    marketplaceName: 'MN Group',
    marketplaceDescription: 'A marketplace for practical digital products, software tools, and technology services — software licenses, templates, courses, design assets and freelance services, with digital delivery.',
    howBuyingWorks: 'A customer creates an account, adds a product to their cart, and checks out. Paid digital products become available to download from the customer\'s account after payment is confirmed.',
    howToRequestService: 'A customer can request a quote for one of the service lines below through the site\'s "Request a quote" flow, describing what they need; MN Group follows up with a quote.',
    categories,
    products: publicProducts,
    services: SERVICE_LINES,
    // NOTE: MN Group's publicly displayed phone number and "Chat on
    // WhatsApp" button are known, confirmed placeholders/non-functional
    // as of this writing (not a real assigned number, and no WhatsApp
    // link exists anywhere in the codebase) — see the site's contact
    // strip and floating WhatsApp button. Deliberately NOT included here:
    // feeding a known-fake number into the assistant's context would
    // make it state that number as fact. Once real contact details are
    // confirmed and fixed in public/index.html, add them here as e.g.
    // `contactEmail` / `contactPhone` / `whatsappNumber` fields so the
    // assistant can reference them.
  };
}

module.exports = { buildSupportContext };
