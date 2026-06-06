"use strict";

/**
 * F40 — Parametric clarification copy (schema: data/clarification-examples.json).
 * Inputs: slots.action, slots.context, slots.surface, slots.object, intent.tags,
 * missingSlot, clarificationGateReason. Never key templates by missingSlot alone.
 */
const examples = require("../data/clarification-examples.json");

const FAMILY_TAGS = new Set([
  "wax", "polish", "coating", "apc", "degreaser", "iron_remover", "sealant"
]);

function normTag(t) {
  return String(t || "").toLowerCase().trim();
}

function resolveFamilyNoun(intentTags) {
  const tags = (Array.isArray(intentTags) ? intentTags : []).map(normTag);
  for (const t of tags) {
    if (FAMILY_TAGS.has(t)) return examples.familyNouns[t] || examples.familyNouns.default;
    if (examples.familyTagAliases[t]) {
      const alias = examples.familyTagAliases[t];
      if (FAMILY_TAGS.has(alias)) return examples.familyNouns[alias];
    }
  }
  return examples.familyNouns.default;
}

function resolveFamilyKey(intentTags) {
  const tags = (Array.isArray(intentTags) ? intentTags : []).map(normTag);
  for (const t of tags) {
    if (FAMILY_TAGS.has(t)) return t;
    if (examples.familyTagAliases[t] && FAMILY_TAGS.has(examples.familyTagAliases[t])) {
      return examples.familyTagAliases[t];
    }
  }
  return null;
}

function pickVerb(action, familyKey) {
  const act = normTag(action) || "default";
  const byFamily = familyKey && examples.verbsByFamily[familyKey];
  if (byFamily && byFamily[act]) return byFamily[act];
  const pool = examples.verbs[act] || examples.verbs.default;
  return Array.isArray(pool) ? pool[0] : pool;
}

function exampleList(context, max = 3) {
  const ctx = normTag(context);
  const pool = examples.examples[ctx] || [];
  return pool.slice(0, max).join(", ");
}

function composeObjectQuestion(slots, intentTags) {
  const action = slots?.action;
  const context = slots?.context;
  const familyKey = resolveFamilyKey(intentTags);
  const noun = resolveFamilyNoun(intentTags);
  const verb = pickVerb(action, familyKey);
  const scope = context === "exterior"
    ? "Pe ce parte a exteriorului"
    : context === "interior"
      ? "Pe ce parte a interiorului"
      : "Pe ce parte";
  const ex = context ? exampleList(context) : "";
  const msg = ex
    ? `${scope} vrei sa ${verb} ${noun}? (ex: ${ex})`
    : `${scope} vrei sa ${verb} ${noun}?`;
  return { message: msg, templateKey: `object:${action || "null"}:${familyKey || "generic"}:${context || "null"}` };
}

function composeSurfaceQuestion(slots, intentTags) {
  const action = normTag(slots?.action);
  const context = normTag(slots?.context);
  const verb = pickVerb(action, resolveFamilyKey(intentTags));
  const ex = context ? exampleList(context) : "";
  if (action === "clean" && context === "interior") {
    return {
      message: `E suprafata de piele sau textil pe care vrei sa ${verb}? (ex: scaune piele, scaune textile, plafon textile)`,
      templateKey: `surface:clean:${resolveFamilyKey(intentTags) || "generic"}:interior`
    };
  }
  const body = context === "exterior"
    ? `Pe ce suprafata lucrezi? (ex: ${ex || "vopsea, jante, geamuri"})`
    : "Pe ce suprafata lucrezi?";
  return {
    message: action ? `${body.replace(/\?$/, "")} — vrei sa ${verb}?` : body,
    templateKey: `surface:${action || "null"}:${context || "null"}`
  };
}

function composeIntentLevelQuestion(slots, intentTags) {
  const action = normTag(slots?.action);
  const tags = (Array.isArray(intentTags) ? intentTags : []).map(normTag);
  const leather = tags.includes("leather") || normTag(slots?.surface) === "piele";
  if (action === "protect" && leather) {
    return { message: examples.intentLevel.protectLeather, templateKey: "intent_level:protect:leather" };
  }
  if (leather) {
    return { message: examples.intentLevel.cleanLeather, templateKey: "intent_level:generic:leather" };
  }
  return { message: examples.intentLevel.generic, templateKey: "intent_level:generic" };
}

function composeNarrowingQuestion(slots) {
  const surface = normTag(slots?.surface);
  const action = normTag(slots?.action) || "clean";
  const pool = examples.narrowing[surface] || examples.narrowing.default;
  const message = pool[action] || pool.clean || pool.protect || examples.narrowing.default.clean;
  return { message, templateKey: `narrowing:${action}:${surface || "generic"}:zero_results` };
}

function composeClarificationQuestion({
  missingSlot,
  slots = {},
  intentTags = [],
  clarificationGateReason = null,
  responseLocale = "ro"
}) {
  void responseLocale;
  const slot = normTag(missingSlot);
  const gate = normTag(clarificationGateReason);

  if ((gate === "zero_results" || gate === "both") && slot !== "context") {
    return composeNarrowingQuestion(slots);
  }
  if (slot === "context") {
    return { message: examples.contextQuestion, templateKey: "context:generic" };
  }
  if (slot === "object") return composeObjectQuestion(slots, intentTags);
  if (slot === "surface") return composeSurfaceQuestion(slots, intentTags);
  if (slot === "intent_level" || slot === "action_level") {
    return composeIntentLevelQuestion(slots, intentTags);
  }
  return composeObjectQuestion(slots, intentTags);
}

module.exports = { composeClarificationQuestion, resolveFamilyNoun, pickVerb, exampleList };
