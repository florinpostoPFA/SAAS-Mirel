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

/** Map ticket v0 rule surface labels → canonical slot surface values. */
const RULE_SURFACE_TO_CANONICAL = Object.freeze({
  upholstery: "textile",
  carpet: "textile",
  leather: "piele",
  headlights: "glass",
  engine_bay: null,
  textile: "textile",
  piele: "piele",
  plastic: "plastic",
  alcantara: "alcantara",
  paint: "paint",
  wheels: "wheels",
  tires: "tires",
  glass: "glass"
});

const SLOT_KEYS = Object.freeze(["context", "surface", "object", "action", "domain"]);

function normalizeMessageText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

function normalizeRuleSurface(surface) {
  if (surface == null || surface === "") return null;
  const key = String(surface).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(RULE_SURFACE_TO_CANONICAL, key)) {
    throw new Error(`slotInferenceFromMessage: unknown rule surface "${surface}"`);
  }
  return RULE_SURFACE_TO_CANONICAL[key];
}

function validateRulesAtLoad() {
  const surfaceSet = new Set(CANONICAL_SURFACE_VALUES);
  const actionSet = new Set(CANONICAL_ACTION_VALUES);

  for (const rule of SLOT_INFERENCE_RULES) {
    const sets = rule.sets || {};
    if (sets.surface != null) {
      const canonical = normalizeRuleSurface(sets.surface);
      if (canonical != null && !surfaceSet.has(canonical)) {
        throw new Error(
          `slotInferenceFromMessage: rule surface "${sets.surface}" maps to invalid canonical "${canonical}"`
        );
      }
    }
    if (sets.action != null && !actionSet.has(sets.action)) {
      throw new Error(`slotInferenceFromMessage: invalid action "${sets.action}" in rule token ${rule.token}`);
    }
    if (sets.context != null && !CANONICAL_CONTEXT_VALUES.includes(sets.context)) {
      throw new Error(`slotInferenceFromMessage: invalid context "${sets.context}" in rule token ${rule.token}`);
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

function canonicalizeRuleSets(sets) {
  const out = {};
  if (!sets || typeof sets !== "object") return out;
  if (sets.context != null) out.context = sets.context;
  if (sets.action != null) out.action = sets.action;
  if (sets.domain != null) out.domain = sets.domain;
  if (sets.surface != null) {
    const canonicalSurface = normalizeRuleSurface(sets.surface);
    if (canonicalSurface != null) {
      out.surface = canonicalSurface;
    }
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

  for (const rule of rules) {
    if (!ruleMatches(rule, normalized)) continue;

    const tokenLabel = rule.token instanceof RegExp ? String(rule.token) : String(rule.token);
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
      if (slotKey === "domain" || slotKey === "object") continue;
      const value = canonicalSets[slotKey];
      if (value == null) continue;

      const applyCheck = canApplySlotUpdate(slotKey, currentSlots, slotMeta);
      if (!applyCheck.ok) {
        if (applyCheck.reason && !skippedReasons.includes(applyCheck.reason)) {
          skippedReasons.push(applyCheck.reason);
        }
        continue;
      }

      slotUpdates[slotKey] = value;
      matches.push({ token: tokenLabel, slotKey, slotValue: value });
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

  return {
    slotUpdates,
    matches,
    skippedReasons: [...new Set(skippedReasons)],
    tokenInferenceApplied: matches.length > 0
  };
}

module.exports = {
  inferSlotsFromMessage,
  normalizeMessageText,
  CANONICAL_SURFACE_VALUES,
  CANONICAL_ACTION_VALUES,
  RULE_SURFACE_TO_CANONICAL
};
