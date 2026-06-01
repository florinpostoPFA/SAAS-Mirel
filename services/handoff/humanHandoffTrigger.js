"use strict";

const T1_VAGUE_MATCH_TOKENS = new Set([
  "articol",
  "produs",
  "produsul",
  "ceva",
  "recomandare",
  "recomanda",
  "un",
  "o",
  "unul",
  "bun",
  "buna",
  "accesoriu",
  "solutie",
  "recomand",
  "vreau",
  "interior",
  "exterior",
  "textil",
  "textile",
  "piele",
  "plastic",
  "bord",
  "scaun",
  "dashboard",
  "curatare",
  "curat",
  "protejezi",
  "hidratezi"
]);

const COVERAGE_GOAL_REPLY = /^(curatare|curat[aă]?|protejezi|protejare|hidratezi|hidratare)$/i;

/**
 * T1 only when retrieval tried specific phrases but catalog returned zero (niche / cold-start).
 * @param {{ candidates?: unknown[], matchText?: string[] }} retrievalAttempt
 */
function isNicheZeroRetrieval(retrievalAttempt) {
  if (!retrievalAttempt || (retrievalAttempt.candidates || []).length > 0) {
    return false;
  }
  const phrases = Array.isArray(retrievalAttempt.matchText)
    ? retrievalAttempt.matchText
    : [];
  if (phrases.length === 0) {
    return false;
  }
  const specific = phrases.filter((p) => {
    const t = String(p).toLowerCase().trim();
    if (t.length < 4) return false;
    if (T1_VAGUE_MATCH_TOKENS.has(t)) return false;
    if (t === "roti" || t === "roata") return false;
    return true;
  });
  return specific.length >= 1;
}

/**
 * Gate handoff evaluation so active clarification/selection journeys are not interrupted.
 * @param {object} sessionContext
 * @param {object} [opts]
 */
function canEvaluateHumanHandoff(sessionContext, opts = {}) {
  const ctx = sessionContext && typeof sessionContext === "object" ? sessionContext : {};
  const purpose = String(opts.purpose || "");
  const isT1Probe = purpose === "t1_niche_wheel" || purpose === "t1_cold_start";
  const isT2Probe = purpose === "pre_clarification_emit";
  const isT3Probe = purpose === "t3_low_signal";
  const skipContinuationBlocks = isT1Probe || isT2Probe || isT3Probe;

  if (opts.clarificationPendingAtEntry && !isT3Probe) {
    return false;
  }
  if (opts.pendingSlotClarificationActive && !isT2Probe) {
    return false;
  }
  if (ctx.pendingSelection === true && !isT2Probe) {
    return false;
  }
  if (String(ctx.state || "").startsWith("NEEDS_") && !isT2Probe) {
    return false;
  }
  if (
    (ctx.originalIntent === "selection" || ctx.originalIntent === "product_guidance") &&
    !isT2Probe &&
    !isT3Probe
  ) {
    return false;
  }

  const pending = ctx.pendingQuestion;
  if (pending?.source === "coverage_role_goal") {
    return false;
  }
  if (pending?.type === "confirm_context") {
    return false;
  }
  if (
    pending?.slot &&
    ["context", "object", "surface"].includes(String(pending.slot)) &&
    !isT2Probe
  ) {
    return false;
  }

  const msg = String(opts.userMessage || "").trim();
  const skipSlotFillGuards = isT1Probe || isT3Probe || isT2Probe;
  if (msg && !skipSlotFillGuards) {
    if (opts.isDirectPendingClarificationAnswer) {
      return false;
    }
    if (opts.isShortSlotValueMessage) {
      return false;
    }
    if (opts.isLikelySlotFill) {
      return false;
    }
    if (COVERAGE_GOAL_REPLY.test(msg)) {
      return false;
    }
  }
  if (msg && isT1Probe) {
    if (/\b(what|how|which|when|why|can i|could i)\b/i.test(msg)) {
      return false;
    }
  }

  return true;
}

function clearHandoffState(sessionContext) {
  if (!sessionContext || typeof sessionContext !== "object") {
    return;
  }
  delete sessionContext.handoff;
}

/**
 * F13 — evaluate whether human handoff should fire (T1–T3).
 * @param {object} params
 * @returns {{ trigger: boolean, reason?: "T1"|"T2"|"T3" }}
 */
