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
    message: request.message,
    slots: request.slots && typeof request.slots === "object"
      ? request.slots
      : {}
  };
}

const flowKeywords = {
  bug_removal_quick: ["insecte", "musculite", "bug", "insects"],
  wheel_tire_deep_clean: ["jante", "roti", "anvelope"],
  interior_clean_basic: ["scaun", "cotiera", "interior"]
};

const objectAliasGroups = {
  wheels: ["wheels", "jante", "roti", "anvelope"],
  jante: ["wheels", "jante", "roti", "anvelope"],
  roti: ["wheels", "jante", "roti", "anvelope"],
  anvelope: ["wheels", "jante", "roti", "anvelope"],
  parbriz: ["parbriz", "windshield"],
  windshield: ["parbriz", "windshield"]
};

function getObjectAliases(value) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return [];
  }

  return objectAliasGroups[normalized] || [normalized];
}

function matchesObjectTrigger(triggerValues, objectValue) {
  const normalizedTriggers = normalizeList(triggerValues);

  if (normalizedTriggers.length === 0) {
    return true;
  }

  const aliases = getObjectAliases(objectValue);
  return aliases.some(alias => normalizedTriggers.includes(alias));
}

function getFlowSpecificityScore(flow, slots, message) {
  const triggerObjects = normalizeList(flow?.triggers?.objects);
  const triggerSurfaces = normalizeList(flow?.triggers?.surfaces);
  const triggerContexts = normalizeList(flow?.triggers?.contexts);
  const slotObject = normalizeValue(slots?.object);
  const slotSurface = normalizeValue(slots?.surface);
  const slotContext = normalizeValue(slots?.context);
  const msg = typeof message === "string" ? message.toLowerCase() : "";

  let score = 0;

  const keywords = flowKeywords[flow?.flowId] || [];
  const matchedKeyword = keywords.find(kw => msg.includes(kw));
  if (matchedKeyword) {
    console.log("KEYWORD_MATCH", {
      flowId: flow?.flowId,
      matched: matchedKeyword,
      message: msg
    });
    score += 5;
  }

  if (triggerObjects.length > 0 && slotObject && matchesObjectTrigger(triggerObjects, slotObject)) {
    score += 10;
  }

  if (triggerSurfaces.length > 0 && slotSurface && triggerSurfaces.includes(slotSurface)) {
    score += 2;
  }

  if (triggerContexts.length > 0 && slotContext && triggerContexts.includes(slotContext)) {
    score += 1;
  }

  return score;
}

function getBestMatchingFlow(candidates, slots, message) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const matchedFlows = candidates.map(flow => {
    const rawScore = getFlowSpecificityScore(flow, slots, message);
    const score = Number.isFinite(rawScore) ? rawScore : 0;
    console.log("FLOW_SCORING", {
      flowId: flow?.flowId,
      score
    });

    return { flow, score };
  });

  matchedFlows.sort((a, b) => b.score - a.score);

  let flowCandidate = matchedFlows[0]?.flow || null;

  // Fallback: if scoring output is malformed but matches exist, pick first matched flow.
  if (!flowCandidate && candidates.length > 0) {
    flowCandidate = candidates[0];
  }

  if (!flowCandidate && matchedFlows.length > 0) {
    throw new Error("FLOW SELECTION FAILED: matches exist but no candidate");
  }

  console.log("FLOW_SELECTED_FINAL", flowCandidate?.flowId || null);

  return flowCandidate;
}

function resolveSpecializedFlowOverride() {
  return null;
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
  const normalizedValue = normalizeValue(slotValue);

  // If no slot value provided, don't filter on this trigger dimension.
  // Scoring (keyword/object match) will differentiate between candidates.
  if (!normalizedValue) {
    if (slotIsRequired === null) return true;
    return !slotIsRequired;
  }

  if (slotIsRequired === null) {
    if (slotName === "object") {
      return matchesObjectTrigger(triggerValues, normalizedValue);
    }

    return matchesTrigger(triggerValues, normalizedValue);
  }

  return allowPartial
    ? matchesProvidedTrigger(triggerValues, normalizedValue)
    : matchesTrigger(triggerValues, normalizedValue);
}

function findMatchingFlows(request, allowPartial = false) {
  const flowEntries = Object.entries(config.flows || {});
  const matches = [];
  const slotObject = normalizeValue(request?.slots?.object);

  for (const [, flow] of flowEntries) {
    const triggers = flow?.triggers || {};
    const flowId = normalizeValue(flow?.flowId);

    if (slotObject === "parbriz" && flowId === "exterior_wash_beginner") {
      continue;
    }

    const matchesIntent = matchesTrigger(triggers.intents, request.intent);
    const surfaceTriggers = normalizeList(triggers.surfaces);
    const objectTriggers = normalizeList(triggers.objects);
    const matchesContext = matchesSlotTrigger(
      flow,
      "context",
      triggers.contexts,
      request.slots.context,
      allowPartial
    );
    const matchesSurface = matchesSlotTrigger(
      flow,
      "surface",
      triggers.surfaces,
      request.slots.surface,
      allowPartial
    );
    const matchesObject = matchesSlotTrigger(
      flow,
      "object",
      triggers.objects,
      request.slots.object,
      allowPartial
    );

    let matchesTarget = true;
    if (surfaceTriggers.length > 0 && objectTriggers.length > 0) {
      matchesTarget = matchesSurface || matchesObject;
    } else if (surfaceTriggers.length > 0) {
      matchesTarget = matchesSurface;
    } else if (objectTriggers.length > 0) {
      matchesTarget = matchesObject;
    }

    if (matchesIntent && matchesContext && matchesTarget) {
      console.log("FLOW_MATCH_REASON", {
        flowId: flow?.flowId,
        matched: true,
        slots: request.slots || {}
      });
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

  const forcedFlow = resolveSpecializedFlowOverride(request.message);

  if (forcedFlow) {
    return forcedFlow;
  }

  return getBestMatchingFlow(findMatchingFlows(request, false), request.slots, request.message);
}

function resolveFlowCandidate(input, legacySlots = {}) {
  const request = normalizeRequest(input, legacySlots);

  if (request.intent !== "product_guidance") {
    return null;
  }

  const forcedFlow = resolveSpecializedFlowOverride(request.message);

  if (forcedFlow) {
    return forcedFlow;
  }

  return getBestMatchingFlow(findMatchingFlows(request, true), request.slots, request.message);
}

function resolveFlowCandidates(input, legacySlots = {}) {
  const request = normalizeRequest(input, legacySlots);

  if (request.intent !== "product_guidance") {
    return [];
  }

  const forcedFlow = resolveSpecializedFlowOverride(request.message);

  if (forcedFlow) {
    return [forcedFlow];
  }

  const candidates = findMatchingFlows(request, true);

  return candidates
    .map(flow => ({
      flow,
      score: getFlowSpecificityScore(flow, request.slots, request.message)
    }))
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.flow);
}

module.exports = { resolveFlow, resolveFlowCandidate, resolveFlowCandidates };