const db = require('../db');
const businessFacts = require('./businessFacts');

function cleanText(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function publicProduct(product) {
  if (!product || typeof product !== 'object') return null;

  const result = {
    name: cleanText(product.name, 160),
    description: cleanText(product.description, 400),
    price: typeof product.price === 'number' ? product.price : null,
    category: cleanText(product.category, 80),
    sellerName: cleanText(product.sellerName, 120)
  };

  let deliveryMethod = 'not_confirmed';

  if (typeof product.fileName === 'string' && product.fileName.trim()) {
    deliveryMethod = 'native_download';
  } else if (typeof product.payhipUrl === 'string' && product.payhipUrl.trim()) {
    deliveryMethod = 'external_payhip';
  }

  result.deliveryMethod = deliveryMethod;

  return result;
}

async function buildSupportContext() {
  const products = await db.listApprovedProducts();

  const catalog = Array.isArray(products)
    ? products
        .map(publicProduct)
        .filter(Boolean)
        .slice(0, 40)
    : [];

  return {
    businessFacts,
    catalog
  };
}

module.exports = {
  buildSupportContext
};
