/**
 * Description-as-knowledge: productSections.json lookup, quotes, anti-rec (knowledge path).
 */
const productSectionsData = require("../data/productSections.json");
const { norm } = require("./sectionExtractor");

const TIER1_BRANDS = new Set(["Koch Chemie", "Gtechniq", "ZviZZer", "Ewocar", "ADBL"]);

/** Customer-facing short names (catalog `name` fields are long Magento titles). */
const HERO_DISPLAY_NAMES = {
  "86001": "Koch Chemie MZR",
  "86011": "Koch Chemie MZR 11L",
  "ADB-TYP": "ADBL Typhoon",
  "ADB-B": "ADBL Bonnet"
};

let catalogById = null;

function getCatalogById() {
  if (catalogById) return catalogById;
  catalogById = new Map();
  const products = require("../data/products.json");
  for (const p of products) {
    if (p?.id) catalogById.set(String(p.id), p);
  }
  return catalogById;
}

function resolveProductDisplayName(sku) {
  const key = String(sku);
  if (HERO_DISPLAY_NAMES[key]) return HERO_DISPLAY_NAMES[key];
  const product = getCatalogById().get(key);
  if (!product) return key;
  return product.name || product.title || key;
}

const SKU_MATCHERS = [
  { sku: "86011", patterns: [/\b86011\b/i, /\b11\s*l\b/i, /mehrzweckreiniger.*11/i] },
  { sku: "86001", patterns: [/\b86001\b/i, /\bmzr\b/i, /mehrzweckreiniger/i, /koch\s+chemie\s+mzr/i] },
  { sku: "ADB-TYP", patterns: [/\badb-typ\b/i, /\btyphoon\b/i, /apc\s+typhoon/i] },
  { sku: "ADB-B", patterns: [/\badb-b\b/i, /\bbonnet\b/i] },
  { sku: "132001", patterns: [/\btop\s+star\b/i] }
];

const ANTI_REC_TRIGGERS = [
  "pot folosi",
  "pot sa folosesc",
  "e sigur",
  "este sigur",
  "compatibil",
  "merge pe",
  "pot sa",
  "e ok pe",
  "este ok pe"
];

const MATERIAL_KEYWORDS = ["piele", "textil", "plastic", "alcantara", "vopsea", "geam", "parbriz"];

let entriesBySku = null;

function loadEntriesBySku() {
  if (entriesBySku) return entriesBySku;
  entriesBySku = new Map();
  const list = Array.isArray(productSectionsData.entries) ? productSectionsData.entries : [];
  for (const entry of list) {
    if (entry?.sku) entriesBySku.set(String(entry.sku), entry);
  }
  return entriesBySku;
}

function getEntry(sku) {
  return loadEntriesBySku().get(String(sku)) || null;
}