function evaluateHumanHandoffTrigger({
  sessionContext,
  intent,
  slots,
  retrieval,
  pendingQuestion,
  turnHistory: _turnHistory
}) {
  const ctx = sessionContext && typeof sessionContext === "object" ? sessionContext : {};
  if (ctx.handoff?.state === "handoff_complete") {
    return { trigger: false };
  }
  if (ctx.handoff?.state === "awaiting_contact" || ctx.handoff?.state === "awaiting_retry") {
    return { trigger: false };
  }

  const intentType =
    intent?.type ??
    intent?.intentType ??
    (typeof intent === "string" ? intent : null) ??
    ctx.lastDetectIntentType ??
    null;

  const isProductSearch =
    intentType === "product_search" ||
    (intentType === "selection" && ctx.pendingSelection === true);

  const tokenMatches = Array.isArray(retrieval?.tokenInferenceMatches)
    ? retrieval.tokenInferenceMatches
    : [];
  const poolSize =
    retrieval?.poolSize ??
    retrieval?.retrievalCandidateCount ??
    (Array.isArray(retrieval?.candidates) ? retrieval.candidates.length : null);

  const pending =
    pendingQuestion ??
    ctx.pendingQuestion ??
    null;
  const hasPending = Boolean(
    pending &&
      (pending.active !== false || pending.slot || pending.type)
  );

  const slotsObj = slots && typeof slots === "object" ? slots : ctx.slots || {};
  const hasAnchorSlot = Boolean(
    slotsObj.context || slotsObj.object || slotsObj.surface
  );

  const nicheZeroPool =
    poolSize === 0 &&
    isNicheZeroRetrieval({
      candidates: retrieval?.candidates || [],
      matchText: retrieval?.matchText
    });

  if (
    isProductSearch &&
    tokenMatches.length === 0 &&
    nicheZeroPool &&
    !hasPending &&
    !hasAnchorSlot
  ) {
    return { trigger: true, reason: "T1" };
  }

  const missingSlot =
    retrieval?.missingSlot ??
    pending?.slot ??
    null;
  if (missingSlot && ["context", "object", "surface"].includes(String(missingSlot))) {
    const loopCounts = ctx.clarificationLoopCount && typeof ctx.clarificationLoopCount === "object"
      ? ctx.clarificationLoopCount
      : {};
    const count = Number(loopCounts[missingSlot] || 0);
    if (count >= 2) {
      return { trigger: true, reason: "T2" };
    }
  }

  const deadEnds = Number(ctx.lowSignalConsecutiveDeadEnds || 0);
  if (
    retrieval?.lowSignalDetected === true &&
    !hasPending &&
    tokenMatches.length === 0 &&
    deadEnds >= 3
  ) {
    return { trigger: true, reason: "T3" };
  }

  return { trigger: false };
}

function ensureHandoffSessionFields(sessionContext) {
  if (!sessionContext || typeof sessionContext !== "object") return;
  if (!sessionContext.clarificationLoopCount || typeof sessionContext.clarificationLoopCount !== "object") {
    sessionContext.clarificationLoopCount = {};
  }
  if (!Number.isFinite(Number(sessionContext.lowSignalConsecutiveDeadEnds))) {
    sessionContext.lowSignalConsecutiveDeadEnds = 0;
  }
}

function recordClarificationLoopAsk(sessionContext, missingSlot) {
  ensureHandoffSessionFields(sessionContext);
  if (!missingSlot) return;
  const slot = String(missingSlot);
  const prev = sessionContext.lastClarificationLoopSlot;
  if (prev && prev !== slot) {
    sessionContext.clarificationLoopCount = { [slot]: 1 };
  } else {
    sessionContext.clarificationLoopCount[slot] =
      (sessionContext.clarificationLoopCount[slot] || 0) + 1;
  }
  sessionContext.lastClarificationLoopSlot = slot;
}

function resetClarificationLoopOnSlotFill(sessionContext, filledSlot) {
  if (!sessionContext?.clarificationLoopCount) return;
  if (filledSlot) {
    delete sessionContext.clarificationLoopCount[filledSlot];
  }
  sessionContext.lastClarificationLoopSlot = null;
}

function recordLowSignalDeadEnd(sessionContext, { lowSignalDetected, pendingCleared, tokenMatchesEmpty }) {
  ensureHandoffSessionFields(sessionContext);
  if (lowSignalDetected && pendingCleared && tokenMatchesEmpty) {
    sessionContext.lowSignalConsecutiveDeadEnds =
      Number(sessionContext.lowSignalConsecutiveDeadEnds || 0) + 1;
  } else if (!lowSignalDetected || !tokenMatchesEmpty) {
    sessionContext.lowSignalConsecutiveDeadEnds = 0;
  }
}

module.exports = {
  evaluateHumanHandoffTrigger,
  isNicheZeroRetrieval,
  canEvaluateHumanHandoff,
  clearHandoffState,
  recordClarificationLoopAsk,
  resetClarificationLoopOnSlotFill,
  recordLowSignalDeadEnd,
  ensureHandoffSessionFields
};
