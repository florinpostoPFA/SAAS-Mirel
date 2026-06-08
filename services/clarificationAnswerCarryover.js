"use strict";

const logger = require("./logger");
const { extractActionCategoryTags } = require("./clarificationFirstPolicy");

const CARRYOVER_PENDING_SLOTS = new Set(["context", "object", "surface", "intent_level"]);

const ACTION_CATEGORY_TAGS = new Set([
  "cleaning",
  "protection",
  "polish",
  "restore",
  "maintain",
  "protect",
  "dress",
  "decontaminate",
  "wax",
  "hydrate"
]);

function normalizeTag(t) {
  return String(t || "").toLowerCase().trim();
}

function isActionCategoryTag(tag) {
  return ACTION_CATEGORY_TAGS.has(normalizeTag(tag));
}

function shouldArmCarryover(pendingQuestion) {
  if (!pendingQuestion || typeof pendingQuestion !== "object") return false;
  if (pendingQuestion.type === "confirm_context") return false;
  const slot = normalizeTag(pendingQuestion.slot);
  return CARRYOVER_PENDING_SLOTS.has(slot);
}

function snapshotSlots(slots) {
  const s = slots && typeof slots === "object" ? slots : {};
  return {
    action: s.action ?? null,
    context: s.context ?? null,
    surface: s.surface ?? null,
    object: s.object ?? null
  };
}

function armClarificationAnswerCarryover(sessionContext, interactionRef, pendingQuestion) {
  if (!sessionContext || !shouldArmCarryover(pendingQuestion)) return false;

  const prior = sessionContext.clarificationAnswerCarryover;
  const currentSlots = snapshotSlots(sessionContext.slots);
  const priorSlots = prior?.slots && typeof prior.slots === "object" ? prior.slots : {};
  const mergedSlots = {
    action: currentSlots.action ?? priorSlots.action ?? null,
    context: currentSlots.context ?? priorSlots.context ?? null,
    surface: currentSlots.surface ?? priorSlots.surface ?? null,
    object: currentSlots.object ?? priorSlots.object ?? null
  };

  const currentTags = Array.isArray(sessionContext.tags) ? sessionContext.tags : [];
  const priorTags = Array.isArray(prior?.tags) ? prior.tags : [];
  const tags = [...new Set([...priorTags, ...currentTags].map(normalizeTag).filter(Boolean))];

  sessionContext.clarificationAnswerCarryover = {
    pendingSlot: normalizeTag(pendingQuestion.slot),
    slots: mergedSlots,
    tags,
    slotMeta:
      sessionContext.slotMeta && typeof sessionContext.slotMeta === "object"
        ? { ...sessionContext.slotMeta, ...(prior?.slotMeta || {}) }
        : prior?.slotMeta || null,
    armedAtTraceId: interactionRef?.traceId ?? null
  };

  logger.logInfo("CLARIFICATION_CARRYOVER_ARMED", {
    slot: sessionContext.clarificationAnswerCarryover.pendingSlot,
    action: mergedSlots.action,
    tags,
    traceId: interactionRef?.traceId ?? null,
    sessionId: interactionRef?.sessionId ?? sessionContext?.sessionId ?? null
  });
  return true;
}

function mergeCarryoverTagsWithAnswer({
  carryoverTags,
  answerCoreTags,
  userMessage,
  slots,
  answeredSlot = null
}) {
  const carried = (Array.isArray(carryoverTags) ? carryoverTags : []).map(normalizeTag).filter(Boolean);
  const answerTags = (Array.isArray(answerCoreTags) ? answerCoreTags : []).map(normalizeTag).filter(Boolean);
  const answerCategories = new Set(extractActionCategoryTags(answerTags, slots));
  const slotOnlyAnswer = ["context", "object", "surface", "intent_level"].includes(
    normalizeTag(answeredSlot)
  );

  const merged = new Set([...carried, ...answerTags]);

  if (answerCategories.size > 0 && !slotOnlyAnswer) {
    for (const tag of carried) {
      if (isActionCategoryTag(tag) && !answerCategories.has(tag)) {
        merged.delete(tag);
      }
    }
    for (const cat of answerCategories) {
      merged.add(cat);
    }
  }

  return [...merged];
}

