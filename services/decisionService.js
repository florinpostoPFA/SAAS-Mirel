/**
 * Decision service
 * Determines the next action based on conversation context
 * Controls system behavior BEFORE search operations
 */

/**
 * Available actions
 */
const ACTIONS = {
  RECOMMEND: "recommend",  // Search and recommend products
  GUIDE: "guide",          // Provide guidance about existing products
  CLARIFY: "clarify",      // Ask for clarification
  FALLBACK: "fallback"     // Use fallback behavior
};

/**
 * Decide the next action based on conversation context
 * This controls system behavior BEFORE any search operations
 *
 * @param {object} context - Conversation context
 * @param {string} context.intent - Detected intent ("guidance", "product_search", etc.)
 * @param {string} context.queryType - High-level query type ("informational", "procedural", "selection")
 * @returns {object} Decision with action property
 */
function decideNextAction(context = {}) {
  const { queryType } = context;

  if (queryType === "informational") {
    return { action: ACTIONS.GUIDE };
  }

  if (queryType === "procedural") {
    return { action: ACTIONS.GUIDE };
  }

  if (queryType === "selection") {
    return { action: ACTIONS.RECOMMEND };
  }

  // Default: recommend
  return { action: ACTIONS.RECOMMEND };
}

/**
 * Get all available actions (for validation/testing)
 */
function getAvailableActions() {
  return Object.values(ACTIONS);
}

/**
 * Validate if an action is valid
 */
function isValidAction(action) {
  return Object.values(ACTIONS).includes(action);
}

module.exports = {
  decideNextAction,
  getAvailableActions,
  isValidAction,
  ACTIONS
};