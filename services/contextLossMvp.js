/**
 * Context loss detection & recovery (MVP) — deterministic-first.
 * Does not import chatService; safe to unit test.
 */

"use strict";

/** @typedef {"paint"|"glass"|"leather"|"plastic"|"textile"|"alcantara"|"wheels"|"tires"|"unknown"} Surface */

const INCONSISTENCY_SCORE_THRESHOLD = 2;
/** Single-keyword surface hints can still auto-confirm the slot for routing (separate from inconsistency threshold). */
const AUTO_CONFIRM_SURFACE_MIN_SCORE = 1;

const SURFACE_KEYWORDS = {
  wheels: ["jante", "jantă", "jantei", "roti", "roți", "wheel", "wheels"],
  tires: ["anvelope", "anvelopă", "cauciuc", "tire", "tires", "rubber"],
  paint: ["caroserie", "vopsea", "polish", "luciu", "lac", "clearcoat", "exterior paint"],
  glass: ["geam", "parbriz", "sticlă", "sticla", "glass"],
  leather: ["piele", "leather"],
  plastic: ["plastic", "bord"],
  textile: ["textil", "mocheta", "scaun", "țesut"],
  alcantara: ["alcantara", "alcantará"]
};

/** @type {Record<string, { slots: string[]; surfaceMustBe?: Surface; surfaceMustBeAnyOf?: Surface[] }>} */
const requiredSlotsByFlowId = {
  wheel_cleaning: { slots: ["surface"], surfaceMustBe: "wheels" },
  tire_dressing: { slots: ["surface"], surfaceMustBe: "tires" },
  glass_cleaning: { slots: ["surface"], surfaceMustBe: "glass" },
  leather_cleaning: { slots: ["surface"], surfaceMustBe: "leather" },
  wheel_tire_deep_clean: { slots: ["surface"], surfaceMustBeAnyOf: ["wheels", "tires"] },
  glass_clean_basic: { slots: ["surface"], surfaceMustBe: "glass" },
  leather_program_basic: { slots: ["surface"], surfaceMustBe: "leather" },
  leather_ink_removal: { slots: ["surface"], surfaceMustBe: "leather" }
};

/**
 * @param {Record<string, unknown>|null|undefined} slots
 * @param {Record<string, unknown>|null|undefined} slotMeta
 * @param {number} routingTurnIndex
 * @param {Record<string, unknown>|null|undefined} existingMvp
 */
function buildConversationContextFromSession(slots, slotMeta, routingTurnIndex, existingMvp = null) {
  const s = slots && typeof slots === "object" ? slots : {};
  const meta = slotMeta && typeof slotMeta === "object" ? slotMeta : {};
  const value = inferSurfaceValue(s);
  const status =
    meta.surface === "confirmed"
      ? "confirmed"
      : value && value !== "unknown"
        ? "inferred"
        : "inferred";

  const mvp = existingMvp && typeof existingMvp === "object" ? { ...existingMvp } : {};
  return {
    surface:
      value && value !== "unknown"
        ? { value, status, confidence: status === "confirmed" ? 1 : 0.6, updatedAtTurn: routingTurnIndex }
        : undefined,
    activeFlow: mvp.activeFlow,
    pendingQuestion: mvp.pendingQuestion,
    historySignals: mvp.historySignals || {},
    recovery: mvp.recovery
  };
}

/**
 * @param {Record<string, unknown>} slots
 * @returns {Surface}
 */
function inferSurfaceValue(slots) {
  const surf = String(slots.surface || "").toLowerCase().trim();
  const obj = String(slots.object || "").toLowerCase().trim();
  if (["wheels", "tires", "paint", "glass", "leather", "plastic", "textile", "alcantara"].includes(surf)) {
    return /** @type {Surface} */ (surf);
  }
  if (obj === "jante" || obj === "roti" || obj === "wheels") return "wheels";
  if (obj === "anvelope") return "tires";
  if (obj === "caroserie" || obj === "vopsea" || surf === "vopsea") return "paint";
  if (obj === "glass" || obj === "parbriz" || obj === "geam" || obj === "geamuri") return "glass";
  if (surf === "piele" || obj.includes("piele")) return "leather";
  if (surf === "plastic" || obj === "bord") return "plastic";
  if (surf === "textile" || obj === "mocheta") return "textile";
  if (surf === "alcantara") return "alcantara";
  return "unknown";
}

/**
 * @param {string} message
 * @returns {{ surface: Surface; score: number }[]}
 */
