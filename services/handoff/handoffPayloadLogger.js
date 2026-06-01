"use strict";

const logger = require("../logger");
const { getNowIso } = require("../runtimeContext");

const DEFAULT_TURN_LIMIT = 10;

/**
 * @param {object} sessionContext
 * @param {{ type: string, value: string } | null} contact
 * @param {string|null} traceId
 * @param {object} [extras]
 */
function buildHandoffPayload(sessionContext, contact, traceId, extras = {}) {
  const turns = Array.isArray(sessionContext?.turnHistory)
    ? sessionContext.turnHistory.slice(-DEFAULT_TURN_LIMIT)
    : [];
  const decisionHistory = Array.isArray(sessionContext?.decisionHistory)
    ? sessionContext.decisionHistory.slice(-DEFAULT_TURN_LIMIT)
    : [];

  return {
    lastTurns: turns,
    slots: sessionContext?.slots && typeof sessionContext.slots === "object"
      ? { ...sessionContext.slots }
      : {},
    decisionHistory,
    traceId: traceId ?? null,
    contactType: contact?.type ?? null,
    contactValue: contact?.value ?? null,
    timestamp: getNowIso(),
    handoffReason: extras.handoffReason ?? null,
    sessionId: extras.sessionId ?? null,
    turnCount: extras.turnCount ?? turns.length
  };
}

/**
 * @param {object} payload
 */
function logHandoffLocally(payload) {
  logger.logInfo("HUMAN_HANDOFF_PAYLOAD_LOGGED", payload);
}

/**
 * @param {object} sessionContext
 * @param {{ type: string, value: string } | null} contact
 * @param {string|null} traceId
 * @param {object} [extras]
 */
function logHandoffPayloadSafe(sessionContext, contact, traceId, extras = {}) {
  try {
    const payload = buildHandoffPayload(sessionContext, contact, traceId, extras);
    JSON.stringify(payload);
    logHandoffLocally(payload);
    return payload;
  } catch (err) {
    logger.logInfo("HUMAN_HANDOFF_LOG_FAILED", {
      traceId: traceId ?? null,
      error: err?.message || String(err)
    });
    return null;
  }
}

module.exports = {
  buildHandoffPayload,
  logHandoffLocally,
  logHandoffPayloadSafe,
  DEFAULT_TURN_LIMIT
};
