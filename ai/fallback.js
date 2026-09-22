// Deterministic, no-cost MN Group support fallback.
//
// This module intentionally answers only from the supplied public business
// facts and public catalog context. It is not an LLM and must never invent
// business information or expose private records.

const MAX_REPLY_LENGTH = 1200;

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value, max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function statusValue(node) {
  return node && node.status === 'confirmed' ? node.value : null;
}

function hasAny(q, terms) {
  return terms.some(term => q.includes(term));
}

function categoryLabel(category) {
  return String(category || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function productLines(products) {
  return products.slice(0, 8).map(p => {
    const price = typeof p.price === 'number'
      ? ` — ${p.price.toLocaleString('en-IN')}`
      : '';
    return `• ${clean(p.name, 100)}${price}`;
  }).join('\n');
}

function findProduct(query, catalog) {
  const products = Array.isArray(catalog) ? catalog : [];
  const exact = products.find(p => {
    const name = normalize(p.name);
    return name && (query.includes(name) || name.includes(query));
  });
  if (exact) return exact;

  const words = query.split(' ').filter(w => w.length >= 3);
  if (!words.length) return null;
  return products.find(p => {
    const name = normalize(p.name);
    return words.filter(w => name.includes(w)).length >= Math.min(2, words.length);
  }) || null;
}

function fallbackReply(message, context = {}) {
  const query = normalize(message);
  const facts = context.businessFacts || {};
  const catalog = Array.isArray(context.catalog) ? context.catalog : [];

  if (!query) {
    return 'I can help with MN Group products, categories, services, quotes, buying, digital delivery, and seller guidance. What would you like to know?';
  }

  // Never provide private/internal information, even if a user asks for it.
  if (hasAny(query, [
    'ignore previous', 'ignore all instructions', 'ignore your instructions', 'jailbreak',
    'system prompt', 'system instruction', 'api key', 'merchant key',
    'merchant salt', 'jwt', 'password', 'secret', 'database', 'db.json',
    'customer records', 'customer data', 'customer orders', 'order records', 'payment records',
    'all orders', 'private information', 'private data', 'seller ids', 'all users', 'user data', 'admin data', 'credentials', 'token',
    'user ids', 'order id', 'payment id', 'internal files', 'internal path'
  ])) {
    return 'I can help with public MN Group information, products, services, buying, quotes, digital delivery, and seller guidance, but I cannot provide private records, credentials, payment data, or internal system information.';
  }

  const identity = statusValue(facts.identity?.description);
  if (hasAny(query, ['what is mn group', 'what does mn group do', 'about mn group', 'tell me about mn group'])) {
    return identity
      ? `MN Group is ${identity}`
      : 'MN Group business information is not currently confirmed.';
  }

  const categories = Array.isArray(facts.categories?.values) && facts.categories.status === 'confirmed'
    ? facts.categories.values
    : [];
  if (hasAny(query, ['categories', 'category', 'what can i buy', 'what do you sell', 'products and services'])) {
    return categories.length
      ? `MN Group currently has these categories: ${categories.map(categoryLabel).join(', ')}.`
      : 'MN Group category information is not currently confirmed.';
  }

  if (hasAny(query, ['physical products', 'physical product', 'shipping', 'ship products'])) {
    return facts.products?.physicalProducts?.status === 'not_available'
      ? 'Physical products and shipping are not currently available in the confirmed MN Group information.'
      : 'Information about physical products and shipping is not currently confirmed.';
  }

  if (hasAny(query, ['digital products', 'digital product'])) {
    return facts.products?.digitalProducts?.status === 'confirmed' && facts.products.digitalProducts.value
      ? 'Yes. MN Group offers digital products.'
      : 'Digital-product availability is not currently confirmed.';
  }

  if (hasAny(query, ['available products', 'list products', 'show products', 'what products are available'])) {
    if (!catalog.length) return 'There are no approved products in the currently available public catalog.';
    return `Here are some currently available products:\n${productLines(catalog)}`;
  }

  const categoryMatch = categories.find(c => {
    const label = normalize(c);
    return query.includes(label) || query.includes(`${label} products`);
  });
  if (categoryMatch && hasAny(query, ['product', 'show', 'available', 'in ', 'category'])) {
    const matches = catalog.filter(p => normalize(p.category) === normalize(categoryMatch));
    if (!matches.length) return `I couldn't find any approved products in the ${categoryLabel(categoryMatch)} category in the current public catalog.`;
    return `Products currently listed in ${categoryLabel(categoryMatch)}:\n${productLines(matches)}`;
  }

  const product = findProduct(query, catalog);
  if (product && hasAny(query, ['price', 'cost', 'how much', 'tell me about', 'details', 'product', 'what is'])) {
    const parts = [`${clean(product.name, 160)} is listed in the ${categoryLabel(product.category)} category.`];
    if (typeof product.price === 'number') parts.push(`The listed price is ${product.price.toLocaleString('en-IN')}.`);
    if (product.description) parts.push(clean(product.description, 400));
    if (product.deliveryMethod === 'native_download') parts.push('This product is configured for MN Group native digital delivery.');
    else if (product.deliveryMethod === 'external_payhip') parts.push('This product is configured with an external Payhip delivery link.');
    return parts.join(' ');
  }

  if (hasAny(query, ['how do i buy', 'how to buy', 'how can i buy', 'purchase', 'checkout'])) {
    return 'You can create an account, add products to your cart, and proceed to checkout. An order remains pending until payment is confirmed.';
  }

  if (hasAny(query, ['delivery', 'download', 'receive my product', 'digital delivery'])) {
    return 'Digital delivery depends on the product configuration. Some products use MN Group native digital delivery when a valid downloadable file is configured, while some may use an external Payhip purchase/delivery link. Exact delivery details are not confirmed for every product.';
  }

  if (hasAny(query, ['service', 'services'])) {
    if (facts.services?.quoteBased?.status === 'confirmed' && facts.services.quoteBased.value) {
      return 'MN Group services are quote-based. The specific official service lines are not yet confirmed in the public business information, so I will not invent service names or prices.';
    }
    return 'MN Group service information is not currently confirmed.';
  }

  if (hasAny(query, ['custom work', 'custom project', 'custom development', 'custom requirement'])) {
    return 'Custom requirements can be submitted through the MN Group quote request process.';
  }

  if (hasAny(query, ['quote', 'quotation', 'request a quote', 'quote request'])) {
    return 'The quote process is: submit a request describing your requirement, MN Group reviews it, a quote may be provided, and the request can then proceed through the applicable quote workflow.';
  }

  if (hasAny(query, ['course', 'courses', 'learning'])) {
    return 'Courses are an MN Group category. The currently confirmed information does not include an LMS, certificates, or progress tracking, so I will not claim those features.';
  }

  if (hasAny(query, ['seller', 'sell on mn group', 'become a seller', 'start selling', 'submit product'])) {
    return 'Logged-in users can submit products. Normal registration creates a buyer account; seller/admin privileges are not granted simply because someone is the first registered user. Non-admin product submissions require administrative approval before appearing in the approved catalog.';
  }

  if (hasAny(query, ['approve product', 'product approval', 'approved before'])) {
    return 'Yes. Non-admin product submissions require administrative approval before they appear in the approved catalog.';
  }

  if (hasAny(query, ['payment', 'payu', 'refund', 'refunds', 'dispute'])) {
    return 'MN Group payment-processing, PayU, refund, and dispute details are not currently confirmed in the public AI knowledge layer. Please rely on the checkout and published policies for current information.';
  }

  return 'I can help with MN Group products, categories, services, custom work, quotes, buying, digital delivery, and seller guidance. I do not have confirmed information to answer that specific question yet.';
}

module.exports = {
  fallbackReply,
  normalize,
  MAX_REPLY_LENGTH
};
