"use strict";

const EXPLICIT_CANCEL_PHRASES = [];

function normalizeForCancel(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

function matchesExplicitCancel(userMessage) {
  const msg = normalizeForCancel(userMessage);
  if (!msg) return false;
  return EXPLICIT_CANCEL_PHRASES.some((phrase) => msg.includes(phrase));
}

/**
 * @param {object} sessionContext
 * @param {string} userMessage
 * @param {{
 *   maxTurns?: number,
 *   intentCore?: string|null,
 *   getSingleTokenBinding?: (message: string, pending: object) => { slot: string, value: string }|null,
 *   evaluateSessionReset?: (userMessage: string, sessionContext: object, intentCore: string|null) => { reset: boolean, reasonCode?: string|null },
 *   isInterrogativeFollowUp?: (message: string) => boolean
 * }} [opts]
 * @returns {{ stale: boolean, reason?: string }}
 */
function evaluatePendingQuestionStaleness(sessionContext, userMessage, opts = {}) {
  const pending = sessionContext?.pendingQuestion;
  if (!pending || !pending.slot) {
    return { stale: false };
  }

  const maxTurns = Number.isFinite(Number(opts.maxTurns))
    ? Number(opts.maxTurns)
    : Number(process.env.PENDING_QUESTION_MAX_TURNS) || 3;

  if (matchesExplicitCancel(userMessage)) {
    return { stale: true, reason: "explicit_cancel" };
  }

  const bindingFn = opts.getSingleTokenBinding || (() => null);
  const binding = bindingFn(userMessage, pending);

  if (!binding) {
    if (typeof opts.isOffTopicForPending === "function") {
      if (opts.isOffTopicForPending(userMessage, sessionContext, opts.intentCore ?? null)) {
        return { stale: true, reason: "topic_shift" };
      }
    }
    if (typeof opts.evaluateSessionReset === "function") {
      const resetEval = opts.evaluateSessionReset(
        userMessage,
        sessionContext,
        opts.intentCore ?? null
      );
      if (resetEval?.reset) {
        return { stale: true, reason: "topic_shift" };
      }
    }
  }

  const isInterrogativeFollowUp = opts.isInterrogativeFollowUp || (() => false);
  const slots = sessionContext?.slots && typeof sessionContext.slots === "object"
    ? sessionContext.slots
    : {};
  if (
    isInterrogativeFollowUp(userMessage) &&
    slots.context &&
    (slots.action || slots.object)
  ) {
    return { stale: false };
  }

  const turnsSinceArmed = Number(pending.turnsSinceArmed) || 0;
  if (turnsSinceArmed >= maxTurns) {
    return { stale: true, reason: "turn_count_exceeded" };
  }

  return { stale: false };
}

module.exports = {
  evaluatePendingQuestionStaleness,
  matchesExplicitCancel,
  EXPLICIT_CANCEL_PHRASES
};
