/**
 * Strategy service
 * Decides how the assistant should respond based on intent, context, and settings
 */

/**
 * Available response strategies
 */
const STRATEGIES = {
  DIRECT: "direct",           // Show products immediately
  DISCOVERY: "discovery",     // Ask 1 clarifying question first
  COMPARISON: "comparison",   // Compare previously seen products
  URGENCY: "urgency"          // Push CTA harder
};

/**
 * Check if intent indicates a clear product search
 */
function isClearProductSearch(intent, context) {
  return intent === "product_search" &&
         context?.tags &&
         context.tags.length > 0;
}

/**
 * Check if signal is weak (no clear tags detected)
 */
function hasWeakSignal(context) {
  return !context?.tags || context.tags.length === 0;
}

/**
 * Check if user has seen products before in this conversation
 */
function hasSeenProducts(context) {
  return context?.seenProducts &&
         Array.isArray(context.seenProducts) &&
         context.seenProducts.length > 0;
}

/**
 * Check if aggressive sales mode is enabled
 */
function isAggressiveMode(settings) {
  return settings?.sales_mode === "aggressive";
}

/**
 * Choose the appropriate response strategy
 * Simple, extendable logic based on intent, context, and settings
 */
function chooseStrategy(intent, context = {}, settings = {}) {
  // Rule 1: Clear product search → direct strategy
  if (isClearProductSearch(intent, context)) {
    return STRATEGIES.DIRECT;
  }

  // Rule 2: Weak signal (no tags) → discovery strategy
  if (hasWeakSignal(context)) {
    return STRATEGIES.DISCOVERY;
  }

  // Rule 3: User has seen products before → comparison strategy
  if (hasSeenProducts(context)) {
    return STRATEGIES.COMPARISON;
  }

  // Rule 4: Aggressive sales mode → urgency strategy
  if (isAggressiveMode(settings)) {
    return STRATEGIES.URGENCY;
  }

  // Default fallback: direct strategy
  return STRATEGIES.DIRECT;
}

module.exports = {
  chooseStrategy,
  STRATEGIES
};