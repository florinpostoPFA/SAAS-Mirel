const config = require("../config");
const { logInfo } = require("./logger");

function normalizeValue(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map(normalizeValue)
    .filter(Boolean);
}

function matchesTrigger(triggerValues, value) {
  const normalizedTriggers = normalizeList(triggerValues);

  if (normalizedTriggers.length === 0) {
    return true;
  }

  return normalizedTriggers.includes(normalizeValue(value));
}

function matchesProvidedTrigger(triggerValues, value) {
  const normalizedValue = normalizeValue(value);

  if (!normalizedValue) {
    return true;
  }

  return matchesTrigger(triggerValues, normalizedValue);
}

function normalizeRequest(input, legacySlots = {}) {
  const request = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : { intent: input, slots: legacySlots };

  return {
    intent: request.intent,
    slots: request.slots && typeof request.slots === "object"
      ? request.slots
      : {}
  };
}

function requiresSlot(flow, slotName) {
  const requiredSlots = normalizeList(flow?.requiredSlots);

  if (requiredSlots.length === 0) {
    return null;
  }

  return requiredSlots.includes(normalizeValue(slotName));
}

function matchesSlotTrigger(flow, slotName, triggerValues, slotValue, allowPartial) {
  const slotIsRequired = requiresSlot(flow, slotName);

  if (slotIsRequired === null) {
    return allowPartial
      ? matchesProvidedTrigger(triggerValues, slotValue)
      : matchesTrigger(triggerValues, slotValue);
  }

  const normalizedValue = normalizeValue(slotValue);
  if (!normalizedValue) {
    return !slotIsRequired;
  }

  return allowPartial
    ? matchesProvidedTrigger(triggerValues, normalizedValue)
    : matchesTrigger(triggerValues, normalizedValue);
}

function shouldIgnoreSurfaceTrigger(flow, request, matchesContext) {
  const normalizedSurface = normalizeValue(request?.slots?.surface);
  const declaredSurfaceTriggers = normalizeList(flow?.triggers?.surfaces);

  if (!normalizedSurface) {
    return false;
  }

  if (!matchesContext) {
    return false;
  }

  if (declaredSurfaceTriggers.length > 0) {
    return false;
  }

  logInfo("FLOW_SURFACE_IGNORED", { flowId: flow?.flowId || "unknown" });
  return true;
}

function shouldIgnoreMissingSurface(flow, request, allowPartial, matchesContext) {
  if (allowPartial) {
    return false;
  }

  if (normalizeValue(request?.slots?.surface)) {
    return false;
  }

  if (!matchesContext) {
    return false;
  }

  return requiresSlot(flow, "surface") !== true;
}

function findMatchingFlows(request, allowPartial = false) {
  const flowEntries = Object.entries(config.flows || {});
  const matches = [];
  for (const [, flow] of flowEntries) {
    const triggers = flow?.triggers || {};
    const matchesIntent = matchesTrigger(triggers.intents, request.intent);
    const matchesSurface = matchesSlotTrigger(
      flow,
      "surface",
      triggers.surfaces,
      request.slots.surface,
      allowPartial
    );
    const matchesContext = matchesSlotTrigger(
      flow,
      "context",
      triggers.contexts,
      request.slots.context,
      allowPartial
    );

    if (matchesIntent && shouldIgnoreSurfaceTrigger(flow, request, matchesContext)) {
      matches.push(flow);
      continue;
    }

    if (matchesIntent && shouldIgnoreMissingSurface(flow, request, allowPartial, matchesContext)) {
      logInfo("FLOW_MATCH_OVERRIDE", { reason: "surface_not_required" });
      matches.push(flow);
      continue;
    }

    if (matchesIntent && matchesSurface && matchesContext) {
      matches.push(flow);
    }
  }

  return matches;
}

function resolveFlow(input, legacySlots = {}) {
  const request = normalizeRequest(input, legacySlots);

  if (request.intent !== "product_guidance") {
    return null;
  }

  return findMatchingFlows(request, false)[0] || null;
}

function resolveFlowCandidate(input, legacySlots = {}) {
  const request = normalizeRequest(input, legacySlots);

  if (request.intent !== "product_guidance") {
    return null;
  }

  return findMatchingFlows(request, true)[0] || null;
}

function resolveFlowCandidates(input, legacySlots = {}) {
  const request = normalizeRequest(input, legacySlots);

  if (request.intent !== "product_guidance") {
    return [];
  }

  return findMatchingFlows(request, true);
}

module.exports = { resolveFlow, resolveFlowCandidate, resolveFlowCandidates };