function hydrateClarificationAnswerCarryover(sessionContext, interactionRef, answeredSlot) {
  const carry = sessionContext?.clarificationAnswerCarryover;
  if (!carry || typeof carry !== "object") {
    return { hydrated: false };
  }

  sessionContext.slots = sessionContext.slots && typeof sessionContext.slots === "object"
    ? sessionContext.slots
    : {};
  sessionContext.slotMeta =
    sessionContext.slotMeta && typeof sessionContext.slotMeta === "object"
      ? sessionContext.slotMeta
      : { context: "unknown", surface: "unknown", object: "unknown" };

  const carriedSlots = carry.slots && typeof carry.slots === "object" ? carry.slots : {};
  let restoredAction = null;
  const answeredSlotNorm = normalizeTag(answeredSlot);

  if (answeredSlotNorm === "intent_level" && carriedSlots.action) {
    if (
      sessionContext.slots.action == null ||
      String(sessionContext.slots.action).trim() === ""
    ) {
      sessionContext.slots.action = carriedSlots.action;
    }
    sessionContext.slotMeta.action = "carried";
    restoredAction = sessionContext.slots.action;
  } else if (
    (sessionContext.slots.action == null || String(sessionContext.slots.action).trim() === "") &&
    carriedSlots.action
  ) {
    sessionContext.slots.action = carriedSlots.action;
    sessionContext.slotMeta.action = "carried";
    restoredAction = carriedSlots.action;
  } else if (sessionContext.slots.action && carriedSlots.action) {
    sessionContext.slotMeta.action = sessionContext.slotMeta.action || "carried";
    restoredAction = sessionContext.slots.action;
  }

  for (const key of ["context", "surface", "object"]) {
    if (key === answeredSlot) continue;
    const cur = sessionContext.slots[key];
    const empty = cur == null || String(cur).trim() === "";
    if (empty && carriedSlots[key]) {
      sessionContext.slots[key] = carriedSlots[key];
      if (sessionContext.slotMeta[key] !== "confirmed") {
        sessionContext.slotMeta[key] = "carried";
      }
    }
  }

  const restoredTags = mergeCarryoverTagsWithAnswer({
    carryoverTags: carry.tags || [],
    answerCoreTags: [],
    userMessage: interactionRef?.message || "",
    slots: sessionContext.slots,
    answeredSlot: answeredSlot || null
  });
  sessionContext.tags = restoredTags;
  if (interactionRef && typeof interactionRef === "object") {
    interactionRef.tags = [...restoredTags];
  }

  logger.logInfo("CLARIFICATION_CARRYOVER_HYDRATED", {
    restoredAction: restoredAction ?? sessionContext.slots.action ?? null,
    restoredTags,
    answeredSlot: answeredSlot || null,
    traceId: interactionRef?.traceId ?? null,
    sessionId: interactionRef?.sessionId ?? sessionContext?.sessionId ?? null
  });

  return {
    hydrated: true,
    restoredAction: restoredAction ?? sessionContext.slots.action ?? null,
    restoredTags
  };
}

function clearClarificationAnswerCarryover(sessionContext) {
  if (sessionContext && sessionContext.clarificationAnswerCarryover) {
    delete sessionContext.clarificationAnswerCarryover;
  }
}

function applyCarriedSlotsForTelemetry(interactionRef, sessionContext) {
  if (!interactionRef || !sessionContext) return;
  const carry = sessionContext.clarificationAnswerCarryover;
  const carriedSlots =
    carry?.slots && typeof carry.slots === "object" ? carry.slots : {};
  const meta =
    sessionContext.slotMeta && typeof sessionContext.slotMeta === "object"
      ? sessionContext.slotMeta
      : {};
  const live =
    sessionContext.slots && typeof sessionContext.slots === "object"
      ? sessionContext.slots
      : {};
  interactionRef.slots =
    interactionRef.slots && typeof interactionRef.slots === "object"
      ? { ...interactionRef.slots }
      : { ...live };

  const hydratedTurn = Boolean(
    interactionRef.clarificationCarryoverHydratedTurn ||
    interactionRef.clarificationAnswerResolution
  );

  for (const key of ["action", "context", "surface", "object"]) {
    const value = live[key] ?? carriedSlots[key] ?? null;
    if (hydratedTurn) {
      if (value != null && String(value).trim() !== "") {
        interactionRef.slots[key] = value;
      }
      continue;
    }
    if (meta[key] !== "carried") continue;
    if (value != null && String(value).trim() !== "") {
      interactionRef.slots[key] = value;
    }
  }
}

function discardClarificationAnswerCarryover(sessionContext, reason) {
  if (!sessionContext?.clarificationAnswerCarryover) return;
  logger.logInfo("CLARIFICATION_CARRYOVER_DISCARDED", {
    reason: reason || "unknown",
    sessionId: sessionContext.sessionId ?? null
  });
  clearClarificationAnswerCarryover(sessionContext);
}

module.exports = {
  CARRYOVER_PENDING_SLOTS,
  shouldArmCarryover,
  armClarificationAnswerCarryover,
  hydrateClarificationAnswerCarryover,
  mergeCarryoverTagsWithAnswer,
  clearClarificationAnswerCarryover,
  discardClarificationAnswerCarryover,
  applyCarriedSlotsForTelemetry
};
