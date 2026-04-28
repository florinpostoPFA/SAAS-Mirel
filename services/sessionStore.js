/**
 * Unified session persistence (single lifecycle). Implementation: sessionLifecycle.js
 * Slot / clarification rules: docs/SESSION_SCOPES.md
 *
 * @deprecated Direct imports are fine; this module is a thin facade over sessionLifecycle.
 */

const L = require("./sessionLifecycle");

function getSession(sessionId) {
  return L.loadSession(sessionId);
}

function saveSession(sessionId, sessionData) {
  L.persistSession(sessionId, sessionData);
}

module.exports = {
  getSession,
  saveSession,
  setSessionMutationHook: L.setSessionMutationHook,
  resetGoldenConversationSessions: L.resetAllSessions,
  seedGoldenConversationSession: L.seedSession
};
