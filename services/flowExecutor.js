const productRoles = require("../data/product_roles.json");
const knowledgeFlow = require("../data/knowledge_flow.json");
const config = require("../config");
const { logInfo } = require("./logger");

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizeWords(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .map(part => part.trim())
    .filter(Boolean);
}

function getKnowledgeEntryById(id) {
  return knowledgeFlow.find(entry => String(entry?.id) === String(id)) || null;
}

function isSurfaceAwareCleaningStep(step) {
  const stepId = normalizeText(step?.id);

  return stepId === "general_clean" || stepId.includes("clean");
}

function getStepKnowledge(step, slots = {}) {
  const knowledgeIds = Array.isArray(step?.knowledgeIds) ? step.knowledgeIds : [];
  const surface = normalizeText(slots?.surface);
  const stepId = String(step?.id || "").trim() || null;

  if (surface && isSurfaceAwareCleaningStep(step)) {
    const surfaceKnowledgeId = `${surface}_cleaning`;
    const surfaceEntry = getKnowledgeEntryById(surfaceKnowledgeId);

    if (surfaceEntry) {
      logInfo("KNOWLEDGE_SELECTION", {
        stepId,
        surface,
        used: surfaceKnowledgeId
      });
      return [String(surfaceEntry.content || "").trim()].filter(Boolean);
    }
  }

  const fallbackEntries = knowledgeIds
    .map(id => getKnowledgeEntryById(id))
    .filter(Boolean);

  logInfo("KNOWLEDGE_SELECTION", {
    stepId,
    surface: surface || null,
    used: fallbackEntries[0]?.id || null
  });

  return fallbackEntries
    .map(entry => String(entry.content || "").trim())
    .filter(Boolean);
}

function matchesRoleText(product, matchText) {
  const needle = normalizeText(matchText);

  if (!needle) {
    return false;
  }

  const name = normalizeText(product?.name);
  const category = normalizeText(product?.category);
  const words = normalizeWords(product?.searchText);

  return name.includes(needle) || category.includes(needle) || words.includes(needle);
}

function matchesRoleTags(product, matchTags) {
  const normalizedTags = Array.isArray(product?.tags)
    ? product.tags.map(tag => normalizeText(tag)).filter(Boolean)
    : [];
  const expectedTags = Array.isArray(matchTags)
    ? matchTags.map(tag => normalizeText(tag)).filter(Boolean)
    : [];

  if (expectedTags.length === 0) {
    return false;
  }

  return expectedTags.some(tag => normalizedTags.includes(tag));
}

function scoreRoleProduct(product, roleConfig) {
  let score = 0;

  for (const text of roleConfig.matchText || []) {
    if (matchesRoleText(product, text)) {
      score += 5;
    }
  }

  for (const tag of roleConfig.matchTags || []) {
    if (matchesRoleTags(product, [tag])) {
      score += 1;
    }
  }

  return score;
}

function uniqueProducts(products) {
  const seen = new Set();

  return (products || []).filter(product => {
    const key = String(product?.id || product?.name || "").trim();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function resolveProductsForRole(role, products) {
  const roleConfig = productRoles[role];
  const safeProducts = Array.isArray(products) ? products : [];

  if (!roleConfig) {
    return [];
  }

  const strongMatches = safeProducts.filter(product =>
    (roleConfig.matchText || []).some(text => matchesRoleText(product, text))
  );
  const fallbackMatches = safeProducts.filter(product =>
    matchesRoleTags(product, roleConfig.matchTags || [])
  );
  const candidates = uniqueProducts([...strongMatches, ...fallbackMatches])
    .map(product => ({
      product,
      score: scoreRoleProduct(product, roleConfig)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const aName = String(a.product?.name || "");
      const bName = String(b.product?.name || "");
      return aName.localeCompare(bName);
    });

  const limit = 1;
  return candidates.slice(0, limit).map(item => item.product);
}

function buildStepExplanation(stepGoal, knowledgeSnippets) {
  const parts = [];

  if (stepGoal) {
    parts.push(stepGoal);
  }

  if (knowledgeSnippets.length > 0) {
    parts.push(...knowledgeSnippets);
  }

  return parts.join(" ").trim();
}

function limitStepProducts(products) {
  return uniqueProducts(products).slice(0, 2);
}

function getFlowRegistry(currentFlow) {
  const configuredFlows = config?.flows && typeof config.flows === "object"
    ? config.flows
    : {};

  const registry = {
    ...configuredFlows
  };

  const currentFlowId = currentFlow?.flowId || currentFlow?.id;
  if (currentFlowId && typeof currentFlowId === "string") {
    registry[currentFlowId] = currentFlow;
  }

  return registry;
}

function executeFlow(flow, products, slots = {}) {
  const safeFlow = flow && typeof flow === "object" ? flow : {};
  const flowId = safeFlow.flowId || safeFlow.id || null;
  const flowRegistry = getFlowRegistry(safeFlow);

  console.log("STAGE:EXECUTE_FLOW", {
    flowId,
    availableFlows: Object.keys(flowRegistry || {})
  });

  if (!flowId || typeof flowId !== "string") {
    throw new Error("Invalid flowId: must be string");
  }

  if (!flowRegistry[flowId]) {
    throw new Error("Flow not found: " + flowId);
  }

  const steps = Array.isArray(safeFlow.steps) ? safeFlow.steps : [];
  const lines = [];
  const allProducts = [];
  const structuredSteps = [];

  lines.push(`Titlu: ${String(safeFlow.title || safeFlow.flowId || "Flow")}`);
  lines.push("Pasi:");

  steps.forEach((step, index) => {
    const stepNumber = index + 1;
    const stepTitle = String(step?.title || `Pas ${stepNumber}`);
    const stepGoal = String(step?.goal || "").trim();
    const stepRoles = Array.isArray(step?.roles)
      ? step.roles
      : Array.isArray(step?.productRoles)
        ? step.productRoles
        : [];
    const knowledgeSnippets = getStepKnowledge(step, slots);
    const stepExplanation = buildStepExplanation(stepGoal, knowledgeSnippets);
    const safeStepExplanation = stepExplanation || `Executa ${stepTitle} cu tehnica standard de curatare.`;
    const stepProducts = limitStepProducts(
      stepRoles.flatMap(role => resolveProductsForRole(role, products))
    );

    structuredSteps.push({
      id: step?.id || `step_${stepNumber}`,
      title: stepTitle,
      goal: stepGoal,
      explanation: safeStepExplanation,
      roles: stepRoles,
      products: stepProducts
    });

    allProducts.push(...stepProducts);

    lines.push("");
    lines.push(`Pasul ${stepNumber}: ${stepTitle}`);
    lines.push("");
    lines.push("Ce faci:");
    lines.push(safeStepExplanation);

    if (stepProducts.length > 0) {
      lines.push("");
      lines.push("Produse:");
      lines.push("");
      lines.push("Recomandat:");
      lines.push(`- ${String(stepProducts[0]?.name || "Produs")}`);

      if (stepProducts[1]) {
        lines.push("");
        lines.push("Optional:");
        lines.push(`- ${String(stepProducts[1]?.name || "Produs")}`);
      }
    }
  });

  return {
    reply: lines.join("\n"),
    products: uniqueProducts(allProducts),
    steps: structuredSteps
  };
}

module.exports = { executeFlow };
