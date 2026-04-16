const config = require("../config");

/**
 * Extract tags (keywords and their synonyms) from a query
 * Pure function - uses config for synonyms
 */
function detectTags(query) {
  const q = query.toLowerCase();
  const tags = new Set();

  // Add direct query as tag
  tags.add(q);

  // Add matched synonym tags from config
  Object.keys(config.search.tagSynonyms).forEach(tag => {
    if (q.includes(tag)) {
      tags.add(tag);
      config.search.tagSynonyms[tag].forEach(synonym => tags.add(synonym));
    }
  });

  return Array.from(tags);
}

function normalizeProduct(product) {
  const rawTags = Array.isArray(product.tags)
    ? product.tags
    : Array.isArray(product.aiTags)
      ? product.aiTags
      : [];

  return {
    ...product,
    tags: rawTags,
    aiTags: Array.isArray(product.aiTags) ? product.aiTags : rawTags
  };
}

function getTagWeight(tag) {
  const normalizedTag = String(tag).toLowerCase();

  if (normalizedTag === "cleaning") {
    return 3;
  }

  if (normalizedTag === "interior") {
    return 3;
  }

  if (["leather", "textile", "alcantara"].includes(normalizedTag)) {
    return 3;
  }

  return 1;
}

function passesStrictFilters(product, tags) {
  const normalizedProduct = normalizeProduct(product);
  const productTags = normalizedProduct.aiTags.map(tag => String(tag).toLowerCase());
  const userTags = (tags || []).map(tag => String(tag).toLowerCase());

  if (userTags.includes("interior")) {
    if (productTags.includes("tire") || productTags.includes("exterior")) {
      return false;
    }
  }

  if (userTags.includes("cleaning") && !productTags.includes("cleaning")) {
    return false;
  }

  return true;
}

function getPenalty(productTags, userTags) {
  let penalty = 0;

  if (userTags.includes("interior") && (productTags.includes("tire") || productTags.includes("exterior"))) {
    penalty -= 5;
  }

  return penalty;
}

function analyzeProductMatch(product, tags) {
  const normalizedProduct = normalizeProduct(product);
  const productTags = normalizedProduct.aiTags.map(tag => String(tag).toLowerCase());
  const userTags = (tags || []).map(tag => String(tag).toLowerCase());
  const matchedTags = userTags.filter(tag => productTags.includes(tag));

  let score = 0;

  matchedTags.forEach(tag => {
    score += getTagWeight(tag);
  });

  if (userTags.length > 0 && matchedTags.length === userTags.length) {
    score += 3;
  }

  score += getPenalty(productTags, userTags);

  return {
    ...normalizedProduct,
    score,
    matchedTags
  };
}

function scoreByProductTags(product, tags) {
  return analyzeProductMatch(product, tags).score;
}

function calculateScore(product, tags) {
  return scoreByProductTags(product, tags);
}

/**
 * Main search function (legacy, kept for compatibility)
 * Separates concerns: tag detection → scoring → sorting → limiting
 * Uses config for result limits
 */
function searchProducts(allProducts, tags, message = "") {
  const safeProducts = Array.isArray(allProducts) ? allProducts : [];
  const normalizedTags = (tags || [])
    .map(tag => String(tag).toLowerCase())
    .filter(Boolean);

  if (normalizedTags.length === 0) {
    return rankProducts(safeProducts, [], message).slice(0, 5);
  }

  // STEP 1: exact match (all tags)
  let results = safeProducts.filter(p =>
    normalizedTags.every(tag => (p.tags || []).includes(tag))
  );

  if (results.length > 0) {
    return rankProducts(results, normalizedTags, message || normalizedTags.join(" "));
  }

  // STEP 2..N: progressively relax by removing least important tags (from the end)
  for (let i = normalizedTags.length - 1; i >= 1; i--) {
    const tagsUsed = normalizedTags.slice(0, i);

    results = safeProducts.filter(p =>
      tagsUsed.every(tag => (p.tags || []).includes(tag))
    );

    if (results.length > 0) {
      return rankProducts(results, tagsUsed, message || normalizedTags.join(" "));
    }
  }

  // STEP 4: fallback to interior products
  const interiorTags = ["interior"];
  results = safeProducts.filter(p => (p.tags || []).includes("interior"));

  if (results.length > 0) {
    return rankProducts(results, interiorTags, message || normalizedTags.join(" "));
  }

  // STEP 5: last fallback to top products from DB
  return rankProducts(safeProducts, normalizedTags, message || normalizedTags.join(" ")).slice(0, 5);
}

const STOPWORDS = new Set([
  "pentru", "si", "cu", "de", "la", "in", "pe", "un", "o", "sa",
  "se", "din", "al", "ale", "cel", "cei", "ca", "mai", "nu", "este",
  "fi", "sau", "dar", "care", "este", "sunt", "fost", "am"
]);

