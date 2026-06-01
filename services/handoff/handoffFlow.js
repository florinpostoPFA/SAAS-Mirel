"use strict";

const path = require("path");
const logger = require("../logger");
const { getNowIso } = require("../runtimeContext");
const { parseContact } = require("./contactParser");
const { logHandoffPayloadSafe } = require("./handoffPayloadLogger");

const templates = require(path.join(__dirname, "../../data/handoff_templates.json"));

function getTemplate(key) {
  return templates[key] || "";
}

function initHandoffState(sessionContext, reason) {
  sessionContext.handoff = {
    state: "awaiting_contact",
    attempts: 0,
    capturedContact: null,
    timestamp: getNowIso(),
    reason: reason || null
  };
}

/**
 * @returns {{ handled: boolean, endInteractionArgs?: [object, object, object] }}
 */
function processHandoffContinuation({
  sessionContext,
  sessionId,
  userMessage,
  traceId,
  turnCount
}) {
  const handoff = sessionContext?.handoff;
  if (!handoff || (handoff.state !== "awaiting_contact" && handoff.state !== "awaiting_retry")) {
    return { handled: false };
  }

  const loose = handoff.state === "awaiting_retry";
  const contact = parseContact(userMessage, { loose });
  const extras = {
    handoffReason: handoff.reason ?? null,
    sessionId,
    turnCount
  };

  if (contact) {
    handoff.state = "handoff_complete";
    handoff.capturedContact = contact;
    logHandoffPayloadSafe(sessionContext, contact, traceId, extras);
    logger.logInfo("HUMAN_HANDOFF_CONTACT_CAPTURED", {
      traceId,
      sessionId,
      contactType: contact.type,
      validityFirstTry: handoff.attempts === 0
    });
    return {
      handled: true,
      reply: getTemplate("CONTACT_CONFIRMED"),
      decision: {
        action: "human_handoff",
        flowId: null,
        missingSlot: null,
        handoffReason: handoff.reason,
        handoffComplete: true
      },
      outputType: "reply"
    };
  }

  if ((handoff.attempts || 0) < 1) {
    handoff.state = "awaiting_retry";
    handoff.attempts = 1;
    return {
      handled: true,
      reply: getTemplate("RETRY_PROMPT"),
      decision: {
        action: "human_handoff",
        flowId: null,
        missingSlot: null,
        handoffReason: handoff.reason,
        handoffState: "awaiting_retry"
      },
      outputType: "question"
    };
  }

  handoff.state = "handoff_complete";
  logHandoffPayloadSafe(sessionContext, null, traceId, extras);
  return {
    handled: true,
    reply: getTemplate("GRACEFUL_CLOSE"),
    decision: {
      action: "human_handoff",
      flowId: null,
      missingSlot: null,
      handoffReason: handoff.reason,
      handoffComplete: true,
    },
    outputType: "reply"
  };
}

function buildHandoffTriggerResponse(sessionContext, sessionId, traceId, reason, turnCount) {
  initHandoffState(sessionContext, reason);
  logHandoffPayloadSafe(sessionContext, null, traceId, {
    handoffReason: reason,
    sessionId,
    turnCount
  });
  logger.logInfo("HUMAN_HANDOFF_TRIGGERED", {
    reason,
    traceId,
    sessionId,
    turnCount,
    slotsAtTrigger: sessionContext?.slots || {}
  });
  return {
    reply: getTemplate("TRIGGER_PROMPT"),
    decision: {
      action: "human_handoff",
      flowId: null,
      missingSlot: null,
      handoffReason: reason
    },
    outputType: "question"
  };
}

module.exports = {
  getTemplate,
  initHandoffState,
  processHandoffContinuation,
  buildHandoffTriggerResponse,
  templates
};
