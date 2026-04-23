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

function getBugGlassDefaultSnippet() {
  return "Pre-umezeste zona, lasa solutia 60-90 secunde sa actioneze, sterge usor cu microfibra curata si finalizeaza cu cleaner de geam pentru claritate.";
}

function getToolCareTowelReply() {
  return [
    "Iata ghidul rapid pentru spalarea lavetei/prosopului din microfibra:",
    "- Spala la 30-40C, program delicat.",
    "- Foloseste detergent lichid simplu, fara inalbitori.",
    "- Nu folosi balsam de rufe (incarca fibrele).",
    "- Spala separat de bumbac sau materiale care lasa scame.",
    "- Clateste bine, ideal cu extra-rinse.",
    "- Evita uscarea la temperatura mare; daca folosesti uscator, doar low heat.",
    "- Ideal: uscare la aer, ferit de praf.",
    "- Daca devine aspra, mai fa un ciclu scurt fara detergent, doar clatire."
  ].join("\n");
}

function scoreDeterministicFallbackProduct(product, fallbackTags) {
  const tags = Array.isArray(product?.tags)
    ? product.tags.map(tag => normalizeText(tag)).filter(Boolean)
    : [];

  let score = 0;
  fallbackTags.forEach(tag => {
    if (tags.includes(tag)) {
      score += 1;
    }
  });

  return score;
}

function selectFallbackProductsForFlow(products, flowId, slots = {}) {
  if (flowId !== "bug_removal_quick" || normalizeText(slots?.surface) !== "glass") {
    return { strictCount: 0, fallbackCount: 0, selected: [], reason: null };
  }

  const safeProducts = Array.isArray(products) ? products : [];
  const strictCandidates = safeProducts.filter(product => {
    const tags = Array.isArray(product?.tags)
      ? product.tags.map(tag => normalizeText(tag)).filter(Boolean)
      : [];
    return tags.includes("glass_cleaner");
  });

  if (strictCandidates.length > 0) {
    return {
      strictCount: strictCandidates.length,
      fallbackCount: 0,
      selected: uniqueProducts(strictCandidates).slice(0, 2),
      reason: "strict_glass_cleaner"
    };
  }

  const fallbackTags = ["glass_cleaner", "glass", "cleaner"];
  const fallbackCandidates = safeProducts
    .map(product => ({
      product,
      score: scoreDeterministicFallbackProduct(product, fallbackTags)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.product?.name || "").localeCompare(String(b.product?.name || ""));
    })
    .map(item => item.product);

  const selected = uniqueProducts(fallbackCandidates).slice(0, 2);

  const reason = selected.length > 0
    ? "fallback_tags_glass_cleaner_cleaner_glass"
    : "no_matching_products";

  return {
    strictCount: strictCandidates.length,
    fallbackCount: fallbackCandidates.length,
    selected,
    reason
  };
}

function selectGenericSafeFallbackProduct(products = []) {
  const safeProducts = Array.isArray(products) ? products : [];
  const ranked = safeProducts
    .map(product => ({
      product,
      score: scoreDeterministicFallbackProduct(product, ["cleaner", "glass", "interior", "microfiber"])
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.product?.name || "").localeCompare(String(b.product?.name || ""));
    });

  return ranked[0]?.product || null;
}

function isSurfaceAwareCleaningStep(step) {
  const stepId = normalizeText(step?.id);

  return stepId === "general_clean" || stepId.includes("clean");
}

