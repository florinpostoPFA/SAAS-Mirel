/**
 * Deterministic brand extraction from user messages (v1 — exact lexicon, no fuzzy match).
 */

const BRAND_LEXICON = [
  "Koch Chemie",
  "Gtechniq",
  "Gyeon",
  "Ewocar",
  "ADBL",
  "Ma-Fra",
  "Meguiar's",
  "Sonax",
  "ZviZZer",
  "ChemicalGuys",
  "Rupes",
  "Labocosmetica"
].sort((a, b) => b.length - a.length);

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} message
 * @returns {string|null} canonical brand label from lexicon
 */
function extractBrandFromMessage(message) {
  const text = String(message || "");
  if (!text.trim()) {
    return null;
  }

  for (const brand of BRAND_LEXICON) {
    const pattern = new RegExp(
      `(?:^|[^A-Za-z0-9])${escapeRegExp(brand)}(?:[^A-Za-z0-9]|$)`,
      "i"
    );
    if (pattern.test(text)) {
      return brand;
    }
  }

  return null;
}

/**
 * @param {object} product
 * @param {string} brand canonical label
 * @returns {boolean}
 */
function productMatchesBrand(product, brand) {
  const canonical = String(brand || "").trim();
  if (!canonical) {
    return true;
  }

  const productBrand = String(product?.brand || "").trim();
  if (productBrand && productBrand.toLowerCase() === canonical.toLowerCase()) {
    return true;
  }

  const pattern = new RegExp(
    `(?:^|[^A-Za-z0-9])${escapeRegExp(canonical)}(?:[^A-Za-z0-9]|$)`,
    "i"
  );
  const name = String(product?.name || "");
  return pattern.test(name);
}

module.exports = {
  BRAND_LEXICON,
  extractBrandFromMessage,
  productMatchesBrand
};
