/**
 * Mechanical token → slot inference (v0). Pure function, no I/O.
 * Consumes rules from slotInferenceRules.js (Run A).
 */

"use strict";

const { SLOT_INFERENCE_RULES, SLOT_INFERENCE_RULE_FAMILY_ORDER } = require("./slotInferenceRules");
const { CTO_SURFACE_ENUM } = require("./slotCompleteness");

const CANONICAL_SURFACE_VALUES = Object.freeze([
  ...CTO_SURFACE_ENUM,
  "paint",
  "wheels",
  "tires",
  "glass"
]);

const CANONICAL_ACTION_VALUES = Object.freeze([
  "clean",
  "maintain",
  "decontaminate",
  "polish",
  "protect",
  "restore",
  "dress"
]);

const CANONICAL_CONTEXT_VALUES = Object.freeze(["interior", "exterior"]);

const CANONICAL_OBJECT_VALUES = Object.freeze([
  "glass",
  "geam",
  "parbriz",
  "oglinzi",
  "oglinda",
  "scaun",
  "cotiera",
  "bord",
  "mocheta",
  "jante",
  "anvelope",
  "caroserie",
  "volan",
  "tapiterie",
  "plafon",
  "faruri"
]);

const SLOT_KEYS = Object.freeze(["context", "surface", "object", "action", "domain"]);

const TEXTILE_SURFACE_MARKER = /\b(textil\w*|tapiterie|tapiteria|stofa|stofe)\b/i;
const OBJECT_SURFACE_GUARD_TOKENS = new Set([
  "scaun",
  "scaune",
  "bancheta",
  "banchete",
  "cotiera",
  "cotiere"
]);
const WORKFLOW_ACTION_ORDER = Object.freeze([
  "decontaminate",
  "clean",
  "polish",
  "restore",
  "maintain",
  "protect",
  "dress"
]);
const CLEANLINESS_INTENSITY_DEEP =
  /\b(noroi|mizerie\s+grea|murdar\w*\s+grea|pata\s+adanca|pete\s+grele)\b/i;
const CLEANLINESS_INTENSITY_NORMAL = /\b(murdar\w*|mizerie|pata|pete|praf)\b/i;

const INTENT_TAG_ACTION_MAP = Object.freeze([
  { tag: "cleaning", action: "clean" },
  { tag: "polish", action: "polish" },
  { tag: "protection", action: "protect" }
]);

function normalizeMessageText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

function validateRulesAtLoad() {
  const surfaceSet = new Set(CANONICAL_SURFACE_VALUES);
  const actionSet = new Set(CANONICAL_ACTION_VALUES);

  for (const rule of SLOT_INFERENCE_RULES) {
    const sets = rule.sets || {};
    if (sets.surface != null) {
      const surface = String(sets.surface).trim().toLowerCase();
      if (!surfaceSet.has(surface)) {
        throw new Error(
          `slotInferenceFromMessage: rule surface "${sets.surface}" is outside closed enum (token ${rule.token})`
        );
      }
    }
    if (sets.action != null && !actionSet.has(sets.action)) {
      throw new Error(`slotInferenceFromMessage: invalid action "${sets.action}" in rule token ${rule.token}`);
    }
    if (sets.context != null && !CANONICAL_CONTEXT_VALUES.includes(sets.context)) {
      throw new Error(`slotInferenceFromMessage: invalid context "${sets.context}" in rule token ${rule.token}`);
    }
    if (sets.object != null) {
      const obj = String(sets.object).trim().toLowerCase();
      if (!CANONICAL_OBJECT_VALUES.includes(obj)) {
        throw new Error(`slotInferenceFromMessage: invalid object "${sets.object}" in rule token ${rule.token}`);
      }
    }
  }
}

validateRulesAtLoad();

function familyRank(family) {
  const idx = SLOT_INFERENCE_RULE_FAMILY_ORDER.indexOf(family);
  return idx === -1 ? 999 : idx;
}

function sortedRules() {
  return [...SLOT_INFERENCE_RULES].sort((a, b) => {
    const pr = a.priority - b.priority;
    if (pr !== 0) return pr;
    return familyRank(a.family) - familyRank(b.family);
  });
}

function ruleMatches(rule, normalizedMessage) {
  const tok = rule.token;
  if (tok instanceof RegExp) {
    return tok.test(normalizedMessage);
  }
  const needle = normalizeMessageText(tok);
  if (!needle) return false;
  return normalizedMessage.includes(needle);
}

