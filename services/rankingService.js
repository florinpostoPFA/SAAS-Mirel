/**
 * Product ranking service
 * Ranks products to maximize conversion rather than just relevance
 */

/**
 * Default scoring weights
 * Configurable via settings with these fallbacks
 */
const DEFAULT_WEIGHTS = {
  matchScore: 1.0,      // High weight for search relevance
  conversionRate: 2.0,  // Very high weight for conversion potential
  priceFit: 0.8,        // Moderate weight for price matching
  stockUrgency: 0.5,    // Lower weight for stock urgency
  recency: 0.3,         // Optional: recent products
  popularity: 0.4       // Optional: popular products
};

/**
 * Calculate price fit score
 * Higher score for products within the desired price range
 */
function calculatePriceFit(product, context) {
  if (!context.priceRange || !context.priceRange.min || !context.priceRange.max) {
    return 0;
  }

  const { min, max } = context.priceRange;
  const price = product.price;

  if (price >= min && price <= max) {
    return 1.0; // Perfect fit
  } else if (price < min) {
    // Penalize cheaper products less than expensive ones
    return Math.max(0, 1 - (min - price) / min);
  } else {
    // Penalize expensive products
    return Math.max(0, 1 - (price - max) / (max * 2));
  }
}

/**
 * Calculate stock urgency score
 * Boost products with low stock to create urgency
 */
function calculateStockUrgency(product) {
  const stock = product.stock || product.quantity || 10; // Default to 10 if not specified
  const maxStock = 50; // Assume 50 is "normal" stock level

  if (stock <= 5) {
    return 1.0; // Very urgent - low stock
  } else if (stock <= 10) {
    return 0.7; // Somewhat urgent
  } else if (stock > maxStock) {
    return 0.2; // Overstocked - slight penalty
  }

  return 0.5; // Normal stock
}

/**
 * Calculate recency score
 * Boost newer products (optional feature)
 */
function calculateRecency(product) {
  if (!product.createdAt && !product.releaseDate) {
    return 0.5; // Neutral score if no date info
  }

  const productDate = new Date(product.createdAt || product.releaseDate);
  const now = new Date();
  const daysSinceRelease = (now - productDate) / (1000 * 60 * 60 * 24);

  // Boost recent products (last 30 days get max score)
  if (daysSinceRelease <= 30) {
    return 1.0;
  } else if (daysSinceRelease <= 90) {
    return 0.8;
  } else if (daysSinceRelease <= 365) {
    return 0.6;
  }

  return 0.3; // Older products
}

/**
 * Calculate popularity score
 * Boost products that are frequently viewed/purchased (optional feature)
 */
function calculatePopularity(product) {
  // This could come from analytics data
  // For now, use a simple heuristic based on existing data
  const popularityScore = product.popularity || product.views || 0;

  // Normalize to 0-1 scale (assuming max popularity is 1000)
  return Math.min(popularityScore / 1000, 1.0);
}

/**
 * Calculate total score for a product
 * Modular scoring system with configurable weights
 */
function calculateScore(product, context, settings) {
  const weights = { ...DEFAULT_WEIGHTS, ...(settings?.rankingWeights || {}) };

  let score = 0;

  // Match score from search (high weight)
  score += (product.score || product.matchScore || 0) * weights.matchScore;

  // Conversion rate (very high weight)
  score += (product.conversionRate || 0) * weights.conversionRate;

  // Price fit (if context has price range)
  score += calculatePriceFit(product, context) * weights.priceFit;

  // Stock urgency
  score += calculateStockUrgency(product) * weights.stockUrgency;

  // Optional: recency
  if (settings?.enableRecencyScoring) {
    score += calculateRecency(product) * weights.recency;
  }

  // Optional: popularity
  if (settings?.enablePopularityScoring) {
    score += calculatePopularity(product) * weights.popularity;
  }

  return score;
}

/**
 * Rank products by conversion potential
 * Returns sorted products with scores (does not mutate originals)
 */
function rankProducts(products, context = {}, settings = {}) {
  if (!Array.isArray(products)) {
    return [];
  }

  return products
    .map(product => ({
      ...product,
      score: calculateScore(product, context, settings)
    }))
    .sort((a, b) => b.score - a.score);
}

module.exports = {
  rankProducts,
  calculateScore,
  calculatePriceFit,
  calculateStockUrgency,
  calculateRecency,
  calculatePopularity,
  DEFAULT_WEIGHTS
};