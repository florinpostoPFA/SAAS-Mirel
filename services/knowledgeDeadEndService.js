/**
 * Deterministic knowledge dead-end detection + single-question recovery (CTO: max 1 clarifier).
 */

const { logInfo } = require("./logger");

const NO_INFO_PATTERNS = [
  /nu\s+(stiu|știu|avem)/i,
  /nu\s+am\s+informatii/i,
  /nu\s+pot\s+(sa|să)\s+continua/i,
  /fara\s+raspuns/i,
  /^ok\.?$/i,
  /^da\.?$/i
];

const ACTIONABLE_CUES = [
  "spune-mi",
  "spune mi",
  "incepem",
  "începem",
  "poți alege",
  "poti alege",
  "exemplu",
  "ex.:",
  "pas ",
  "paș",
  "pasii",
  "intreaba",
  "întreab",
  "vrei sa",
  "vrei să",
  "spui",
  "pentru interior",
  "pentru exterior",
  "recomand",
  "ghid",
  "curatare",
  "curățare",
  "detailing",
  "produs",
  "produse"
];

const STRONG_PRODUCT_SIGNALS = [
  "vreau",
  "recomanzi",
  "recomanda",
  "ce soluție",
  "ce solutie",
  "ce dressing",
  "prosop",
  "sampon",
  "șampon",
  "ceara",
  "ceară",
  "ce produs",
  "imi trebuie",
  "îmi trebuie"
];

function shouldBypassKnowledgeDeadEndRecovery(interactionRef) {
  if (!interactionRef || typeof interactionRef !== "object") {
    return true;
  }
  const raw = String(interactionRef.message || "").trim();
  const lower = raw.toLowerCase();
  if (/^ce\s+(este|e)\s+/i.test(raw)) {
    return true;
  }
  if (/^ce\s+inseamna/i.test(lower)) {
    return true;
  }
  if (/^cum\s+functioneaza\b/i.test(lower)) {
    return true;
  }
  if (/^cat\s+(dureaza|cost)/i.test(lower)) {
    return true;
  }
  if (/^de\s+ce\b/i.test(lower)) {
    return true;
  }
  if (/^care\s+(e|este)\s+diferentele/i.test(lower)) {
    return true;
  }
  return false;
}

function normalizeReplyText(result) {
  if (!result || typeof result !== "object") return "";
  return String(result.reply ?? result.message ?? "").trim();
}

function hasActionableKnowledgeCue(text) {
  const t = String(text || "").toLowerCase();
  return ACTIONABLE_CUES.some((c) => t.includes(c));
}

function isKnowledgeDeadEnd({
  decision,
  outputType,
  finalProducts,
  replyText,
  queryType
}) {
  if (!decision || decision.action !== "knowledge") return false;
  if (queryType === "safety") return false;
  if (outputType === "question" || outputType === "flow") return false;

  const plen = Array.isArray(finalProducts) ? finalProducts.length : 0;
  if (plen > 0) return false;

  const text = String(replyText || "").trim();
  if (!text) return true;

  if (text.includes("?")) return false;

  if (hasActionableKnowledgeCue(text)) return false;

  if (text.length < 48) return true;

  return NO_INFO_PATTERNS.some((p) => p.test(text));
}

function messageSuggestsDiscountOnly(message) {
  const msg = String(message || "").toLowerCase();
  if (!/(reducere|reduceri|discount|cod\s|codul|campanie|promo)/.test(msg)) {
    return false;
  }
  if (/(curat|curăț|detailing|jante|geam|piele|vopsea|masina|mașina)/.test(msg)) {
    return false;
  }
  return true;
}

function hasStrongProductIntent(message) {
  const msg = String(message || "").toLowerCase();
  return STRONG_PRODUCT_SIGNALS.some((k) => msg.includes(k));
}

/**
 * @param {object} deps
 * @param {Function} deps.getMissingSlot - (slots) => string | null
 */