function isSlotFresh(slotKey, currentSlots, slotMeta) {
  const meta = slotMeta && typeof slotMeta === "object" ? slotMeta : {};
  const metaVal = meta[slotKey];
  if (metaVal === "confirmed") {
    const cur = currentSlots && currentSlots[slotKey];
    if (cur != null && String(cur).trim() !== "") {
      return true;
    }
  }
  return false;
}

function canApplySlotUpdate(slotKey, currentSlots, slotMeta) {
  if (isSlotFresh(slotKey, currentSlots, slotMeta)) {
    return { ok: false, reason: "slot_already_fresh" };
  }
  const cur = currentSlots && currentSlots[slotKey];
  const empty = cur == null || String(cur).trim() === "";
  const meta = slotMeta && typeof slotMeta === "object" ? slotMeta : {};
  if (empty) return { ok: true };
  if (meta[slotKey] === "stale") return { ok: true };
  return { ok: false, reason: "stale_slot_present" };
}

const EXPECTED_GUARD_REASONS = new Set([
  "stale_slot_present",
  "slot_already_fresh",
  "blocked_guard_surface_object",
  "blocked_guard_all",
  "session_slots_established"
]);

function bucketSkipReasons(skippedReasons) {
  const reasons = Array.isArray(skippedReasons) ? [...new Set(skippedReasons)] : [];
  const tokenInferenceSkipExpectedGuards = reasons.filter((r) => EXPECTED_GUARD_REASONS.has(r));
  const tokenInferenceSkipAnomalous = reasons.filter((r) => !EXPECTED_GUARD_REASONS.has(r));
  return {
    tokenInferenceSkipExpectedGuards,
    tokenInferenceSkipAnomalous,
    tokenInferenceSkipCounts: {
      expected_guard: tokenInferenceSkipExpectedGuards.length,
      anomalous_skip: tokenInferenceSkipAnomalous.length
    }
  };
}

function normalizeRuleTokenLabel(tokenLabel) {
  return String(tokenLabel || "")
    .replace(/^\/\\b/, "")
    .replace(/\\b\/[a-z]*$/i, "")
    .trim();
}

function shouldSkipGuardedTextileSurface(tokenLabel, surfaceValue, normalizedMessage) {
  if (surfaceValue !== "textile") return false;
  const token = normalizeRuleTokenLabel(tokenLabel);
  if (!OBJECT_SURFACE_GUARD_TOKENS.has(token)) return false;
  return !TEXTILE_SURFACE_MARKER.test(normalizedMessage);
}

function pickWorkflowAction(actionValues) {
  const set = new Set(actionValues);
  for (const action of WORKFLOW_ACTION_ORDER) {
    if (set.has(action)) return action;
  }
  return actionValues.length ? actionValues[actionValues.length - 1] : null;
}

function inferCleanlinessIntensity(normalizedMessage) {
  if (!CLEANLINESS_INTENSITY_NORMAL.test(normalizedMessage)) {
    return null;
  }
  return {
    action: "clean",
    intensity: CLEANLINESS_INTENSITY_DEEP.test(normalizedMessage) ? "deep" : "normal"
  };
}

function syncActionIntensityOnSlots(slots) {
  if (!slots || typeof slots !== "object") return;
  if (!slots.action) {
    delete slots.actionIntensity;
    return;
  }
  if (slots.action !== "clean") {
    delete slots.actionIntensity;
  }
}

function shouldSkipSessionSlotWrites(slotMeta) {
  const meta = slotMeta && typeof slotMeta === "object" ? slotMeta : {};
  const primaries = ["context", "surface", "object"];
  if (!primaries.every((k) => meta[k] === "confirmed")) {
    return false;
  }
  return meta.action !== "unknown";
}

function reconcileActionFromIntentTags(sessionContext, interactionRef) {
  const slots = sessionContext.slots || {};
  if (slots.action) {
    syncActionIntensityOnSlots(slots);
    return;
  }
  const tags = [
    ...(Array.isArray(interactionRef?.tags) ? interactionRef.tags : []),
    ...(Array.isArray(sessionContext?.tags) ? sessionContext.tags : [])
  ];
  for (const { tag, action } of INTENT_TAG_ACTION_MAP) {
    if (tags.includes(tag)) {
      slots.action = action;
      sessionContext.slots = slots;
      syncActionIntensityOnSlots(slots);
      return;
    }
  }
  syncActionIntensityOnSlots(slots);
}

