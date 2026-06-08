/**
 * Observability-only interaction labels for JSONL (Epic 1.1 + Goal A F37).
 * Does not influence routing or decisions.
 */

const { inferHighLevelIntent } = require("./productIntentHeuristics");
const { extractActionCategoryTags } = require("./clarificationFirstPolicy");
const { passesActionCategoryGate } = require("./productSelectionService");

/**
 * @param {unknown[]} products
 * @param {string[]} actionTags
 * @returns {{ matchedProductCount: number, tagsMatched: string[], tagsUnmatched: string[], actionMatchType: "matched"|"partial"|"mismatched"|"intent_no_signal" }}
 */
function evaluateConversionAlignment(products, actionTags, slots = null) {
  const tags = extractActionCategoryTags(actionTags, slots);
  const plen = Array.isArray(products) ? products.length : 0;

  if (tags.length === 0) {
    return {
      matchedProductCount: 0,
      tagsMatched: [],
      tagsUnmatched: [],
      actionMatchType: "intent_no_signal"
    };
  }

  if (plen === 0) {
    return {
      matchedProductCount: 0,
      tagsMatched: [],
      tagsUnmatched: tags.slice(),
      actionMatchType: "mismatched"
    };
  }

  const tagsMatched = [];
  const tagsUnmatched = [];
  for (const tag of tags) {
    const anyMatch = products.some((p) => passesActionCategoryGate(p, [tag]));
    if (anyMatch) tagsMatched.push(tag);
    else tagsUnmatched.push(tag);
  }

  let matchedProductCount = 0;
  for (const p of products) {
    if (passesActionCategoryGate(p, tags)) matchedProductCount += 1;
  }

  let actionMatchType = "mismatched";
  if (tagsMatched.length === tags.length && tagsMatched.length > 0) {
    actionMatchType = "matched";
  } else if (tagsMatched.length > 0 && tagsUnmatched.length > 0) {
    actionMatchType = "partial";
  }

  return {
    matchedProductCount,
    tagsMatched,
    tagsUnmatched,
    actionMatchType
  };
}

/**
 * @param {object} opts
 * @param {object} [opts.decision]
 * @param {unknown[]} [opts.products]
 * @param {object|null} [opts.pendingQuestion]
 * @param {string|null} [opts.message]
 * @param {boolean} [opts.lowSignalDetected]
 * @param {boolean} [opts.clarificationEscalated]
 * @param {number} [opts.clarificationAttemptCount]
 * @param {string|null} [opts.queryType]
 * @param {string|null} [opts.finalOutputType]
 * @param {string|null} [opts.productsReason]
 * @param {boolean} [opts.prematureFallback]
 * @param {string[]|null} [opts.intentTags]
 * @param {object|null} [opts.slots]
 * @returns {{
 *   failureType: "wrong_flow"|"no_products"|"clarification_loop"|"low_signal"|null,
 *   frictionPoint: string|null,
 *   conversionIntent: boolean,
 *   conversionSuccess: boolean,
 *   conversionAligned: boolean,
 *   conversionAlignment: {
 *     actionMatchType: "matched"|"partial"|"mismatched"|"intent_no_signal",
 *     intentActionTags: string[],
 *     matchedProductCount: number,
 *     shownProductCount: number,
 *     tagsMatched: string[],
 *     tagsUnmatched: string[]
 *   }
 * }}
 */
function classifyInteraction(opts) {
  const {
    decision = {},
    products = [],
    pendingQuestion = null,
    message = null,
    lowSignalDetected = false,
    clarificationEscalated = false,
    clarificationAttemptCount = 0,
    queryType = null,
    finalOutputType = null,
    productsReason = null,
    prematureFallback = false,
    intentTags = null,
    slots = null
  } = opts && typeof opts === "object" ? opts : {};

  const action = decision && typeof decision === "object" ? decision.action ?? null : null;
  const plen = Array.isArray(products) ? products.length : 0;
  const msgCore = String(message || "").toLowerCase().trim();
  const hl = inferHighLevelIntent(msgCore);

  const conversionIntent =
    queryType === "selection" ||
    queryType === "procedural" ||
    hl === "product_search" ||
    hl === "product_guidance";

  /** @type {"wrong_flow"|"no_products"|"clarification_loop"|"low_signal"|null} */
  let failureType = null;
  /** @type {string|null} */
  let frictionPoint = null;

  const attempts = Number(clarificationAttemptCount) || 0;

  if (prematureFallback) {
    failureType = "no_products";
    frictionPoint = "premature_fallback";
  } else if (lowSignalDetected) {
    failureType = "low_signal";
    frictionPoint = "low_signal_detected";
  } else if (clarificationEscalated || (action === "clarification" && attempts >= 2)) {
    failureType = "clarification_loop";
    frictionPoint = clarificationEscalated ? "clarification_escalated" : "repeated_clarification";
  } else if (action === "flow" && finalOutputType != null && finalOutputType !== "" && finalOutputType !== "flow") {
    failureType = "wrong_flow";
    frictionPoint = "flow_output_type_mismatch";
  } else if (
    (["recommend", "selection"].includes(action) && plen === 0) ||
    (action === "flow" && plen === 0 && finalOutputType !== "flow") ||
    productsReason === "no_matching_products"
  ) {
    failureType = "no_products";
    frictionPoint = productsReason ? String(productsReason) : "zero_product_results";
  }

  let conversionSuccess = false;
  if (!failureType) {
    if (action === "clarification") {
      conversionSuccess = false;
    } else if (action === "recommend" || action === "selection") {
      conversionSuccess = plen > 0;
    } else if (action === "flow") {
      conversionSuccess = finalOutputType === "flow";
    } else if (action === "knowledge" || action === "safety") {
      conversionSuccess = finalOutputType !== "question" && !lowSignalDetected;
    } else {
      conversionSuccess = true;
    }
  }

  const tagSource = Array.isArray(intentTags) ? intentTags : [];
  const alignment = evaluateConversionAlignment(products, tagSource, slots);

  let conversionAligned = false;
  if (alignment.actionMatchType === "intent_no_signal") {
    conversionAligned = conversionSuccess;
  } else if (alignment.actionMatchType === "matched" && !failureType) {
    conversionAligned = true;
  } else if (alignment.actionMatchType === "partial" || alignment.actionMatchType === "mismatched") {
    conversionAligned = false;
    if (!failureType && plen > 0 && alignment.actionMatchType === "mismatched") {
      frictionPoint = frictionPoint || "wrong_action";
    }
  }

  return {
    failureType,
    frictionPoint,
    conversionIntent,
    conversionSuccess,
    conversionAligned,
    conversionAlignment: {
      actionMatchType: alignment.actionMatchType,
      intentActionTags: extractActionCategoryTags(tagSource, slots),
      matchedProductCount: alignment.matchedProductCount,
      shownProductCount: plen,
      tagsMatched: alignment.tagsMatched,
      tagsUnmatched: alignment.tagsUnmatched
    }
  };
}

module.exports = {
  classifyInteraction,
  evaluateConversionAlignment
};
