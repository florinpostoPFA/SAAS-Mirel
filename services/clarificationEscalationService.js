"use strict";

const MAX_FAILED_ATTEMPTS = 2;
const UNKNOWN_VALUE = "__UNKNOWN__";
const STILL_UNKNOWN_VALUE = "__STILL_UNKNOWN__";
const OTHER_VALUE = "__OTHER__";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .replace(/[^a-z0-9_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ensurePendingPolicyState(pendingQuestion, missingSlot) {
  const p = pendingQuestion && typeof pendingQuestion === "object" ? pendingQuestion : {};
  const slot = String(missingSlot || p.slot || "").toLowerCase().trim() || null;
  return {
    ...p,
    slot,
    active: true,
    attemptCount: Number.isFinite(Number(p.attemptCount)) ? Number(p.attemptCount) : 0,
    lastFailureReason: p.lastFailureReason || null,
    lastUserAnswerNormalized: p.lastUserAnswerNormalized || null,
    escalated: Boolean(p.escalated),
    escalationStep: p.escalationStep || null
  };
}

function buildPendingQuestionState(previousPending, nextPending) {
  const prev = previousPending && typeof previousPending === "object" ? previousPending : null;
  const next = nextPending && typeof nextPending === "object" ? nextPending : {};
  const normalized = ensurePendingPolicyState(next, next.slot || next.missingSlot);
  const prevSlot = String(prev?.slot || "").toLowerCase().trim();
  const nextSlot = String(normalized.slot || "").toLowerCase().trim();
  const trackedSlots = new Set(["context", "object", "surface"]);
  if (!trackedSlots.has(nextSlot)) {
    return { ...next };
  }
  if (!prev || !prevSlot || !nextSlot || prevSlot !== nextSlot) {
    return {
      ...normalized,
      attemptCount: 0,
      lastFailureReason: null,
      lastUserAnswerNormalized: null,
      escalated: false,
      escalationStep: null
    };
  }
  const prevTracked = ensurePendingPolicyState(prev, prev.slot || prev.missingSlot);
  return {
    ...normalized,
    attemptCount: prevTracked.attemptCount,
    lastFailureReason: prevTracked.lastFailureReason,
    lastUserAnswerNormalized: prevTracked.lastUserAnswerNormalized,
    escalated: prevTracked.escalated,
    escalationStep: prevTracked.escalationStep
  };
}

function classifyFailure({ userMessage, isNewRootRequest, pendingQuestion }) {
  const normalized = normalizeText(userMessage);
  if (!normalized) return "no_slot";
  if (isNewRootRequest) return "off_topic";
  if (pendingQuestion.lastUserAnswerNormalized && pendingQuestion.lastUserAnswerNormalized === normalized) {
    return "repeat";
  }
  return "no_slot";
}

function chipsForSlot({ slotTarget, contextHint, narrow }) {
  if (slotTarget === "context") {
    return {
      chipSetId: "context_v1",
      chips: [
        { label: "Interior", value: "interior" },
        { label: "Exterior", value: "exterior" },
        { label: "Nu sunt sigur", value: UNKNOWN_VALUE }
      ]
    };
  }

  if (slotTarget === "surface" && !narrow) {
    return {
      chipSetId: "surface_v1",
      chips: [
        { label: "Textil", value: "textile" },
        { label: "Piele", value: "leather" },
        { label: "Plastic / Vinil", value: "plastic" },
        { label: "Alcantara", value: "alcantara" },
        { label: "Sticla / Geam", value: "glass" },
        { label: "Vopsea / Lac", value: "paint" },
        { label: "Cauciuc", value: "rubber" },
        { label: "Nu sunt sigur", value: UNKNOWN_VALUE }
      ]
    };
  }

  if (slotTarget === "surface" && narrow) {
    return {
      chipSetId: "surface_narrow_v1",
      chips: [
        { label: "Textil (scaun / mocheta)", value: "textile" },
        { label: "Piele", value: "leather" },
        { label: "Plastic (bord / consola)", value: "plastic" },
        { label: "Sticla (geam / parbriz)", value: "glass" },
        { label: "Tot nu stiu", value: STILL_UNKNOWN_VALUE }
      ]
    };
  }

  if (slotTarget === "object") {
    if (contextHint === "exterior") {
      return {
        chipSetId: "object_exterior_v1",
        chips: [
          { label: "Jante", value: "jante" },
          { label: "Anvelope", value: "anvelope" },
          { label: "Caroserie", value: "caroserie" },
          { label: "Geamuri", value: "geamuri" },
          { label: "Faruri", value: "faruri" },
          { label: "Oglinzi", value: "oglinzi" },
          { label: "Altceva", value: OTHER_VALUE }
        ]
      };
    }
    if (contextHint === "interior") {
      return {
        chipSetId: "object_interior_v1",
        chips: [
          { label: "Scaune", value: "scaune" },
          { label: "Bancheta", value: "bancheta" },
          { label: "Bord / Plastice", value: "bord_plastice" },
          { label: "Volan", value: "volan" },
          { label: "Mocheta", value: "mocheta" },
          { label: "Tapiterie usi", value: "tapiterie_usi" },
          { label: "Altceva", value: OTHER_VALUE }
        ]
      };
    }
    return chipsForSlot({ slotTarget: "context", contextHint, narrow: false });
  }

  return {
    chipSetId: "context_v1",
    chips: [
      { label: "Interior", value: "interior" },
      { label: "Exterior", value: "exterior" },
      { label: "Nu sunt sigur", value: UNKNOWN_VALUE }
    ]
  };
}

function mapChipSelectionToSlotValue(slotTarget, chipSelection) {
  const v = normalizeText(chipSelection);
  if (!v) return null;
  if (v === normalizeText(UNKNOWN_VALUE) || v === normalizeText(STILL_UNKNOWN_VALUE) || v === normalizeText(OTHER_VALUE)) {
    return null;
  }
  if (slotTarget === "surface" && v === "leather") return "piele";
  if (slotTarget === "surface" && v === "rubber") return "wheels";
  if (slotTarget === "object" && v === "scaune") return "scaun";
  if (slotTarget === "object" && v === "bancheta") return "scaun";
  if (slotTarget === "object" && v === "bord_plastice") return "bord";
  if (slotTarget === "object" && v === "tapiterie_usi") return "tapiterie";
  if (slotTarget === "object" && v === "geamuri") return "glass";
  return v;
}

function evaluateClarificationEscalation({
  pendingQuestion,
  userMessage,
  isNewRootRequest,
  chipSelection,
  contextHint,
  slotFilled
}) {
  const pending = ensurePendingPolicyState(pendingQuestion, pendingQuestion?.slot);
  const slotTarget = pending.slot || "context";
  const normalizedAnswer = normalizeText(chipSelection || userMessage);

  const selectedUnknown = normalizeText(chipSelection) === normalizeText(UNKNOWN_VALUE);
  const selectedStillUnknown = normalizeText(chipSelection) === normalizeText(STILL_UNKNOWN_VALUE);
  const selectedOther = normalizeText(chipSelection) === normalizeText(OTHER_VALUE);
  const chipValue = mapChipSelectionToSlotValue(slotTarget, chipSelection);

  if (slotFilled || chipValue) {
    return {
      kind: "success",
      pendingQuestion: {
        ...pending,
        lastFailureReason: null,
        lastUserAnswerNormalized: normalizedAnswer,
        escalated: false,
        escalationStep: null
      },
      chipSelection: chipSelection || null,
      slotValue: chipValue
    };
  }

  if (selectedOther) {
    return {
      kind: "other_prompt",
      pendingQuestion: pending,
      reply: "Spune-mi ce vrei sa cureti, in 1-3 cuvinte.",
      telemetry: {
        clarificationAttemptCount: pending.attemptCount,
        clarificationEscalated: true,
        clarificationEscalationType: "chips",
        clarificationFailureReason: "no_slot",
        chipSetId: pending.escalationStep || "chips",
        chipSelection: OTHER_VALUE
      }
    };
  }

  if (selectedStillUnknown) {
    return {
      kind: "exit_unknown",
      pendingQuestion: {
        ...pending,
        active: false,
        escalated: true,
        escalationStep: "chips_narrow",
        lastFailureReason: "no_slot",
        lastUserAnswerNormalized: normalizedAnswer
      },
      reply:
        "E in regula. Ca sa continui corect, trimite o poza cu zona sau spune pe scurt materialul (textil, piele, plastic, sticla). Fara asta nu pot da pasi specifici in siguranta.",
      telemetry: {
        clarificationAttemptCount: pending.attemptCount,
        clarificationEscalated: true,
        clarificationEscalationType: "chips",
        clarificationFailureReason: "no_slot",
        chipSetId: "surface_narrow_v1",
        chipSelection: STILL_UNKNOWN_VALUE
      }
    };
  }

  if (selectedUnknown) {
    const narrow = chipsForSlot({ slotTarget, contextHint, narrow: true });
    return {
      kind: "chips_narrow",
      pendingQuestion: {
        ...pending,
        escalated: true,
        escalationStep: "chips_narrow",
        lastFailureReason: "no_slot",
        lastUserAnswerNormalized: normalizedAnswer
      },
      ui: { type: "chips", chipSetId: narrow.chipSetId, chips: narrow.chips, slotTarget },
      reply: "Nicio problema. Alege varianta cea mai apropiata:",
      telemetry: {
        clarificationAttemptCount: pending.attemptCount,
        clarificationEscalated: true,
        clarificationEscalationType: "chips",
        clarificationFailureReason: "no_slot",
        chipSetId: narrow.chipSetId,
        chipSelection: UNKNOWN_VALUE
      }
    };
  }

  const reason = classifyFailure({ userMessage, isNewRootRequest, pendingQuestion: pending });
  const nextPending = {
    ...pending,
    attemptCount: pending.attemptCount + 1,
    lastFailureReason: reason,
    lastUserAnswerNormalized: normalizedAnswer
  };

  if (nextPending.attemptCount >= MAX_FAILED_ATTEMPTS) {
    const chipSet = chipsForSlot({ slotTarget, contextHint, narrow: false });
    return {
      kind: "chips",
      pendingQuestion: {
        ...nextPending,
        escalated: true,
        escalationStep: "chips"
      },
      ui: { type: "chips", chipSetId: chipSet.chipSetId, chips: chipSet.chips, slotTarget },
      reply: "Ca sa mergem mai repede, alege una dintre variante:",
      telemetry: {
        clarificationAttemptCount: nextPending.attemptCount,
        clarificationEscalated: true,
        clarificationEscalationType: "chips",
        clarificationFailureReason: reason,
        chipSetId: chipSet.chipSetId,
        chipSelection: chipSelection || null
      }
    };
  }

  return {
    kind: "normal",
    pendingQuestion: nextPending,
    telemetry: {
      clarificationAttemptCount: nextPending.attemptCount,
      clarificationEscalated: false,
      clarificationEscalationType: null,
      clarificationFailureReason: reason,
      chipSetId: null,
      chipSelection: chipSelection || null
    }
  };
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  UNKNOWN_VALUE,
  STILL_UNKNOWN_VALUE,
  OTHER_VALUE,
  ensurePendingPolicyState,
  buildPendingQuestionState,
  evaluateClarificationEscalation
};