const STRONG_INTENT_KEYWORDS = ["dressing", "protectie", "curatare", "polish"];

const INTENT_TYPE_MAP = [
  { keywords: ["dressing"],   type: "dressing" },
  { keywords: ["protectie"],  type: "protection" },
  { keywords: ["curatare"],   type: "cleaning" },
  { keywords: ["polish"],     type: "polish" }
];

const PRODUCT_TYPE_SIGNALS = [
  { signals: ["dressing"],              type: "dressing" },
  { signals: ["protectant", "protect"], type: "protection" },
  { signals: ["cleaner", "detailer", "curatare", "curatator"], type: "cleaning" },
  { signals: ["polish", "compound"],    type: "polish" }
];

const FINISH_KEYWORDS = ["mat", "natural", "satinat"];

function detectIntentType(message) {
  const msg = message.toLowerCase();
  for (const entry of INTENT_TYPE_MAP) {
    if (entry.keywords.some(k => msg.includes(k))) {
      return entry.type;
    }
  }
  return null;
}

function detectProductType(product) {
  const text = ((product.name || "") + " " + (product.description || "")).toLowerCase();
  for (const entry of PRODUCT_TYPE_SIGNALS) {
    if (entry.signals.some(s => text.includes(s))) {
      return entry.type;
    }
  }
  return null;
}

function extractKeywords(message) {
  return message
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9ăâîșțşţ]/g, ""))
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function rankProducts(products, tags, message) {
  const keywords = extractKeywords(message || "");
  const msgLower = (message || "").toLowerCase();
  const strongIntents = STRONG_INTENT_KEYWORDS.filter(k => msgLower.includes(k));
  const intentType = detectIntentType(msgLower);
  const finishWords = FINISH_KEYWORDS.filter(f => msgLower.includes(f));

  return products
    .map(product => {
      const productTags = product.tags || [];
      const productName = (product.name || "").toLowerCase();
      const productShort = (product.short_description || "").toLowerCase();
      const productDesc = (product.description || "").toLowerCase();

      let score = 0;

      // 1. Tag match (3 points each)
      let tagMatches = 0;
      tags.forEach(tag => {
        if (productTags.includes(tag)) {
          tagMatches++;
          score += 3;
        }
      });

      // 2. Exact match bonus
      if (tagMatches === tags.length && tags.length > 0) {
        score += 5;
      }

      // 3. Category relevance
      if (tags.some(tag => (product.category || "").toLowerCase().includes(tag))) {
        score += 2;
      }

      // 4. Keyword scoring per field
      keywords.forEach(kw => {
        if (productName.includes(kw))  score += 3;
        if (productShort.includes(kw)) score += 2;
        if (productDesc.includes(kw))  score += 1;
      });

      // 5. Strong intent boost
      strongIntents.forEach(intent => {
        if (productName.includes(intent) || productShort.includes(intent) || productDesc.includes(intent)) {
          score += 5;
        }
      });

      // 6. Product-type intent matching / penalty
      if (intentType) {
        const productType = detectProductType(product);
        if (productType === intentType) {
          score += 10;
        } else if (productType !== null) {
          score -= 10;
        }
      }

      // 7. Finish detection
      finishWords.forEach(finish => {
        if (productName.includes(finish) || productShort.includes(finish) || productDesc.includes(finish)) {
          score += 5;
        }
      });

      return {
        ...product,
        score
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function searchByQuery(query, products) {
  const tags = detectTags(query);
  const allProducts = Array.isArray(products) ? products : [];
  const normalizedTags = (tags || []).map(tag => String(tag).toLowerCase());

  const results = searchProducts(
    allProducts.map(product => normalizeProduct(product)),
    normalizedTags,
    query || ""
  );

  return results;
}

/**
 * Tag-based product search
 * Scores products based on aiTags matches
 * @param {array} tags - Detected tags
 * @param {array} products - Product catalog
 * @param {number} maxResults - Max results to return
 * @returns {array} Matched products sorted by relevance
 */
function searchProductsByTags(tags, products, maxResults = config.defaultSettings?.max_products || 3) {
  const allProducts = Array.isArray(products) ? products : [];

  const normalizedTags = (tags || []).map(tag => String(tag).toLowerCase());

  const results = searchProducts(
    allProducts.map(product => normalizeProduct(product)),
    normalizedTags,
    normalizedTags.join(" ")
  ).slice(0, Math.min(5, maxResults));

  return results;
}

module.exports = {
  searchProducts: searchByQuery,
  searchProductsByTags,
  detectTags,
  scoreByProductTags,
  passesStrictFilters,
  calculateScore,
  analyzeProductMatch,
  normalizeProduct,
  getTagWeight,
  extractKeywords,
  detectIntentType,
  detectProductType
};