function extractSurfaceCandidatesFromMessage(message) {
  const msg = String(message || "").toLowerCase();
  const scores = /** @type {Record<string, number>} */ ({});
  for (const [surf, words] of Object.entries(SURFACE_KEYWORDS)) {
    let sc = 0;
    for (const w of words) {
      if (msg.includes(w)) sc += 1;
    }
    if (sc > 0) scores[surf] = sc;
  }
  return Object.entries(scores)
    .map(([surface, score]) => ({ surface: /** @type {Surface} */ (surface), score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * @param {string} flowId
 * @param {ReturnType<typeof buildConversationContextFromSession>} ctx
 * @returns {{ ok: true } | { ok: false; missingSlots: string[]; invalidReasons: string[] }}
 */
function validateContextForFlow(flowId, ctx) {
  const spec = requiredSlotsByFlowId[flowId];
  if (!spec) {
    return { ok: true };
  }
  const missingSlots = [];
  const invalidReasons = [];

  for (const slot of spec.slots) {
    if (slot === "surface") {
      if (!ctx.surface || !ctx.surface.value || ctx.surface.value === "unknown") {
        missingSlots.push("surface");
      } else if (ctx.surface.status !== "confirmed") {
        missingSlots.push("surface");
      }
    }
  }

  if (spec.surfaceMustBe) {
    if (ctx.surface?.status === "confirmed" && ctx.surface.value !== spec.surfaceMustBe) {
      invalidReasons.push(`surface_mismatch_need_${spec.surfaceMustBe}`);
    }
  }
  if (spec.surfaceMustBeAnyOf && spec.surfaceMustBeAnyOf.length > 0) {
    if (ctx.surface?.status === "confirmed" && !spec.surfaceMustBeAnyOf.includes(ctx.surface.value)) {
      invalidReasons.push("surface_not_in_allowed_set");
    }
  }

  if (missingSlots.length || invalidReasons.length) {
    return { ok: false, missingSlots, invalidReasons };
  }
  return { ok: true };
}

/**
 * @param {object} p
 * @param {ReturnType<typeof buildConversationContextFromSession>} p.ctx
 * @param {string} p.slotName
 * @param {number} p.routingTurnIndex
 * @param {string} p.message
 * @param {boolean} [p.surfaceSlotConfirmed] slotMeta.surface === "confirmed"
 * @returns {{ contextLossDetected: boolean; reason?: "repeat_clarification"|"inconsistency"|"missing_required_slots" }}
 */
function detectContextLoss({ ctx, slotName, routingTurnIndex, message, surfaceSlotConfirmed = false }) {
  const hist = ctx.historySignals || {};
  const lastSlot = hist.lastClarificationSlot;
  const lastTurn = hist.lastClarificationTurn;

  if (
    lastSlot === slotName &&
    lastTurn != null &&
    routingTurnIndex - lastTurn <= 3 &&
    slotName === "surface" &&
    !surfaceSlotConfirmed
  ) {
    return { contextLossDetected: true, reason: "repeat_clarification" };
  }

  if (surfaceSlotConfirmed && ctx.surface?.value && ctx.surface.value !== "unknown") {
    const candidates = extractSurfaceCandidatesFromMessage(message);
    if (candidates.length > 0) {
      const top = candidates[0];
      if (top.score >= INCONSISTENCY_SCORE_THRESHOLD && top.surface !== ctx.surface.value) {
        return { contextLossDetected: true, reason: "inconsistency" };
      }
    }
  }

  return { contextLossDetected: false };
}

function buildRecoveryClarificationRo() {
  return (
    "Cred că am pierdut puțin firul discuției.\n\n" +
    "Vorbim de jante sau de caroserie?\n\n" +
    "Spune-mi suprafața (jante / caroserie / geamuri / interior) și continui cu pașii exacți."
  );
}

function buildRecoveryClarificationEn() {
  return (
    "I may have lost the thread a bit.\n\n" +
    "Are we on wheels/paint or something else?\n\n" +
    "Tell me the surface (wheels / paint / glass / interior) and I will continue with the exact steps."
  );
}

function buildNarrowDegradedQuestionRo() {
  return "Vrei pași concreți de curățare sau o recomandare de produse? (răspunde: pași / recomandare)";
}

function buildNarrowDegradedQuestionEn() {
  return "Do you want concrete cleaning steps or product recommendations? (answer: steps / products)";
}

/**
 * @param {string} locale
 * @param {boolean} useRecovery
 * @param {boolean} useDegraded
 * @param {string} normalQuestion
 */
/**
 * Deterministic auto-confirm when the user message contains strong evidence for the current surface slot.
 * Mutates `slotMeta` in place (procedural path only; caller must gate).
 * @param {string} message
 * @param {Record<string, unknown>} slots
 * @param {Record<string, unknown>} slotMeta
 */
function maybeAutoConfirmSurfaceFromMessage(message, slots, slotMeta) {
  const meta = slotMeta && typeof slotMeta === "object" ? slotMeta : {};
  if (String(meta.surface || "").toLowerCase() === "confirmed") {
    return;
  }
  const slotObj = slots && typeof slots === "object" ? slots : {};
  const surf = inferSurfaceValue(slotObj);
  if (!surf || surf === "unknown") {
    return;
  }
  const candidates = extractSurfaceCandidatesFromMessage(message);
  const top = candidates[0];
  if (
    top &&
    top.surface === surf &&
    top.score >= AUTO_CONFIRM_SURFACE_MIN_SCORE
  ) {
    meta.surface = "confirmed";
    return;
  }

  const objPinned = inferSurfaceValue({
    context: slotObj.context,
    object: slotObj.object
  });
  if (objPinned !== surf || surf === "unknown") {
    return;
  }
  if (
    top &&
    top.surface !== surf &&
    top.score >= AUTO_CONFIRM_SURFACE_MIN_SCORE
  ) {
    return;
  }
  meta.surface = "confirmed";
}

function pickClarificationQuestion(locale, useRecovery, useDegraded, normalQuestion) {
  const loc = String(locale || "ro").toLowerCase() === "en" ? "en" : "ro";
  if (useDegraded) {
    return loc === "en" ? buildNarrowDegradedQuestionEn() : buildNarrowDegradedQuestionRo();
  }
  if (useRecovery) {
    return loc === "en" ? buildRecoveryClarificationEn() : buildRecoveryClarificationRo();
  }
  return normalQuestion;
}

/**
 * @param {Record<string, unknown>} sessionContext
 * @returns {Record<string, unknown>}
 */
function ensureMvpBucket(sessionContext) {
  if (!sessionContext.conversationContextMvp || typeof sessionContext.conversationContextMvp !== "object") {
    sessionContext.conversationContextMvp = {
      historySignals: {},
      recovery: { active: false }
    };
  }
  return sessionContext.conversationContextMvp;
}

/**
 * After emitting a clarification for `slot`.
 * @param {Record<string, unknown>} sessionContext
 * @param {string} slot
 * @param {number} routingTurnIndex
 * @param {{ clarificationType: "normal"|"recovery"; contextLossDetected?: boolean; reason?: string|null; degraded?: boolean }} opts
 */
function recordClarificationEmitMvp(sessionContext, slot, routingTurnIndex, opts) {
  const clarificationType = opts.clarificationType || "normal";
  const reason = opts.reason || null;
  const mvp = ensureMvpBucket(sessionContext);
  const hist = { ...(mvp.historySignals || {}) };
  if (hist.lastClarificationSlot === slot && hist.lastClarificationTurn != null) {
    const gap = routingTurnIndex - hist.lastClarificationTurn;
    if (gap <= 3) {
      hist.repeatedSlotAsksCount = (hist.repeatedSlotAsksCount || 0) + 1;
    } else {
      hist.repeatedSlotAsksCount = 1;
    }
  } else {
    hist.repeatedSlotAsksCount = 1;
  }
  hist.lastClarificationSlot = slot;
  hist.lastClarificationTurn = routingTurnIndex;
  mvp.historySignals = hist;

  if (opts.degraded) {
    mvp.recovery = {
      active: true,
      reason: "repeat_clarification",
      startedAtTurn: routingTurnIndex,
      consecutiveTriggers: (mvp.recovery?.consecutiveTriggers || 0) + 1
    };
    return;
  }

  if (clarificationType === "recovery" && opts.contextLossDetected) {
    const prevN = mvp.recovery?.consecutiveTriggers || 0;
    mvp.recovery = {
      active: true,
      reason: /** @type {"repeat_clarification"|"inconsistency"|"missing_required_slots"} */ (
        reason || "repeat_clarification"
      ),
      startedAtTurn: routingTurnIndex,
      consecutiveTriggers: prevN + 1
    };
  } else if (clarificationType === "normal") {
    mvp.recovery = { active: false, consecutiveTriggers: 0, reason: undefined, startedAtTurn: undefined };
  }
}

/** Clear recovery after successful slot answer (procedural only). */
function clearRecoveryMvp(sessionContext) {
  const mvp = sessionContext?.conversationContextMvp;
  if (mvp && typeof mvp === "object") {
    mvp.recovery = { active: false, consecutiveTriggers: 0 };
    if (mvp.historySignals) {
      mvp.historySignals.repeatedSlotAsksCount = 0;
    }
  }
}

module.exports = {
  requiredSlotsByFlowId,
  INCONSISTENCY_SCORE_THRESHOLD,
  AUTO_CONFIRM_SURFACE_MIN_SCORE,
  buildConversationContextFromSession,
  inferSurfaceValue,
  extractSurfaceCandidatesFromMessage,
  maybeAutoConfirmSurfaceFromMessage,
  validateContextForFlow,
  detectContextLoss,
  buildRecoveryClarificationRo,
  pickClarificationQuestion,
  ensureMvpBucket,
  recordClarificationEmitMvp,
  clearRecoveryMvp
};
