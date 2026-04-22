function getMissingSlot(slots) {
  if (!slots || !slots.context) return "context";
  if (!slots.object) return "object";
  if (!slots.surface) return "surface";
  return null;
}

function areSlotsComplete(slots) {
  return getMissingSlot(slots) === null;
}

function routeRequest({ queryType, slots, message }) {
  if (queryType === "safety") {
    return {
      action: "safety",
      reason: "safety_query"
    };
  }

  if (queryType === "selection") {
    const missing = getMissingSlot(slots);

    if (missing) {
      return {
        action: "clarification",
        reason: "missing_" + missing,
        missingSlot: missing
      };
    }

    return {
      action: "selection",
      reason: "slots_complete"
    };
  }

  if (queryType === "procedural") {
    return {
      action: "procedural",
      reason: "procedural_query"
    };
  }

  if (queryType === "informational") {
    return {
      action: "knowledge",
      reason: "informational_query"
    };
  }

  return {
    action: "knowledge",
    reason: "default_fallback"
  };
}

module.exports = {
  routeRequest,
  getMissingSlot,
  areSlotsComplete
};
