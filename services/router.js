const CTO_SURFACE_SET = new Set(["textile", "piele", "plastic", "alcantara"]);

function canonicalizeObjectRouter(object) {
  const normalized = String(object || "").toLowerCase().trim();
  if (!normalized) return null;
  const glassAliases = ["sticla", "geam", "geamuri", "parbriz", "glass", "windshield"];
  if (glassAliases.includes(normalized)) return "glass";
  return normalized;
}

function getMissingSlot(slots) {
  if (!slots || !slots.context) return "context";
  if (!slots.object) return "object";

  const ctx = String(slots.context || "").toLowerCase();
  const obj = canonicalizeObjectRouter(slots.object);
  const surfRaw = slots.surface != null ? String(slots.surface).trim() : "";
  const hasCtoSurface = surfRaw !== "" && CTO_SURFACE_SET.has(surfRaw.toLowerCase());

  if (ctx === "interior") {
    if (obj === "glass" || obj === "jante" || obj === "anvelope" || obj === "caroserie") return null;
    if (obj === "mocheta" || obj === "bord") return null;
    if (!hasCtoSurface) return "surface";
    return null;
  }

  if (ctx === "exterior") {
    const glassObjects = new Set(["glass", "geam", "parbriz", "oglinzi", "oglinda"]);
    if (glassObjects.has(obj)) return null;
    if (obj === "caroserie" && !surfRaw) return "surface";
    if ((obj === "jante" || obj === "roti" || obj === "wheels" || obj === "anvelope") && !surfRaw) return "surface";
    return null;
  }

  if (!surfRaw) return "surface";
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