function canonicalizeRuleSets(sets) {
  const out = {};
  if (!sets || typeof sets !== "object") return out;
  if (sets.context != null) out.context = sets.context;
  if (sets.action != null) out.action = sets.action;
  if (sets.domain != null) out.domain = sets.domain;
  if (sets.surface != null) {
    out.surface = String(sets.surface).trim().toLowerCase();
  }
  if (sets.object != null) {
    out.object = String(sets.object).trim().toLowerCase();
  }
  return out;
}

/**
 * @param {object} params
 * @param {string} params.message
 * @param {object} [params.currentSlots]
 * @param {object} [params.slotMeta] — per-slot meta: confirmed | stale | unknown
 * @param {string} [params.locale]
 * @returns {{
 *   slotUpdates: { context?: string, surface?: string, action?: string, domain?: string },
 *   matches: Array<{ token: string, slotKey: string, slotValue: string }>,
 *   skippedReasons: string[],
 *   tokenInferenceApplied: boolean
 * }}
 */
function inferSlotsFromMessage({ message, currentSlots = {}, slotMeta = {}, locale = "ro" }) {
  void locale;
  const normalized = normalizeMessageText(message);
  const matches = [];
  const skippedReasons = [];
  const slotUpdates = {};

  if (!normalized) {
    return {
      slotUpdates: {},
      matches: [],
      skippedReasons: ["no_token_match"],
      tokenInferenceApplied: false
    };
  }

  const rules = sortedRules();
  let oodMatched = false;
  const actionCandidates = [];

  for (const rule of rules) {
    if (!ruleMatches(rule, normalized)) continue;

    const tokenLabel =
      typeof rule.tokenText === "string" && rule.tokenText
        ? rule.tokenText
        : rule.token instanceof RegExp
          ? String(rule.token)
          : String(rule.token);
    const canonicalSets = canonicalizeRuleSets(rule.sets);

    if (rule.family === "ood") {
      oodMatched = true;
      if (canonicalSets.domain) {
        slotUpdates.domain = canonicalSets.domain;
        matches.push({
          token: tokenLabel,
          slotKey: "domain",
          slotValue: canonicalSets.domain
        });
      }
      continue;
    }

    if (oodMatched) {
      continue;
    }

    for (const slotKey of SLOT_KEYS) {
      if (slotKey === "domain") continue;
      const value = canonicalSets[slotKey];
      if (value == null) continue;

      if (
        slotKey === "surface" &&
        shouldSkipGuardedTextileSurface(tokenLabel, value, normalized)
      ) {
        continue;
      }

      const applyCheck = canApplySlotUpdate(slotKey, currentSlots, slotMeta);
      if (!applyCheck.ok) {
        if (applyCheck.reason && !skippedReasons.includes(applyCheck.reason)) {
          skippedReasons.push(applyCheck.reason);
        }
        continue;
      }

      if (slotKey === "action") {
        actionCandidates.push(value);
        matches.push({ token: tokenLabel, slotKey, slotValue: value });
        continue;
      }

      slotUpdates[slotKey] = value;
      matches.push({ token: tokenLabel, slotKey, slotValue: value });
    }
  }

  if (actionCandidates.length > 0) {
    slotUpdates.action = pickWorkflowAction(actionCandidates);
  }

  const cleanliness = inferCleanlinessIntensity(normalized);
  if (cleanliness) {
    if (!slotUpdates.action) {
      slotUpdates.action = cleanliness.action;
    }
    if (slotUpdates.action === "clean") {
      slotUpdates.actionIntensity = cleanliness.intensity;
    }
  }

  if (oodMatched) {
    skippedReasons.push("domain_out_of_scope");
    return {
      slotUpdates,
      matches,
      skippedReasons: [...new Set(skippedReasons)],
      tokenInferenceApplied: true
    };
  }

  if (matches.length === 0 && skippedReasons.length === 0) {
    skippedReasons.push("no_token_match");
  }

  const result = {
    slotUpdates,
    matches,
    skippedReasons: [...new Set(skippedReasons)],
    tokenInferenceApplied: matches.length > 0,
    actionIntensity: slotUpdates.actionIntensity ?? null
  };
  if (result.slotUpdates.actionIntensity != null) {
    delete result.slotUpdates.actionIntensity;
  }
  return result;
}

/**
 * Apply token inference into live session slots (Run C integration helper).
 * @param {object} params
 * @param {string} params.message
 * @param {object} params.sessionContext
 * @param {object} [params.interactionRef]
 * @returns {ReturnType<inferSlotsFromMessage>}
 */