function scoreSkuMatches(message) {
  const msg = norm(message);
  const scored = [];
  for (const { sku, patterns } of SKU_MATCHERS) {
    let score = 0;
    for (const re of patterns) {
      if (re.test(msg)) score += 10;
    }
    if (score > 0 && getEntry(sku)) scored.push({ sku, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function resolveSkuFromMessage(message) {
  const msg = norm(message);
  if (/\b86011\b/.test(msg) || /\b11\s*l\b/.test(msg)) return "86011";
  if (/\b86001\b/.test(msg) || /\bmzr\b/.test(msg)) return "86001";
  if (/\badb-typ\b/.test(msg) || /\btyphoon\b/.test(msg)) return "ADB-TYP";
  if (/\badb-b\b/.test(msg) || /\bbonnet\b/.test(msg)) return "ADB-B";
  if (/\btop\s+star\b/.test(msg)) return "132001";

  const scored = scoreSkuMatches(message);
  return scored.length > 0 ? scored[0].sku : null;
}

function isGenericApcOnly(message) {
  const msg = norm(message);
  const hasApc = /\bapc\b/i.test(msg);
  const hasSpecific = scoreSkuMatches(message).length > 0;
  return hasApc && !hasSpecific;
}

function isAntiRecShapedQuery(message) {
  const msg = norm(message);
  if (!msg) return false;
  const hasMaterial = MATERIAL_KEYWORDS.some((m) => msg.includes(m));
  if (!hasMaterial) return false;
  return ANTI_REC_TRIGGERS.some((t) => msg.includes(norm(t)));
}

function inferSectionKeyFromMessage(message) {
  const msg = norm(message);
  if (/\bunde\b/.test(msg) || /unde\s+se\s+poate/.test(msg)) return "whereToUse";
  if (/cum\s+(se\s+)?(aplica|foloseste|utilizeaza)/.test(msg) || /\bcum\s+aplic\b/.test(msg)) {
    return "howToUse";
  }
  if (/cat\s+timp/.test(msg) || /las\s+.*\s+pe\s+suprafata/.test(msg)) return "howToUse";
  if (/ce\s+urmeaza/.test(msg)) return "whatNext";
  if (/ce\s+este/.test(msg)) return "whatIs";
  return "howToUse";
}

function pickAntiRecBullets(entry, message) {
  const bullets = entry?.sections?.whatItIsNot;
  if (!Array.isArray(bullets) || bullets.length === 0) return [];
  const msg = norm(message);
  const materialHit = MATERIAL_KEYWORDS.find((m) => msg.includes(m));
  if (!materialHit) return bullets.slice(0, 2);
  const relevant = bullets.filter((b) => {
    const bn = norm(b);
    if (materialHit === "piele") {
      return /piele|usuce|dressing|prote/i.test(bn);
    }
    return true;
  });
  return relevant.length > 0 ? relevant.slice(0, 2) : bullets.slice(0, 2);
}

function formatSectionQuote(sku, sectionKey, sectionText) {
  const displayName = resolveProductDisplayName(sku);
  const label =
    sectionKey === "whereToUse"
      ? "Unde se poate folosi"
      : sectionKey === "howToUse"
        ? "Cum se folosește"
        : sectionKey === "whatNext"
          ? "Ce urmează"
          : "Din descrierea produsului";
  const excerpt =
    sectionText.length > 520 ? `${sectionText.slice(0, 517).trim()}…` : sectionText;
  return `${label} (${displayName}): ${excerpt}`;
}

function formatAntiRecReply(sku, bullets) {
  const displayName = resolveProductDisplayName(sku);
  const lines = bullets.map((b) => (b.endsWith(".") ? b : `${b}.`));
  return `Pentru ${displayName}, conform descrierii producatorului: ${lines.join(" ")}`;
}

function buildDeclineCopy(productName) {
  const name = productName && productName.trim()
    ? productName.trim()
    : "produsul mentionat";
  return `Nu am un extras structurat din descrierea ${name} pentru intrebarea ta. Poti reformula intrebarea sau alege un produs din gama noastra principala (Koch Chemie, Gtechniq, ADBL, ZviZZer, Ewocar).`;
}

const DECLINE_COPY = buildDeclineCopy();

/**
 * Product-specific anti-rec via whatItIsNot → knowledge (not safety).
 * @returns {{ reply: string, sku: string, reasonCode: string } | null}
 */
function tryProductSectionAntiRecKnowledge(message) {
  if (!isAntiRecShapedQuery(message)) return null;
  if (isGenericApcOnly(message)) return null;

  const sku = resolveSkuFromMessage(message);
  if (!sku) return null;

  const entry = getEntry(sku);
  if (!entry || entry.sectionPresence?.whatItIsNot !== "present") return null;

  const bullets = pickAntiRecBullets(entry, message);
  if (bullets.length === 0) return null;

  return {
    reply: formatAntiRecReply(sku, bullets),
    sku,
    reasonCode: "routing.knowledge.product_section_anti_rec",
    selectionEmpty: true
  };
}

/**
 * Quote whereToUse / howToUse (and role-empty informational fallback).
 * @returns {{ reply: string, sku: string, sectionKey: string, reasonCode: string, decline?: boolean } | null}
 */
function tryProductSectionQuoteKnowledge(message, queryType, options = {}) {
  const skipQueryTypeCheck = options.skipQueryTypeCheck === true;
  if (!skipQueryTypeCheck && String(queryType || "").toLowerCase() !== "informational") {
    return null;
  }

  if (
    isAntiRecShapedQuery(message) &&
    !isGenericApcOnly(message) &&
    resolveSkuFromMessage(message)
  ) {
    return null;
  }

  const sku = resolveSkuFromMessage(message);
  if (!sku) return null;

  const entry = getEntry(sku);
  if (!entry) return null;

  const sectionKey = inferSectionKeyFromMessage(message);
  const presence = entry.sectionPresence?.[sectionKey];
  const text = entry.sections?.[sectionKey];

  if (presence === "missing" || !text || (typeof text === "string" && text.trim().length < 20)) {
    return {
      reply: buildDeclineCopy(resolveProductDisplayName(sku)),
      sku,
      sectionKey,
      reasonCode: "routing.knowledge.product_section_decline",
      decline: true,
      selectionEmpty: true
    };
  }

  if (typeof text !== "string") return null;

  return {
    reply: formatSectionQuote(sku, sectionKey, text),
    sku,
    sectionKey,
    reasonCode: "routing.knowledge.product_section_quote",
    selectionEmpty: false
  };
}

function tokenCore(token) {
  return norm(token).replace(/[^a-z0-9]+/g, "");
}

function isProductSectionIntent(message) {
  const msg = norm(message);
  if (resolveSkuFromMessage(message)) return true;
  if (isAntiRecShapedQuery(message)) return true;
  if (/cum\s+(se\s+)?(aplica|foloseste|utilizeaza)/.test(msg) || /\bcum\s+aplic\b/.test(msg)) {
    return true;
  }
  if (/\bunde\b/.test(msg) && /(pot\s+folosi|se\s+poate\s+folosi|folosit)/.test(msg)) {
    return true;
  }
  if (/ce\s+urmeaza/.test(msg)) return true;
  if (/cat\s+timp/.test(msg) || /las\s+.*\s+pe\s+suprafata/.test(msg)) return true;
  return false;
}

function messageReferencesCatalogProduct(message, catalogProduct) {
  const msg = norm(message);
  const msgCompact = msg.replace(/[^a-z0-9]+/g, "");
  const nameNorm = norm(catalogProduct?.name || "");
  const brandNorm = norm(catalogProduct?.brand || "");

  if (brandNorm) {
    const brandCore = tokenCore(brandNorm);
    if (brandCore.length >= 4 && msgCompact.includes(brandCore)) return true;
  }

  if (/hot\s+rims/i.test(nameNorm) && /hot\s+rims/i.test(msg)) return true;

  const tokens = nameNorm.split(/\s+/).filter((t) => tokenCore(t).length > 4);
  return tokens.some((t) => msgCompact.includes(tokenCore(t)));
}

/**
 * Non-tier-1 or unknown SKU informational → graceful decline.
 */
function tryNonTierOneSectionDecline(message, queryType, catalogProduct) {
  if (String(queryType || "").toLowerCase() !== "informational") return null;
  if (!isProductSectionIntent(message)) return null;
  if (!catalogProduct) return null;
  if (TIER1_BRANDS.has(catalogProduct.brand)) return null;

  const nameNorm = norm(catalogProduct.name || "");
  if (!nameNorm || nameNorm.length < 8) return null;
  if (!messageReferencesCatalogProduct(message, catalogProduct)) return null;

  return {
    reply: buildDeclineCopy(catalogProduct.name || resolveProductDisplayName(catalogProduct.id)),
    sku: String(catalogProduct.id || ""),
    reasonCode: "routing.knowledge.product_section_decline",
    decline: true,
    selectionEmpty: true
  };
}

/**
 * When role config yields zero products on informational query, try section quote by SKU in message.
 */
function tryRoleEmptySectionKnowledgeFallback(message, queryType, roleMatches) {
  if (String(queryType || "").toLowerCase() !== "informational") return null;
  if (Array.isArray(roleMatches) && roleMatches.length > 0) return null;
  return tryProductSectionQuoteKnowledge(message, queryType);
}

/**
 * Match catalog product by prominent name tokens (non-tier-1 decline tests).
 */
function findCatalogProductByMessage(message, products) {
  const msg = norm(message);
  let best = null;
  let bestScore = 0;
  for (const p of products || []) {
    if (!messageReferencesCatalogProduct(message, p)) continue;
    const n = norm(p.name || "");
    let score = n.length;
    const brandNorm = norm(p.brand || "");
    if (brandNorm && msg.includes(tokenCore(brandNorm))) score += 50;
    if (/hot\s+rims/i.test(msg) && /hot\s+rims/i.test(n)) score += 40;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  if (best) return best;
  if (/hot\s+rims/i.test(msg)) {
    const candidates = (products || []).filter((p) => /hot\s+rims/i.test(norm(p.name || "")));
    if (candidates.length === 0) return null;
    const brandHit = candidates.find((p) => messageReferencesCatalogProduct(message, p));
    return brandHit || candidates[0];
  }
  return null;
}

module.exports = {
  TIER1_BRANDS,
  loadEntriesBySku,
  getEntry,
  resolveSkuFromMessage,
  resolveProductDisplayName,
  tryProductSectionAntiRecKnowledge,
  tryProductSectionQuoteKnowledge,
  tryNonTierOneSectionDecline,
  tryRoleEmptySectionKnowledgeFallback,
  findCatalogProductByMessage,
  messageReferencesCatalogProduct,
  isProductSectionIntent,
  buildDeclineCopy,
  DECLINE_COPY
};