function getStepKnowledge(step, slots = {}, flowId = null) {
  const knowledgeIds = Array.isArray(step?.knowledgeIds) ? step.knowledgeIds : [];
  const surface = normalizeText(slots?.surface);
  const stepId = String(step?.id || "").trim() || null;

  if (flowId === "bug_removal_quick" && surface === "glass" && stepId) {
    const stepSpecificId = `${flowId}_${stepId}_glass`;
    const stepSpecificEntry = getKnowledgeEntryById(stepSpecificId);
    if (stepSpecificEntry) {
      logInfo("FLOW_STEP_KNOWLEDGE", {
        flowId,
        stepId,
        knowledgeUsed: stepSpecificId,
        fallbackUsed: false
      });
      return [String(stepSpecificEntry.content || "").trim()].filter(Boolean);
    }

    const fallbackSnippet = getBugGlassDefaultSnippet();
    logInfo("FLOW_STEP_KNOWLEDGE", {
      flowId,
      stepId,
      knowledgeUsed: null,
      fallbackUsed: true
    });
    return [fallbackSnippet];
  }

  if (surface && isSurfaceAwareCleaningStep(step)) {
    const surfaceKnowledgeId = `${surface}_cleaning`;
    const surfaceEntry = getKnowledgeEntryById(surfaceKnowledgeId);

    if (surfaceEntry) {
      logInfo("FLOW_STEP_KNOWLEDGE", {
        flowId,
        stepId,
        knowledgeUsed: surfaceKnowledgeId,
        fallbackUsed: false
      });
      return [String(surfaceEntry.content || "").trim()].filter(Boolean);
    }
  }

  const fallbackEntries = knowledgeIds
    .map(id => getKnowledgeEntryById(id))
    .filter(Boolean);

  logInfo("FLOW_STEP_KNOWLEDGE", {
    flowId,
    stepId,
    knowledgeUsed: fallbackEntries[0]?.id || null,
    fallbackUsed: false
  });

  const snippets = fallbackEntries
    .map(entry => String(entry.content || "").trim())
    .filter(Boolean);

  if (flowId === "bug_removal_quick" && surface === "glass" && snippets.length === 0) {
    logInfo("FLOW_STEP_KNOWLEDGE", {
      flowId,
      stepId,
      knowledgeUsed: null,
      fallbackUsed: true
    });
    return [getBugGlassDefaultSnippet()];
  }

  return snippets;
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

  if (flowId === "tool_care_towel") {
    return {
      reply: getToolCareTowelReply(),
      products: [],
      steps: [
        {
          id: "tool_care_towel_guidance",
          title: "Ghid rapid de spalare microfibra",
          goal: "Intretinere corecta pentru lavete si prosoape din microfibra.",
          explanation: getToolCareTowelReply(),
          roles: [],
          products: []
        }
      ]
    };
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
    const knowledgeSnippets = getStepKnowledge(step, slots, flowId);
    const stepExplanation = buildStepExplanation(stepGoal, knowledgeSnippets);
    const safeStepExplanation = stepExplanation || `Executa ${stepTitle} cu tehnica standard de curatare.`;
    let stepProducts = limitStepProducts(
      stepRoles.flatMap(role => resolveProductsForRole(role, products))
    );

    if (stepProducts.length === 0) {
      const fallback = selectFallbackProductsForFlow(products, flowId, slots);
      logInfo("FLOW_PRODUCT_FALLBACK", {
        flowId,
        stepId: step?.id || null,
        strictCount: fallback.strictCount,
        fallbackCount: fallback.fallbackCount,
        selectedCount: fallback.selected.length,
        reason: fallback.reason
      });
      if (fallback.selected.length > 0) {
        stepProducts = fallback.selected;
      }
    }

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

  if (flowId === "bug_removal_quick" && uniqueProducts(allProducts).length === 0) {
    lines.push("");
    lines.push("Produse: no matching products");
  }

  let finalProducts = uniqueProducts(allProducts);
  if (finalProducts.length === 0) {
    const safeFallback = selectGenericSafeFallbackProduct(products);
    if (safeFallback) {
      finalProducts = [safeFallback];
      lines.push("");
      lines.push(`Nu am gasit produs exact; recomand ${String(safeFallback?.name || "un cleaner sigur")}.`);
      logInfo("FLOW_GENERIC_FALLBACK", {
        flowId,
        product: safeFallback?.name || null,
        reason: "no_matching_products"
      });
    } else {
      lines.push("");
      lines.push("Nu am gasit produs exact pentru acest pas.");
      logInfo("FLOW_GENERIC_FALLBACK", {
        flowId,
        product: null,
        reason: "no_safe_product_found"
      });
    }
  }

  return {
    reply: lines.join("\n"),
    products: finalProducts,
    steps: structuredSteps
  };
}

module.exports = { executeFlow };