function applyTokenInferenceToSessionSlots({
  message,
  sessionContext,
  interactionRef = null,
  options = {}
}) {
  if (!sessionContext || typeof sessionContext !== "object") {
    return inferSlotsFromMessage({ message, currentSlots: {}, slotMeta: {} });
  }

  sessionContext.slots = sessionContext.slots && typeof sessionContext.slots === "object"
    ? sessionContext.slots
    : {};
  sessionContext.slotMeta =
    sessionContext.slotMeta && typeof sessionContext.slotMeta === "object"
      ? sessionContext.slotMeta
      : { context: "unknown", surface: "unknown", object: "unknown" };

  const result = inferSlotsFromMessage({
    message,
    currentSlots: sessionContext.slots,
    slotMeta: sessionContext.slotMeta
  });
  const blockAll = options && options.blockAll === true;
  const blockSurfaceObject = options && options.blockSurfaceObject === true;

  if (shouldSkipSessionSlotWrites(sessionContext.slotMeta)) {
    result.tokenInferenceApplied = false;
    const establishedSkipReason =
      result.matches.length === 0 ? "no_token_match" : "session_slots_established";
    result.skippedReasons = [...new Set([...result.skippedReasons, establishedSkipReason])];
    const skipBuckets = bucketSkipReasons(result.skippedReasons);
    result.tokenInferenceSkipExpectedGuards = skipBuckets.tokenInferenceSkipExpectedGuards;
    result.tokenInferenceSkipAnomalous = skipBuckets.tokenInferenceSkipAnomalous;
    result.tokenInferenceSkipCounts = skipBuckets.tokenInferenceSkipCounts;
    if (interactionRef && typeof interactionRef === "object") {
      const prior = interactionRef.tokenInferenceTelemetry;
      interactionRef.tokenInferenceTelemetry = {
        tokenInferenceApplied: Boolean(prior?.tokenInferenceApplied),
        tokenInferenceMatches: Array.isArray(prior?.tokenInferenceMatches)
          ? prior.tokenInferenceMatches
          : [],
        tokenInferenceSkippedReasons: [
          ...new Set([
            ...(Array.isArray(prior?.tokenInferenceSkippedReasons)
              ? prior.tokenInferenceSkippedReasons
              : []),
            establishedSkipReason
          ])
        ],
        tokenInferenceSkipExpectedGuards: result.tokenInferenceSkipExpectedGuards,
        tokenInferenceSkipAnomalous: result.tokenInferenceSkipAnomalous,
        tokenInferenceSkipCounts: result.tokenInferenceSkipCounts,
        tokenInferenceActionMatch: prior?.tokenInferenceActionMatch ?? null
      };
    }
    return result;
  }

  let actionMatches = result.matches.filter((m) => m.slotKey === "action");
  if (result.slotUpdates.action) {
    actionMatches = actionMatches.filter((m) => m.slotValue === result.slotUpdates.action);
    if (actionMatches.length === 0) {
      actionMatches = [{ token: "workflow", slotKey: "action", slotValue: result.slotUpdates.action }];
    }
  }

  if (interactionRef && typeof interactionRef === "object") {
    const skipBuckets = bucketSkipReasons(result.skippedReasons);
    result.tokenInferenceSkipExpectedGuards = skipBuckets.tokenInferenceSkipExpectedGuards;
    result.tokenInferenceSkipAnomalous = skipBuckets.tokenInferenceSkipAnomalous;
    result.tokenInferenceSkipCounts = skipBuckets.tokenInferenceSkipCounts;
    const prior = interactionRef.tokenInferenceTelemetry;
    const mergedMatches = [
      ...(Array.isArray(prior?.tokenInferenceMatches) ? prior.tokenInferenceMatches : []),
      ...result.matches
    ];
    interactionRef.tokenInferenceTelemetry = {
      tokenInferenceApplied:
        result.tokenInferenceApplied || Boolean(prior?.tokenInferenceApplied),
      tokenInferenceMatches: mergedMatches,
      tokenInferenceSkippedReasons: [
        ...new Set([
          ...(Array.isArray(prior?.tokenInferenceSkippedReasons)
            ? prior.tokenInferenceSkippedReasons
            : []),
          ...result.skippedReasons
        ])
      ],
      tokenInferenceSkipExpectedGuards: [
        ...new Set([
          ...(Array.isArray(prior?.tokenInferenceSkipExpectedGuards)
            ? prior.tokenInferenceSkipExpectedGuards
            : []),
          ...(Array.isArray(result.tokenInferenceSkipExpectedGuards)
            ? result.tokenInferenceSkipExpectedGuards
            : [])
        ])
      ],
      tokenInferenceSkipAnomalous: [
        ...new Set([
          ...(Array.isArray(prior?.tokenInferenceSkipAnomalous)
            ? prior.tokenInferenceSkipAnomalous
            : []),
          ...(Array.isArray(result.tokenInferenceSkipAnomalous)
            ? result.tokenInferenceSkipAnomalous
            : [])
        ])
      ],
      tokenInferenceSkipCounts: {
        expected_guard:
          Number(prior?.tokenInferenceSkipCounts?.expected_guard || 0) +
          Number(result?.tokenInferenceSkipCounts?.expected_guard || 0),
        anomalous_skip:
          Number(prior?.tokenInferenceSkipCounts?.anomalous_skip || 0) +
          Number(result?.tokenInferenceSkipCounts?.anomalous_skip || 0)
      },
      tokenInferenceActionMatch:
        actionMatches.length > 0
          ? actionMatches
          : prior?.tokenInferenceActionMatch ?? null
    };
  }

  if (result.slotUpdates.domain === "out_of_domain") {
    sessionContext.tokenInferenceDomain = "out_of_domain";
    return result;
  }

  if (blockAll) {
    result.skippedReasons = [...new Set([...(result.skippedReasons || []), "blocked_guard_all"])];
    const skipBuckets = bucketSkipReasons(result.skippedReasons);
    result.tokenInferenceSkipExpectedGuards = skipBuckets.tokenInferenceSkipExpectedGuards;
    result.tokenInferenceSkipAnomalous = skipBuckets.tokenInferenceSkipAnomalous;
    result.tokenInferenceSkipCounts = skipBuckets.tokenInferenceSkipCounts;
    return result;
  }

  const actionIntensity = result.actionIntensity ?? null;
  const slotsBeforeApply = JSON.stringify(sessionContext.slots);

  for (const [slotKey, value] of Object.entries(result.slotUpdates)) {
    if (slotKey === "domain" || value == null) continue;
    if (blockSurfaceObject && (slotKey === "surface" || slotKey === "object")) {
      if (!result.skippedReasons.includes("blocked_guard_surface_object")) {
        result.skippedReasons.push("blocked_guard_surface_object");
      }
      continue;
    }
    const cur = sessionContext.slots[slotKey];
    const empty = cur == null || String(cur).trim() === "";
    const meta = sessionContext.slotMeta[slotKey];
    if (!empty && meta !== "stale") continue;
    sessionContext.slots[slotKey] = value;
    if (meta !== "confirmed") {
      sessionContext.slotMeta[slotKey] = "inferred";
    }
  }

  if (actionIntensity != null && sessionContext.slots.action === "clean") {
    sessionContext.slots.actionIntensity = actionIntensity;
  }
  syncActionIntensityOnSlots(sessionContext.slots);
  reconcileActionFromIntentTags(sessionContext, interactionRef);

  if (sessionContext.objective && typeof sessionContext.objective === "object") {
    sessionContext.objective.slots = {
      ...(sessionContext.objective.slots || {}),
      ...sessionContext.slots
    };
  }

  const skipBuckets = bucketSkipReasons(result.skippedReasons);
  result.tokenInferenceSkipExpectedGuards = skipBuckets.tokenInferenceSkipExpectedGuards;
  result.tokenInferenceSkipAnomalous = skipBuckets.tokenInferenceSkipAnomalous;
  result.tokenInferenceSkipCounts = skipBuckets.tokenInferenceSkipCounts;

  const slotsMutated = slotsBeforeApply !== JSON.stringify(sessionContext.slots);
  result.tokenInferenceApplied = slotsMutated;
  if (interactionRef && typeof interactionRef === "object" && interactionRef.tokenInferenceTelemetry) {
    interactionRef.tokenInferenceTelemetry.tokenInferenceApplied =
      slotsMutated || Boolean(interactionRef.tokenInferenceTelemetry.tokenInferenceApplied);
  }

  return result;
}

module.exports = {
  inferSlotsFromMessage,
  applyTokenInferenceToSessionSlots,
  normalizeMessageText,
  pickWorkflowAction,
  shouldSkipGuardedTextileSurface,
  CANONICAL_SURFACE_VALUES,
  CANONICAL_ACTION_VALUES
};
