/**
 * Product / telemetry helpers — all data lives on the unified session object
 * (sessionLifecycle). This module remains for stable import paths.
 *
 * @deprecated Prefer sessionLifecycle.loadSession / persistSession for new code.
 */

const { getNowMs } = require("./runtimeContext");
const L = require("./sessionLifecycle");

/**
 * Telemetry touch: bumps lastActivity (matches historical sessionService behavior).
 * Does not alter routing `pendingQuestion` (object|null) — that is conversation state.
 */
function getSession(sessionId) {
  if (!sessionId) {
    throw new Error("Session ID is required");
  }
  const s = L.loadSession(sessionId);
  const t = getNowMs();
  s.lastActivity = t;
  if (s.meta) s.meta.updatedAtMs = t;
  s.questionCount = s.questionCount || 0;
  return s;
}

function updateSessionWithProducts(sessionId, products, responseType = "recommendation") {
  const session = getSession(sessionId);

  const uniqueProducts = (products || []).filter((product, index, self) =>
    index === self.findIndex((p) => p.id === product.id)
  );

  session.activeProducts = uniqueProducts.map((product) => ({
    id: product.id || product.name,
    name: product.name,
    price: product.price,
    tags: product.tags || []
  }));

  session.lastResponseType = responseType;

  if (responseType === "question") {
    session.questionCount++;
  }

  session.messageCount++;

  session.conversationHistory.push({
    timestamp: getNowMs(),
    type: responseType,
    productCount: products?.length || 0,
    products: session.activeProducts
  });

  if (session.conversationHistory.length > 10) {
    session.conversationHistory = session.conversationHistory.slice(-10);
  }

  const t = getNowMs();
  session.lastActivity = t;
  if (session.meta) session.meta.updatedAtMs = t;

  return session;
}

function getActiveProducts(sessionId) {
  const session = L.loadSession(sessionId);
  return session.activeProducts || [];
}

function getLastResponseType(sessionId) {
  const session = L.loadSession(sessionId);
  return session.lastResponseType;
}

function getSessionContext(sessionId) {
  const session = L.loadSession(sessionId);
  return {
    activeProducts: session.activeProducts,
    lastResponseType: session.lastResponseType,
    questionCount: session.questionCount,
    messageCount: session.messageCount,
    hasSeenProducts: (session.activeProducts || []).length > 0,
    conversationHistory: session.conversationHistory
  };
}

function clearActiveProducts(sessionId) {
  const session = L.loadSession(sessionId);
  session.activeProducts = [];
}

function getSessionStats(sessionId) {
  const session = L.loadSession(sessionId);
  return {
    messageCount: session.messageCount,
    activeProductsCount: (session.activeProducts || []).length,
    lastActivity: session.lastActivity,
    createdAt: session.createdAt,
    duration: getNowMs() - session.createdAt
  };
}

function cleanupOldSessions() {
  return L.cleanupOldSessions();
}

function getActiveSessionIds() {
  return L.getActiveSessionIds();
}

function peekSessionSnapshot(sessionId) {
  return L.peekSessionSnapshot(sessionId);
}

function resetGoldenTelemetrySessions() {
  L.resetAllSessions();
}

function seedGoldenTelemetrySession(sessionId, partial) {
  return L.seedSession(sessionId, partial || {});
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
  getActiveSessionIds,
  resetGoldenTelemetrySessions,
  seedGoldenTelemetrySession,
  peekSessionSnapshot
};
