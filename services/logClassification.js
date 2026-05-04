/**
 * Observability-only interaction labels for JSONL (Epic 1.1).
 * Does not influence routing or decisions.
 */

const { inferHighLevelIntent } = require("./productIntentHeuristics");

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
 * @returns {{
 *   failureType: "wrong_flow"|"no_products"|"clarification_loop"|"low_signal"|null,
 *   frictionPoint: string|null,
 *   conversionIntent: boolean,
 *   conversionSuccess: boolean
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
    productsReason = null
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

  if (lowSignalDetected) {
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

  return {
    failureType,
    frictionPoint,
    conversionIntent,
    conversionSuccess
  };
}

module.exports = {
  classifyInteraction
};
