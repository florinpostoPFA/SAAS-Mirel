/**
 * Session service
 * Manages conversation state and continuity across messages
 */

// In-memory session storage (can be replaced with Redis/database later)
const sessions = new Map();

/**
 * Get or create a session
 * @param {string} sessionId - Unique session identifier
 * @returns {object} Session object
 */
function getSession(sessionId) {
  if (!sessionId) {
    throw new Error("Session ID is required");
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      activeProducts: [],
      lastResponseType: null,
      pendingQuestion: false,
      questionCount: 0,
      messageCount: 0,
      conversationHistory: []
    });
  }

  const session = sessions.get(sessionId);
  session.pendingQuestion = session.pendingQuestion || false;
  session.questionCount = session.questionCount || 0;
  session.lastActivity = Date.now(); // Update activity timestamp

  return session;
}

/**
 * Update session with recommended products
 * @param {string} sessionId - Session identifier
 * @param {Array} products - Array of product objects
 * @param {string} responseType - Type of response: "recommendation" | "guidance" | "question"
 */
function updateSessionWithProducts(sessionId, products, responseType = "recommendation") {
  const session = getSession(sessionId);

  // Remove duplicates based on id
  const uniqueProducts = (products || []).filter((product, index, self) =>
    index === self.findIndex(p => p.id === product.id)
  );

  // Store only specified fields for active products
  session.activeProducts = uniqueProducts.map(product => ({
    id: product.id || product.name,
    name: product.name,
    price: product.price,
    tags: product.tags || []
  }));

  // Update response type
  session.lastResponseType = responseType;

  if (responseType === "question") {
    session.questionCount++;
  }

  // Increment message count
  session.messageCount++;

  // Add to conversation history (keep last 10 messages)
  session.conversationHistory.push({
    timestamp: Date.now(),
    type: responseType,
    productCount: products?.length || 0,
    products: session.activeProducts
  });

  // Keep only last 10 history items
  if (session.conversationHistory.length > 10) {
    session.conversationHistory = session.conversationHistory.slice(-10);
  }

  return session;
}

/**
 * Get active products for a session
 * @param {string} sessionId - Session identifier
 * @returns {Array} Array of active products
 */
function getActiveProducts(sessionId) {
  const session = getSession(sessionId);
  return session.activeProducts || [];
}

/**
 * Get last response type for a session
 * @param {string} sessionId - Session identifier
 * @returns {string|null} Last response type
 */
function getLastResponseType(sessionId) {
  const session = getSession(sessionId);
  return session.lastResponseType;
}

/**
 * Get session context for decision making
 * @param {string} sessionId - Session identifier
 * @returns {object} Context object with session data
 */
function getSessionContext(sessionId) {
  const session = getSession(sessionId);

  return {
    activeProducts: session.activeProducts,
    lastResponseType: session.lastResponseType,
    questionCount: session.questionCount,
    messageCount: session.messageCount,
    hasSeenProducts: session.activeProducts.length > 0,
    conversationHistory: session.conversationHistory
  };
}

/**
 * Clear active products for a session
 * @param {string} sessionId - Session identifier
 */
function clearActiveProducts(sessionId) {
  const session = getSession(sessionId);
  session.activeProducts = [];
}

/**
 * Get session statistics
 * @param {string} sessionId - Session identifier
 * @returns {object} Session statistics
 */
function getSessionStats(sessionId) {
  const session = getSession(sessionId);

  return {
    messageCount: session.messageCount,
    activeProductsCount: session.activeProducts.length,
    lastActivity: session.lastActivity,
    createdAt: session.createdAt,
    duration: Date.now() - session.createdAt
  };
}

/**
 * Clean up old sessions (older than 24 hours)
 * Call this periodically to prevent memory leaks
 */
function cleanupOldSessions() {
  const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
  let cleanedCount = 0;

  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActivity < cutoffTime) {
      sessions.delete(sessionId);
      cleanedCount++;
    }
  }

  return cleanedCount;
}

/**
 * Get all active session IDs (for monitoring)
 * @returns {Array} Array of session IDs
 */
function getActiveSessionIds() {
  return Array.from(sessions.keys());
}

module.exports = {
  getSession,
  updateSessionWithProducts,
  getActiveProducts,
  getLastResponseType,
  getSessionContext,
  clearActiveProducts,
  getSessionStats,
  cleanupOldSessions,
  getActiveSessionIds
};