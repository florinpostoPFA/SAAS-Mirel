"use strict";

const logger = require("../logger");
const { getNowIso } = require("../runtimeContext");
const { TRIGGER_PROMPT } = require("../../data/handoff_templates.json");

function buildHandoffPayload({ session, reason, traceId, sessionId }) {
  return {
    sessionId: sessionId ?? null,
    lastTurns: Array.isArray(session?.turnHistory) ? session.turnHistory.slice(-10) : [],
    slots: session?.slots && typeof session.slots === "object" ? { ...session.slots } : {},
    traceId: traceId ?? null,
    reason: reason ?? null,
    timestamp: getNowIso()
  };
}

function logHandoffSafe({ session, reason, traceId, sessionId }) {
  try {
    const payload = buildHandoffPayload({ session, reason, traceId, sessionId });
    JSON.stringify(payload);
    logger.logInfo("HUMAN_HANDOFF_LOGGED", payload);
  } catch (err) {
    logger.logInfo("HUMAN_HANDOFF_LOG_FAILED", {
      traceId: traceId ?? null,
      error: err?.message || String(err)
    });
  }
}

module.exports = { buildHandoffPayload, logHandoffSafe, getTriggerReply: () => TRIGGER_PROMPT };
