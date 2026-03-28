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

/**
 * Score a product based on name match
 * Pure function - uses config for weight
 */
function scoreByName(product, tags) {
  const productName = product.name.toLowerCase();
  return tags.reduce((score, tag) => {
    return productName.includes(tag)
      ? score + config.search.scoring.nameMatchWeight
      : score;
  }, 0);
}

/**
 * Score a product based on description match
 * Pure function - uses config for weight
 */
function scoreByDescription(product, tags) {
  const description = product.description.toLowerCase();
  return tags.reduce((score, tag) => {
    return description.includes(tag)
      ? score + config.search.scoring.descriptionMatchWeight
      : score;
  }, 0);
}

/**
 * Score a product based on product tags
 * Direct tag matching gets highest weight
 * Pure function - uses config for weight
 */
function scoreByProductTags(product, tags) {
  if (!product.tags || !Array.isArray(product.tags)) {
    return 0;
  }
  const productTagsLower = product.tags.map(t => t.toLowerCase());
  return tags.reduce((score, tag) => {
    return productTagsLower.includes(tag.toLowerCase())
      ? score + (config.search.scoring.nameMatchWeight * 1.5) // Higher weight for direct tag match
      : score;
  }, 0);
}

/**
 * Define extensible scoring rules
 * Each rule is a pure function: (product, tags) => score
 */
const scoringRules = [
  { name: "product_tags_match", scorer: scoreByProductTags },
  { name: "name_match", scorer: scoreByName },
  { name: "description_match", scorer: scoreByDescription }
];

/**
 * Calculate total score for a product
 * Pure function - no side effects
 */
function calculateScore(product, tags) {
  return scoringRules.reduce((totalScore, rule) => {
    return totalScore + rule.scorer(product, tags);
  }, 0);
}

/**
 * Main search function (legacy, kept for compatibility)
 * Separates concerns: tag detection → scoring → sorting → limiting
 * Uses config for result limits
 */
function searchProducts(query, products) {
  const tags = detectTags(query);

  return products
    .map(product => ({
      ...product,
      score: calculateScore(product, tags)
    }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.search.resultLimit);
}

/**
 * Tag-based product search
 * Scores products based on tag matches
 * @param {array} tags - Detected tags
 * @param {array} products - Product catalog
 * @param {number} maxResults - Max results to return
 * @returns {array} Matched products sorted by relevance
 */
function searchProductsByTags(tags, products, maxResults = 3) {
  if (!tags || tags.length === 0) {
    return [];
  }

  return products
    .map(product => ({
      ...product,
      score: calculateScore(product, tags)
    }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

module.exports = {
  searchProducts,
  searchProductsByTags,
  detectTags,
  scoreByName,
  scoreByDescription,
  scoreByProductTags,
  scoringRules,
  calculateScore
};
