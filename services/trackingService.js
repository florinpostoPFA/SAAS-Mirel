// Click, conversion, timeline, and impression tracking
const { on } = require("./eventBus");

let clicks = [];
let conversions = [];
let timeline = [];
let impressions = [];

// Listen to eventBus for tracking events
on("products_recommended", () => {});

on("product_clicked", () => {});

function trackClick(product, sessionId) {
  clicks.push({
    product,
    session_id: sessionId,
    time: Date.now()
  });

  // Update impression record if it exists
  updateImpressionClick(product.id || product, sessionId);
}

function trackConversion(sessionId, value) {
  conversions.push({
    session_id: sessionId,
    value,
    time: Date.now()
  });

  // Update impression records for this session
  updateImpressionConversion(sessionId);
}

function trackTimeline() {
  timeline.push({
    time: Date.now()
  });
}

/**
 * Track product impressions for performance analytics
 * @param {Array} products - Array of product objects shown to user
 * @param {string} sessionId - Unique session identifier
 */
function trackImpressions(products, sessionId) {
  if (!Array.isArray(products) || !sessionId) {
    return;
  }

  const shownAt = Date.now();

  products.forEach((product, index) => {
    // Prevent duplicate impressions for same product/session within same message
    const existingImpression = impressions.find(imp =>
      imp.productId === (product.id || product) &&
      imp.sessionId === sessionId &&
      imp.shownAt === shownAt
    );

    if (!existingImpression) {
      impressions.push({
        productId: product.id || product,
        sessionId,
        shownAt,
        position: index,
        clicked: false,
        converted: false
      });
    }
  });
}

/**
 * Update impression record when product is clicked
 * @param {string|number} productId - Product identifier
 * @param {string} sessionId - Session identifier
 */
function updateImpressionClick(productId, sessionId) {
  const impression = impressions.find(imp =>
    imp.productId === productId &&
    imp.sessionId === sessionId &&
    !imp.clicked
  );

  if (impression) {
    impression.clicked = true;
  }
}

/**
 * Update impression records when conversion happens
 * @param {string} sessionId - Session identifier
 */
function updateImpressionConversion(sessionId) {
  impressions
    .filter(imp => imp.sessionId === sessionId && !imp.converted)
    .forEach(imp => {
      imp.converted = true;
    });
}

function getClicks() {
  return clicks;
}

function getConversions() {
  return conversions;
}

function getTimeline() {
  return timeline;
}

function getImpressions() {
  return impressions;
}

module.exports = {
  trackClick,
  trackConversion,
  trackTimeline,
  trackImpressions,
  getClicks,
  getConversions,
  getTimeline,
  getImpressions
};