function pickKnowledgeRecovery(deps) {
  const {
    slots,
    userMessage,
    sessionContext,
    getMissingSlot
  } = deps;

  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const count = sessionContext?.knowledgeDeadEndRecoveryCount || 0;

  if (count >= 1) {
    return {
      message:
        "Iti pot ajuta cu pasi (cum se face) sau cu produse concrete. Spune-mi pe scurt: interior sau exterior, si ce vrei sa cureti sau sa protejezi?",
      missingSlot: null,
      questionType: "handoff",
      reason: "recovery_repeat_cap",
      mode: "knowledge_reply"
    };
  }

  if (messageSuggestsDiscountOnly(userMessage)) {
    return {
      message: "Cauti cod/campanie sau discount la un produs anume?",
      missingSlot: null,
      questionType: "discount",
      reason: "discount_intent",
      mode: "knowledge_reply"
    };
  }

  const missing = typeof getMissingSlot === "function" ? getMissingSlot(safeSlots) : null;

  if (missing === "context" || (!safeSlots.context && hasStrongProductIntent(userMessage))) {
    return {
      message: "E pentru interior sau exterior?",
      missingSlot: "context",
      questionType: "context",
      reason: missing === "context" ? "missing_context" : "product_signal_missing_context",
      mode: "clarification"
    };
  }

  if (missing === "object") {
    return {
      message:
        "Ce vrei sa cureti sau sa ingrijesti exact? (ex: bord, scaune, jante, anvelope, geamuri)",
      missingSlot: "object",
      questionType: "object",
      reason: "missing_object",
      mode: "clarification"
    };
  }

  if (missing === "surface") {
    return {
      message: "Din ce material e suprafata? (plastic / textil / piele / sticla)",
      missingSlot: "surface",
      questionType: "surface",
      reason: "missing_surface",
      mode: "clarification"
    };
  }

  return {
    message: "Vrei pasi (cum se face) sau recomandare de produse?",
    missingSlot: null,
    questionType: "intent",
    reason: "low_signal",
    mode: "knowledge_reply"
  };
}

/**
 * @returns {null|object} patch to apply inside endInteraction
 */
function buildKnowledgeDeadEndRecoveryPatch({
  interactionRef,
  sessionContext,
  finalResult,
  finalOutputType,
  finalProducts,
  getMissingSlot
}) {
  if (shouldBypassKnowledgeDeadEndRecovery(interactionRef)) {
    return null;
  }

  const replyText = normalizeReplyText(finalResult);
  const dead = isKnowledgeDeadEnd({
    decision: interactionRef?.decision,
    outputType: finalOutputType,
    finalProducts,
    replyText,
    queryType: interactionRef?.queryType
  });

  if (!dead) {
    return null;
  }

  const pick = pickKnowledgeRecovery({
    slots: interactionRef?.slots,
    userMessage: interactionRef?.message,
    sessionContext,
    getMissingSlot
  });

  const telemetry = {
    knowledgeDeadEndDetected: true,
    knowledgeRecoveryApplied: true,
    knowledgeRecoveryReason: pick.reason,
    knowledgeRecoveryQuestionType: pick.questionType
  };

  logInfo("KNOWLEDGE_DEAD_END_RECOVERY", {
    ...telemetry,
    mode: pick.mode,
    missingSlot: pick.missingSlot
  });

  const nextCount =
    pick.questionType === "handoff"
      ? 0
      : (sessionContext?.knowledgeDeadEndRecoveryCount || 0) + 1;

  if (pick.mode === "clarification" && pick.missingSlot) {
    const q = pick.message;
    return {
      finalResult: {
        type: "question",
        message: q
      },
      finalOutputType: "question",
      finalProducts: [],
      decision: {
        action: "clarification",
        flowId: null,
        missingSlot: pick.missingSlot,
        knowledgeRecovery: true
      },
      pendingQuestion: {
        slot: pick.missingSlot,
        source: "knowledge_dead_end",
        recoveryQuestionType: pick.questionType,
        object: sessionContext?.slots?.object || null,
        context: sessionContext?.slots?.context || null
      },
      sessionFlags: {
        knowledgeDeadEndRecoveryCount: nextCount
      },
      telemetry
    };
  }

  const q = pick.message;
  return {
    finalResult: {
      ...finalResult,
      type: "reply",
      reply: q,
      message: q
    },
    finalOutputType: "reply",
    finalProducts: [],
    decision: {
      action: "knowledge",
      flowId: null,
      missingSlot: null,
      knowledgeRecovery: true
    },
    pendingQuestion: null,
    sessionFlags: {
      knowledgeDeadEndRecoveryCount: nextCount
    },
    telemetry
  };
}

module.exports = {
  isKnowledgeDeadEnd,
  hasActionableKnowledgeCue,
  pickKnowledgeRecovery,
  buildKnowledgeDeadEndRecoveryPatch,
  normalizeReplyText,
  shouldBypassKnowledgeDeadEndRecovery
};
