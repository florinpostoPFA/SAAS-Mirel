/**
 * Goal A (F45): assembly-layer observability — responsePath + Phase 1 counts.
 * Observability only; does not influence routing or decisions.
 */

"use strict";

const TOOL_ROLE_RE = /brush|towel|tool|applicator|pad|mitt|sponge/i;

/**
 * @param {object} opts
 * @param {object} opts.decision
 * @param {string|null} opts.finalOutputType
 * @param {object} [opts.interactionRef]
 * @param {object} [opts.patch]
 * @returns {string}
 */
function deriveResponsePath({ decision = {}, finalOutputType = null, interactionRef = {}, patch = {} }) {
  const action = decision?.action ?? null;
  const reasonCode = String(decision?.reasonCode || "");
  const productsReason = String(
    patch?.productsReason ?? decision?.productsReason ?? interactionRef?.assemblyTelemetry?.productsReason ?? ""
  );

  if (reasonCode.startsWith("routing.handoff.")) {
    return "handoff";
  }
  if (
    interactionRef?.turnTerminal === "error" ||
    finalOutputType === "error" ||
    patch?.terminalPath === "error"
  ) {
    return "error";
  }
  if (
    interactionRef?.assemblyTelemetry?.safeFallbackFired === true ||
    (action === "knowledge" &&
      productsReason === "no_matching_products" &&
      interactionRef?.assemblyTelemetry?.priorRecommendPath === true)
  ) {
    return "fallback";
  }
  if (action === "clarification" && finalOutputType === "question") {
    return "clarification";
  }
  if (action === "flow") {
    return "flow";
  }
  if (action === "recommend" || action === "selection") {
    return "recommendation";
  }
  if (action === "knowledge") {
    return "knowledge";
  }
  return "knowledge";
}

/**
 * @param {object|null|undefined} flowDef
 * @returns {{ knowledgeCount: number, toolCount: number }}
 */
function countFromFlowDefinition(flowDef) {
  const steps = Array.isArray(flowDef?.steps) ? flowDef.steps : [];
  let knowledgeCount = 0;
  let toolCount = 0;
  for (const step of steps) {
    const kid = Array.isArray(step?.knowledgeIds) ? step.knowledgeIds.length : 0;
    knowledgeCount += kid > 0 ? kid : step?.id && String(step.id).includes("clean") ? 1 : 0;
    const roles = Array.isArray(step?.roles)
      ? step.roles
      : Array.isArray(step?.productRoles)
        ? step.productRoles
        : [];
    toolCount += roles.filter((r) => TOOL_ROLE_RE.test(String(r || ""))).length;
  }
  return { knowledgeCount, toolCount };
}

/**
 * @param {object} opts
 * @param {object} opts.interactionRef
 * @param {object} opts.decision
 * @param {string|null} opts.finalOutputType
 * @param {unknown[]} opts.finalProducts
 * @param {object} [opts.patch]
 * @returns {{ flowId: string|null, responsePath: string, productsCount: number, knowledgeCount: number, toolCount: number }}
 */
function buildAssemblySnapshotMeta({
  interactionRef = {},
  decision = {},
  finalOutputType = null,
  finalProducts = [],
  patch = {}
}) {
  const telemetry = interactionRef.assemblyTelemetry || {};
  const productsCount = Array.isArray(finalProducts) ? finalProducts.length : 0;
  let knowledgeCount = Number(telemetry.knowledgeCount);
  let toolCount = Number(telemetry.toolCount);
  if (!Number.isFinite(knowledgeCount)) {
    knowledgeCount =
      interactionRef.knowledgeTelemetry?.knowledgeDeadEndDetected ||
      interactionRef.knowledgeTelemetry?.knowledgeRecoveryApplied
        ? 0
        : decision?.action === "knowledge"
          ? productsCount > 0
            ? 1
            : 0
          : 0;
  }
  if (!Number.isFinite(toolCount)) {
    toolCount = 0;
  }
  if (telemetry.flowDef) {
    const fromFlow = countFromFlowDefinition(telemetry.flowDef);
    if (telemetry.knowledgeCount == null) knowledgeCount = fromFlow.knowledgeCount;
    if (telemetry.toolCount == null) toolCount = fromFlow.toolCount;
  }

  return {
    flowId: decision?.flowId ?? null,
    responsePath: deriveResponsePath({ decision, finalOutputType, interactionRef, patch }),
    productsCount,
    knowledgeCount: Math.max(0, knowledgeCount),
    toolCount: Math.max(0, toolCount)
  };
}

module.exports = {
  deriveResponsePath,
  buildAssemblySnapshotMeta,
  countFromFlowDefinition
};
