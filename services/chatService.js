// Chat logic - orchestrate search, prompt building, and LLM
const config = require("../config");
const { searchProductsByTags } = require("./search");
const { buildPrompt } = require("./promptBuilder");
const { getSettings } = require("./settingsService");
const { askLLM } = require("./llm");
const { detectTags } = require("./tagService");
const { detectIntent } = require("./intentService");
const { chooseStrategy } = require("./strategyService");
const { rankProducts } = require("./rankingService");
const { trackImpressions } = require("./trackingService");
const { getSession: getSessionService, updateSessionWithProducts, getSessionContext } = require("./sessionService");
const { getSession, saveSession } = require("./sessionStore");
const { decideNextAction } = require("./decisionService");
const { info, debug, error, warn, logInfo } = require("./logger");
const { appendInteractionLine } = require("./interactionLog");
const supportService = require("./supportService");
const { emit } = require("./eventBus");
const { resolveFlow, resolveFlowCandidate, resolveFlowCandidates } = require("./flowResolver");
const { executeFlow } = require("./flowExecutor");
const { normalizeDecision } = require("./decisionNormalizer");
const { detectQueryType } = require("./queryTypeService");
const { routeRequest, areSlotsComplete, getMissingSlot: getRouterMissingSlot } = require("./router");
const { findRelevantKnowledge } = require("./knowledgeService");
const fallbackProductsCatalog = require("../data/products.json");
const productRoles = require("../data/product_roles.json");
const knowledgeBase = require("../data/knowledge.json");

const SOURCE = "ChatService";
const SURFACE_TAGS = ["paint", "textile", "leather", "alcantara", "plastic", "glass", "wheels"];
const OBJECT_SLOT_VALUES = ["cotiera", "scaun", "plafon", "bord", "oglinda", "geam", "parbriz", "oglinzi", "volan", "mocheta", "tapiterie", "glass"];
const OBJECT_MATCH_TERMS = {
  cotiera: ["cotiera", "armrest"],
  scaun: ["scaun", "seat", "scaune"],
  plafon: ["plafon", "headliner", "ceiling"],
  bord: ["bord", "dashboard"],
  oglinda: ["oglinda", "mirror"],
  geam: ["geam", "geamuri", "glass"],
  parbriz: ["parbriz", "windshield"],
  oglinzi: ["oglinda", "oglinzi", "mirror", "mirrors"],
  glass: ["sticla", "geam", "geamuri", "parbriz", "glass", "windshield"],
  volan: ["volan", "steering wheel"],
  mocheta: ["mocheta", "carpet", "floor mat", "floor mats"],
  tapiterie: ["tapiterie", "upholstery"],
  jante: ["jante", "jante", "wheels", "roti", "anvelope"],
  caroserie: ["caroserie", "caroseria", "carrosserie", "body"]
};
const OBJECT_SLOT_INFERENCE = {
  oglinda: { context: "exterior", surface: "glass" },
  oglinzi: { context: "exterior", surface: "glass" },
  geam: { context: "exterior", surface: "glass" },
  parbriz: { context: "exterior", surface: "glass" },
  bord: { context: "interior", surface: "plastic" },
  scaun: { context: "interior", surface: null },
  cotiera: { context: "interior", surface: null }
};
const OBJECT_CONTEXT_MAP = {
  mocheta: "interior",
  cotiera: "interior",
  scaun: "interior",
  plafon: "interior",
  jante: "exterior",
  roti: "exterior",
  anvelope: "exterior",
  parbriz: "exterior",
  geam: "exterior"
};
const OBJECT_SURFACE_MAP = {
  cotiera: ["textile", "leather", "alcantara", "plastic"],
  scaun: ["textile", "leather", "alcantara"],
  volan: ["leather", "alcantara", "plastic"],
  bord: ["plastic"],
  plafon: ["textile", "alcantara"],
  mocheta: ["textile"],
  oglinda: ["glass"],
  geam: ["glass"],
  parbriz: ["glass"],
  glass: ["glass"],
  oglinzi: ["glass"],
  tapiterie: ["textile", "leather", "alcantara"]
};
const SLOT_DOMAIN_RULES = {
  scaun:     { context: "interior", allowedSurfaces: ["textile", "leather", "alcantara"] },
  bancheta:  { context: "interior", allowedSurfaces: ["textile", "leather", "alcantara"] },
  bord:      { context: "interior", allowedSurfaces: ["plastic"] },
  consola:   { context: "interior", allowedSurfaces: ["plastic"] },
  mocheta:   { context: "interior", allowedSurfaces: ["textile"] },
  volan:     { context: "interior", allowedSurfaces: ["leather", "alcantara", "plastic"] },
  cotiera:   { context: "interior", allowedSurfaces: ["textile", "leather", "alcantara", "plastic"] },
  tapiterie: { context: "interior", allowedSurfaces: ["textile", "leather", "alcantara"] },
  plafon:    { context: "interior", allowedSurfaces: ["textile", "alcantara"] },
  caroserie: { context: "exterior", allowedSurfaces: ["paint"] },
  jante:     { context: "exterior", allowedSurfaces: ["wheels"] },
  geam:      { context: "exterior", allowedSurfaces: ["glass"] },
  parbriz:   { context: "exterior", allowedSurfaces: ["glass"] },
  oglinzi:   { context: "exterior", allowedSurfaces: ["glass"] },
  oglinda:   { context: "exterior", allowedSurfaces: ["glass"] }
};
const GLASS_OBJECT_ALIASES = ["sticla", "geam", "geamuri", "parbriz", "glass", "windshield"];
const INSECT_SIGNAL_KEYWORDS = [
  "insecte",
  "musca",
  "gandaci",
  "buguri",
  "urme de insecte",
  "insecte pe parbriz"
];

function canonicalizeObjectValue(object) {
  const normalized = String(object || "").toLowerCase().trim();
  if (!normalized) {
    return null;
  }

  if (GLASS_OBJECT_ALIASES.includes(normalized)) {
    return "glass";
  }

  return normalized;
}

function hasExplicitInsectSignal(message) {
  const msg = String(message || "").toLowerCase();
  return INSECT_SIGNAL_KEYWORDS.some(keyword => msg.includes(keyword));
}

function hasStrongGlassExteriorSignal(message) {
  const msg = String(message || "").toLowerCase();
  return (msg.includes("insecte") || msg.includes("urme de insecte")) && msg.includes("parbriz");
}

function hasStrongGlassInteriorSignal(message) {
  const msg = String(message || "").toLowerCase();
  return msg.includes("urme") && (msg.includes("geam") || msg.includes("sticla")) && msg.includes("interior");
}

function hasExplicitExteriorSignal(message) {
  const msg = String(message || "").toLowerCase();
  const terms = [
    "exterior",
    "exterioara",
    "exterioare",
    "afara",
    "in exterior",
    "trim exterior",
    "ornament exterior"
  ];

  return terms.some(term => msg.includes(term));
}

function shouldDefaultLeatherToInterior(message, slots = {}) {
  const msg = String(message || "").toLowerCase();
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const hasLeatherSignal =
    msg.includes("piele") ||
    msg.includes("leather") ||
    String(safeSlots.surface || "").toLowerCase() === "leather";

  if (!hasLeatherSignal) {
    return false;
  }

  if (hasExplicitExteriorSignal(msg)) {
    return false;
  }

  return true;
}

function shouldStripLeatherForTowelMessage(message, slots = {}) {
  const msg = String(message || "").toLowerCase();
  const object = String(slots?.object || "").toLowerCase();
  const mentionsTowel = msg.includes("prosop") || msg.includes("towel") || msg.includes("laveta");
  return mentionsTowel || object === "prosop" || object === "towel";
}

function sanitizeTagsForMessage(message, tags, slots = {}) {
  const safeTags = Array.isArray(tags) ? tags : [];
  if (!shouldStripLeatherForTowelMessage(message, slots)) {
    return safeTags;
  }

  const sanitized = safeTags.filter(tag => String(tag || "").toLowerCase() !== "leather");
  if (sanitized.length !== safeTags.length) {
    logInfo("TAG_SANITIZE", {
      reason: "towel_object_remove_leather",
      before: safeTags,
      after: sanitized
    });
  }
  return sanitized;
}

function findCanonicalApcProduct(products) {
  const safeProducts = Array.isArray(products) ? products : [];
  return safeProducts.find(product => {
    const name = String(product?.name || "").toLowerCase();
    const meta = String(product?.meta_keyword || "").toLowerCase();
    const searchText = String(product?.searchText || "").toLowerCase();
    return (
      name.includes("all purpose cleaner") ||
      meta.includes(" apc") ||
      meta.includes(",apc") ||
      searchText.includes("all purpose cleaner")
    );
  }) || null;
}

function ensureApcProductIncluded(products, catalog, tags) {
  const safeTags = Array.isArray(tags)
    ? tags.map(tag => String(tag || "").toLowerCase())
    : [];
  if (!safeTags.includes("apc")) {
    return Array.isArray(products) ? products : [];
  }

  const safeProducts = Array.isArray(products) ? products : [];
  const apcProduct = findCanonicalApcProduct(catalog);
  if (!apcProduct) {
    return safeProducts;
  }

  const alreadyIncluded = safeProducts.some(product => String(product?.id || "") === String(apcProduct.id || ""));
  if (alreadyIncluded) {
    return safeProducts;
  }

  const merged = [apcProduct, ...safeProducts].slice(0, Math.max(MAX_SELECTION_PRODUCTS, 3));
  logInfo("APC_FORCE_INCLUDE", {
    forced: true,
    product: apcProduct?.name || null
  });
  return merged;
}
function getFlowLogPayload(intent, slots, flow, reason = null) {
  if (flow) {
    return { matched: flow.flowId || "unknown" };
  }

  if (reason) {
    return { matched: null, reason };
  }

  if (intent !== "product_guidance") {
    return { matched: null, reason: "intent_not_product_guidance" };
  }

  if (!slots?.context) {
    return { matched: null, reason: "missing_context" };
  }

  if (!slots?.surface) {
    return { matched: null, reason: "missing_surface" };
  }

  return { matched: null, reason: "no_matching_flow" };
}

function logResponseSummary(type, options = {}) {
  logInfo("RESPONSE", {
    type,
    steps: Number(options.steps || 0),
    products: Number(options.products || 0)
  });
}

function extractFeedback(reqPayload) {
  if (!reqPayload || typeof reqPayload !== "object") {
    return { helpful: null, reason: null };
  }
  const f = reqPayload.feedback;
  if (f && typeof f === "object") {
    const helpful = f.helpful;
    return {
      helpful:
        typeof helpful === "boolean"
          ? helpful
          : helpful === null || helpful === undefined
            ? null
            : Boolean(helpful),
      reason:
        f.reason != null && String(f.reason).trim() !== ""
          ? String(f.reason).slice(0, 500)
          : null
    };
  }
  return { helpful: null, reason: null };
}

function summarizeProductsForLog(products) {
  if (!Array.isArray(products) || products.length === 0) return [];
  return products.slice(0, 25).map(p => ({
    id: p.id != null ? p.id : null,
    sku: p.sku != null ? String(p.sku) : null,
    name: p.name != null ? String(p.name) : null
  }));
}

function inferOutputType(result) {
  if (!result || typeof result !== "object") return "unknown";
  if (result.type === "question") return "question";
  if (Array.isArray(result.products) && result.products.length > 0) return "recommendation";
  if (result.reply != null || result.message != null) return "reply";
  return "unknown";
}

function getResultTypeFromOutputType(outputType) {
  if (outputType === "flow") return "flow";
  if (outputType === "question") return "question";
  if (outputType === "recommendation") return "recommendation";
  if (outputType === "reply") return "reply";
  return null;
}

const flowRequirements = {
  bug_removal_quick: ["context", "target"],
  interior_clean_basic: ["context", "material"],
  glass_clean_basic: ["context"],
  wheel_tire_deep_clean: ["context", "target"]
};

function getFlowRequirementValue(flowId, requirement, slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};

  if (requirement === "context") {
    return safeSlots.context;
  }

  if (flowId === "interior_clean_basic" && requirement === "material") {
    return safeSlots.surface;
  }

  if (flowId === "bug_removal_quick" && requirement === "target") {
    return safeSlots.object || safeSlots.surface;
  }

  if (flowId === "wheel_tire_deep_clean" && requirement === "target") {
    return safeSlots.surface || safeSlots.object;
  }

  return safeSlots[requirement];
}

function shouldExecuteFlow(flowId, slots) {
  const required = flowRequirements[flowId];

  if (!required) {
    return true;
  }

  return required.every(slot => {
    const value = getFlowRequirementValue(flowId, slot, slots);
    return value !== null && value !== undefined;
  });
}

function getFlowMissingSlot(flowId, slots) {
  const required = flowRequirements[flowId];

  if (!required) {
    return null;
  }

  return required.find(slot => {
    const value = getFlowRequirementValue(flowId, slot, slots);
    return value === null || value === undefined;
  }) || null;
}

function mapFlowMissingSlot(flowId, missingSlot, slots) {
  if (missingSlot === "context") {
    return "context";
  }

  if (missingSlot === "material") {
    return "surface";
  }

  if (missingSlot === "target") {
    return "object";
  }

  return missingSlot;
}

function getFlowClarification(flowId, missingSlot, slots) {
  const promptSlot = mapFlowMissingSlot(flowId, missingSlot, slots);

  if (missingSlot === "context") {
    return {
      missingSlot,
      promptSlot,
      state: "NEEDS_CONTEXT",
      message: getClarificationQuestion("context", slots)
    };
  }

  if (missingSlot === "material") {
    return {
      missingSlot,
      promptSlot,
      state: "NEEDS_SURFACE",
      message: getClarificationQuestion("surface", slots)
    };
  }

  if (flowId === "bug_removal_quick" && missingSlot === "target") {
    return {
      missingSlot,
      promptSlot,
      state: "NEEDS_OBJECT",
      message: "Pe ce suprafata? Parbriz sau vopsea?"
    };
  }

  return {
    missingSlot,
    promptSlot,
    state: "NEEDS_OBJECT",
    message: "Ce vrei sa cureti mai exact?"
  };
}

function getClarificationQuestion(missingSlot, slots) {
  if (missingSlot === "context") {
    if (canonicalizeObjectValue(slots?.object) === "glass") {
      return "Interior sau exterior?";
    }
    return "Este pentru interior sau exterior?";
  }

  if (missingSlot === "surface") {
    if (slots?.context === "interior") {
      return "Materialul este textil, piele sau plastic?";
    }

    if (slots?.context === "exterior") {
      return "Ce vrei sa cureti la exterior: vopsea, jante sau geamuri?";
    }

    return "Ce suprafata vrei sa cureti?";
  }

  if (missingSlot === "object") {
    return "Despre ce element este vorba?";
  }

  return "Poți sa-mi dai mai multe detalii?";
}

function assertMissingSlotInvariant(decision, slots) {
  if (!decision || typeof decision !== "object") {
    return;
  }

  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const missingSlot = decision.missingSlot;

  if (!missingSlot) {
    return;
  }

  const value = safeSlots[missingSlot];
  if (value !== null && value !== undefined && String(value).trim() !== "") {
    console.error("INVARIANT_FAILURE", {
      decision,
      slots: safeSlots,
      message: null
    });
    throw new Error("INVALID STATE: slot exists but marked missing");
  }
}

function throwInvariantFailure(errorMessage, decision, slots, message) {
  console.error("INVARIANT_FAILURE", {
    decision,
    slots,
    message,
    computedMissingSlot: getMissingSlot(slots && typeof slots === "object" ? slots : {})
  });
  throw new Error(errorMessage);
}

class DecisionBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DecisionBoundaryError";
    this.code = code;
    this.details = details;
  }
}

class DecisionFinalityViolation extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DecisionFinalityViolation";
    this.code = code;
    this.details = details;
  }
}

function assertDecisionInvariantsBeforeExecution(decision, slots, message) {
  const safeDecision = decision && typeof decision === "object" ? decision : {};
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const missingSlot = getMissingSlot(safeSlots);

  if (safeDecision.action === "clarification") {
     // Allow missingSlot=null for validator-triggered invalid combinations
     if (safeDecision.missingSlot === null && missingSlot === null) {
       // All slots defined but combination is invalid - this is OK
       return;
     }

     if (!safeDecision.missingSlot) {
       throwInvariantFailure("INVALID STATE: clarification without missingSlot", safeDecision, safeSlots, message);
     }

     if (!["context", "object", "surface"].includes(safeDecision.missingSlot)) {
       throwInvariantFailure("INVALID STATE: invalid missingSlot type", safeDecision, safeSlots, message);
     }

    if (safeDecision.missingSlot !== missingSlot) {
      throwInvariantFailure("INVALID STATE: clarification missingSlot mismatch", safeDecision, safeSlots, message);
    }

    if (safeSlots[safeDecision.missingSlot]) {
      throwInvariantFailure("INVALID STATE: slot exists but marked missing", safeDecision, safeSlots, message);
    }
  }

  if (safeDecision.action === "flow") {
    if (!safeDecision.flowId || typeof safeDecision.flowId !== "string") {
      throwInvariantFailure("INVALID STATE: flow without valid flowId", safeDecision, safeSlots, message);
    }
  }
}

function assertDecisionOutputContract(decision, output, slots, message) {
  const safeDecision = decision && typeof decision === "object" ? decision : {};
  const safeOutput = output && typeof output === "object" ? output : {};
  const safeSlots = slots && typeof slots === "object" ? slots : {};

  if (safeDecision.action === "flow" && safeOutput.type !== "flow") {
    throwInvariantFailure("CONTRACT VIOLATION: flow decision but non-flow output", safeDecision, safeSlots, message);
  }

  if (safeDecision.action === "clarification" && safeOutput.type !== "question") {
    throwInvariantFailure("CONTRACT VIOLATION: clarification must return question", safeDecision, safeSlots, message);
  }
}

function getProceduralFlowCandidate(intent, message, slots, sessionContext) {
  if (intent !== "product_guidance") {
    return null;
  }

  return resolveFlowCandidate({
    intent,
    message: getFlowResolverMessage(message, sessionContext),
    slots
  });
}

function enforceClarificationContract(decision) {
  if (!decision || typeof decision !== "object") {
    return decision;
  }

  if (decision.action !== "clarification") {
    return decision;
  }

   // Allow missingSlot=null for validator-triggered invalid combinations
   // where all slots are defined but the combination is invalid
   const isValidatorTriggered = decision.missingSlot === null;
   
   if (!isValidatorTriggered && !decision.missingSlot) {
     console.error("INVARIANT_FAILURE", {
       decision,
       slots: null,
       message: null
     });
     throw new Error("Invalid clarification: missingSlot is required");
   }

   if (!isValidatorTriggered && !["context", "object", "surface"].includes(decision.missingSlot)) {
     console.error("INVARIANT_FAILURE", {
       decision,
       slots: null,
       message: null
     });
     throw new Error("Invalid slot type");
   }

  return decision;
}

function getMissingSlotFromPendingState(state) {
  if (state === "NEEDS_CONTEXT") return "context";
  if (state === "NEEDS_OBJECT") return "object";
  if (state === "NEEDS_SURFACE") return "surface";
  return null;
}

function getBoundarySlotSnapshot(interactionRef, sessionContext) {
  if (interactionRef?.slots && typeof interactionRef.slots === "object") {
    return interactionRef.slots;
  }

  if (sessionContext?.slots && typeof sessionContext.slots === "object") {
    return sessionContext.slots;
  }

  return {};
}

function forceFlowExecutionAtBoundary(interactionRef, sessionContext) {
  const decision = interactionRef?.decision && typeof interactionRef.decision === "object"
    ? interactionRef.decision
    : {};
  const flowId = typeof decision.flowId === "string" ? decision.flowId.trim() : "";
  const flowRegistry = config?.flows && typeof config.flows === "object" ? config.flows : {};
  const prioritizedFlow = flowRegistry[flowId] || null;
  const slotSnapshot = getBoundarySlotSnapshot(interactionRef, sessionContext);
  const availableProducts = Array.isArray(interactionRef?.productsCatalog)
    ? interactionRef.productsCatalog
    : Array.isArray(fallbackProductsCatalog)
      ? fallbackProductsCatalog
      : [];

  if (!flowId) {
    throw new DecisionBoundaryError(
      "FLOW_GUARD_INVALID_FLOW_ID",
      "Flow decision missing valid flowId",
      { decision, slots: slotSnapshot }
    );
  }

  if (!prioritizedFlow) {
    throw new DecisionBoundaryError(
      "FLOW_GUARD_FLOW_NOT_FOUND",
      `Flow not found for forced execution: ${flowId}`,
      { decision, slots: slotSnapshot }
    );
  }

  try {
    const flowResult = executeFlow(prioritizedFlow, availableProducts, slotSnapshot);
    if (!flowResult || typeof flowResult !== "object") {
      throw new DecisionFinalityViolation(
        "FLOW_GUARD_INVALID_EXECUTOR_PAYLOAD",
        "Flow executor returned invalid payload while enforcing flow finality",
        { decision, slots: slotSnapshot, flowId }
      );
    }

    const rawFlowProducts = Array.isArray(flowResult?.products) ? flowResult.products : [];
    const filteredFlowProducts = filterProducts(rawFlowProducts, slotSnapshot);
    const flowBundle = buildProductBundle(filteredFlowProducts);
    const finalFlowProducts = flowBundle.slice(0, 3);
    const flowReply = buildMinimalFlowReply(prioritizedFlow, flowResult);

    return {
      result: {
        type: "flow",
        message: flowReply,
        reply: flowReply,
        products: finalFlowProducts
      },
      outputType: "flow",
      products: summarizeProductsForLog(finalFlowProducts)
    };
  } catch (err) {
    if (err instanceof DecisionFinalityViolation) {
      throw err;
    }

    throw new DecisionBoundaryError(
      "FLOW_GUARD_EXECUTION_FAILED",
      `Forced flow execution failed: ${err.message}`,
      { decision, slots: slotSnapshot }
    );
  }
}

function endInteraction(interactionRef, result, patch = {}) {
  if (patch.intentType != null) interactionRef.intentType = patch.intentType;
  if (patch.tags != null) interactionRef.tags = patch.tags;
  if (patch.slots != null) interactionRef.slots = patch.slots;
  if (patch.decision) {
    interactionRef.decision = { ...interactionRef.decision, ...patch.decision };
  }

  let finalResult = result;
  let finalOutputType = patch.outputType != null ? patch.outputType : inferOutputType(result);
  let finalProducts = patch.products != null ? patch.products : summarizeProductsForLog(result.products);
  const sessionContext = interactionRef?.sessionId ? getSession(interactionRef.sessionId) : null;
  const hardGuardPrompt = "Ce vrei sa cureti mai exact (ex: geamuri, jante, bord, scaune)?";
  const resolveHardGuardMissingSlot = (slots) => {
    const safeSlots = slots && typeof slots === "object" ? slots : {};
    const missingSlot = getMissingSlot(safeSlots);
    return missingSlot || "context";
  };

  // P0 - HARD GUARD: decision.action must never be null
  if (!interactionRef.decision || !interactionRef.decision.action) {
    console.error("HARD_GUARD_VIOLATION", {
      decision: interactionRef.decision,
      slots: interactionRef.slots,
      message: interactionRef.message
    });
    logInfo("HARD_GUARD_TRIGGERED", {
      reason: "null_action",
      decision: interactionRef.decision
    });
    // Fallback: force clarification with generic prompt
    interactionRef.slots = interactionRef.slots ?? {};
    const fallbackMissingSlot = resolveHardGuardMissingSlot(interactionRef.slots);
    interactionRef.decision = {
      action: "clarification",
      flowId: null,
      missingSlot: fallbackMissingSlot,
      hardGuardFallback: true
    };
    finalResult = {
      type: "question",
      message: hardGuardPrompt
    };
    finalOutputType = "question";
    finalProducts = [];
  }

  // P0a - HARD GUARD: clarification decisions must have contract-complete missingSlot
  // Exception: validator-triggered invalid combinations can have missingSlot=null when all slots are defined
  if (interactionRef?.decision?.action === "clarification") {
    interactionRef.slots = interactionRef.slots ?? {};
    const previousMissingSlot = interactionRef.decision.missingSlot;
    const computedMissing = getMissingSlot(interactionRef.slots);
     // If missingSlot is undefined (not provided), compute it
     // If missingSlot is null (explicitly provided by validator), keep null
     let resolvedMissingSlot;
     if (previousMissingSlot === undefined) {
       resolvedMissingSlot = computedMissing || "context";
       logInfo("CLARIFICATION_HARD_GUARD_TRIGGERED", {
         reason: "missing_missingSlot",
         missingSlot: resolvedMissingSlot,
         decision: { ...interactionRef.decision, missingSlot: resolvedMissingSlot },
         slots: interactionRef.slots
       });
     } else {
       resolvedMissingSlot = previousMissingSlot;
     }
   
    interactionRef.decision = {
      ...interactionRef.decision,
      missingSlot: resolvedMissingSlot
    };
  }

  try {
    interactionRef.decision = enforceClarificationContract(interactionRef.decision);
  } catch (err) {
    if (interactionRef?.decision?.hardGuardFallback) {
      interactionRef.slots = interactionRef.slots ?? {};
      const fallbackMissingSlot = resolveHardGuardMissingSlot(interactionRef.slots);
      logInfo("CLARIFICATION_CONTRACT_BYPASSED_HARD_GUARD", {
        error: err.message,
        decision: interactionRef.decision,
        missingSlot: fallbackMissingSlot
      });
      interactionRef.decision = {
        action: "clarification",
        flowId: null,
        missingSlot: fallbackMissingSlot,
        hardGuardFallback: true
      };
      finalResult = {
        type: "question",
        message: hardGuardPrompt
      };
      finalOutputType = "question";
      finalProducts = [];
    } else {
      throw err;
    }
  }

  if (interactionRef?.decision?.hardGuardFallback) {
    try {
      assertDecisionInvariantsBeforeExecution(
        interactionRef.decision,
        interactionRef.slots,
        interactionRef.message
      );
    } catch (err) {
      interactionRef.slots = interactionRef.slots ?? {};
      const fallbackMissingSlot = resolveHardGuardMissingSlot(interactionRef.slots);
      logInfo("HARD_GUARD_INVARIANT_BYPASS", {
        error: err.message,
        decision: interactionRef.decision,
        missingSlot: fallbackMissingSlot
      });
      interactionRef.decision = {
        action: "clarification",
        flowId: null,
        missingSlot: fallbackMissingSlot,
        hardGuardFallback: true
      };
      finalResult = {
        type: "question",
        message: hardGuardPrompt
      };
      finalOutputType = "question";
      finalProducts = [];
    }
  } else {
    assertDecisionInvariantsBeforeExecution(
      interactionRef.decision,
      interactionRef.slots,
      interactionRef.message
    );
  }

  if (interactionRef?.decision?.action === "flow" && finalOutputType !== "flow") {
    const forcedFlowOutput = forceFlowExecutionAtBoundary(interactionRef, sessionContext);
    finalResult = forcedFlowOutput.result;
    finalOutputType = forcedFlowOutput.outputType;
    finalProducts = forcedFlowOutput.products;
  }

  if (interactionRef?.decision?.action === "clarification" && finalOutputType !== "question") {
    throw new DecisionBoundaryError(
      "CLARIFICATION_GUARD_OUTPUT_MISMATCH",
      "Clarification decision must render a question output",
      {
        decision: interactionRef.decision,
        outputType: finalOutputType,
        slots: interactionRef.slots || null,
        message: interactionRef.message
      }
    );
  }

  const resolvedResultType = getResultTypeFromOutputType(finalOutputType);
  if (resolvedResultType && finalResult && typeof finalResult === "object" && !finalResult.type) {
    finalResult = {
      ...finalResult,
      type: resolvedResultType
    };
  }

  assertDecisionOutputContract(
    interactionRef.decision,
    { type: finalOutputType },
    interactionRef.slots,
    interactionRef.message
  );
  logInfo("DECISION_OUTPUT_CONSISTENCY", {
    decision: interactionRef.decision,
    outputType: finalOutputType
  });
  console.log("FINAL_DECISION", interactionRef.decision);

  if (sessionContext) {
    sessionContext.objective = sessionContext.objective || {
      type: null,
      slots: {},
      needsCompletion: false
    };
    sessionContext.objective.needsCompletion =
      Array.isArray(finalResult?.products) &&
      finalResult.products.length > 0 &&
      finalResult.products.length < 2;
    sessionContext.lastUserMessage = interactionRef.message;
    sessionContext.lastResponseType = finalOutputType;
    sessionContext.previousAction = interactionRef?.decision?.action || null;
    saveSession(interactionRef.sessionId, sessionContext);
  }

  const entry = {
    timestamp: interactionRef.timestamp,
    sessionId: interactionRef.sessionId,
    message: interactionRef.message,
    normalizedMessage: interactionRef.message ? String(interactionRef.message).toLowerCase().trim() : null,
    intent: {
      queryType: interactionRef.queryType,
      type: interactionRef.intentType,
      tags: interactionRef.tags
    },
    slots: interactionRef.slots,
    decision: {
      action: interactionRef.decision.action,
      flowId: interactionRef.decision.flowId,
      missingSlot: interactionRef.decision.missingSlot,
      hardGuardFallback: interactionRef.decision.hardGuardFallback || false
    },
    output: {
      type: finalOutputType,
      products: finalProducts,
      productsLength: Array.isArray(finalProducts) ? finalProducts.length : 0,
      productsReason: interactionRef.decision.action === "flow" && Array.isArray(finalProducts) && finalProducts.length === 0 ? "no_matching_products" : null
    },
    pendingQuestion: sessionContext?.pendingQuestion || null,
    feedback: interactionRef.feedback
  };

  appendInteractionLine(entry);

  // P1 - ENHANCED LOGGING: Log key fields for observability
  logInfo("INTERACTION_COMPLETE", {
    action: interactionRef.decision.action,
    flowId: interactionRef.decision.flowId || null,
    productsLength: Array.isArray(finalProducts) ? finalProducts.length : 0,
    productsReason: entry.output.productsReason,
    pendingQuestion: Boolean(sessionContext?.pendingQuestion),
    hardGuardApplied: interactionRef.decision.hardGuardFallback || false
  });

  return finalResult;
}

function formatSelectionResponse(products = [], slots = {}) {
  const safeProducts = Array.isArray(products)
    ? products.slice(0, MAX_SELECTION_PRODUCTS)
    : [];

  if (safeProducts.length === 0) {
    return "Nu am gasit produse potrivite in lista disponibila.";
  }

  const solutions = safeProducts.filter(product => !isAccessoryProduct(product)).slice(0, 2);
  const accessories = safeProducts.filter(product => isAccessoryProduct(product)).slice(0, 1);
  const stableSolutions = solutions.length > 0 ? solutions : safeProducts.slice(0, 2);

  const lines = ["Iata recomandarile potrivite:", "", "• Soluție:"];

  stableSolutions.forEach((product) => {
    lines.push(`- ${product?.name || "Produs"} ${buildMicroExplanation(product, slots)}`.trim());
  });

  if (accessories.length > 0) {
    lines.push("");
    lines.push("• Accesoriu:");
    accessories.forEach((product) => {
      lines.push(`- ${product?.name || "Produs"} ${buildMicroExplanation(product, slots)}`.trim());
    });
  }

  return lines.join("\n");
}

function buildMinimalFlowReply(flowDefinition, flowResult) {
  const explicitReply = String(flowResult?.reply || "").trim();

  if (explicitReply) {
    return explicitReply;
  }

  const flowTitle = String(flowDefinition?.title || flowDefinition?.flowId || "flow");
  const steps = Array.isArray(flowDefinition?.steps) ? flowDefinition.steps : [];

  if (steps.length === 0) {
    return `Iata un ghid rapid pentru ${flowTitle}.`;
  }

  const lines = [`Iata pasii pentru ${flowTitle}:`];
  steps.forEach((step, index) => {
    const stepTitle = String(step?.title || `Pas ${index + 1}`);
    lines.push(`${index + 1}. ${stepTitle}`);
  });

  return lines.join("\n");
}

function extractObjectOverrides(message) {
  const text = String(message || "").toLowerCase();

  if (text.includes("bancheta din spate") || text.includes("bancheta")) {
    return {
      object: "scaun",
      context: "interior"
    };
  }

  return {
    object: null,
    context: null
  };
}

function extractSlotsFromMessage(message) {
  const text = String(message || "").toLowerCase();
  const objectOverride = extractObjectOverrides(text);
  const interiorContextTerms = ["interior", "interioara", "interioare", "in interior", "inauntru", "din interior"];
  const exteriorContextTerms = ["exterior", "exterioara", "exterioare", "in exterior", "afara", "din afara"];

  const OBJECT_KEYWORDS = {
    cotiera: ["cotiera", "armrest"],
    scaun: ["scaun", "seat", "bancheta", "bancheta din spate"],
    plafon: ["plafon", "headliner", "ceiling"],
    volan: ["volan", "steering wheel"],
    bord: ["bord", "dashboard"],
    oglinda: ["oglinda", "mirror"],
    glass: ["sticla", "geam", "geamuri", "parbriz", "window", "windshield"],
    oglinzi: ["oglinzi", "oglinda", "mirrors", "mirror"],
    mocheta: ["mocheta", "carpet", "floor mat", "floor mats"],
    tapiterie: ["tapiterie", "upholstery"],
    jante: ["jante", "roti", "anvelope"],
    caroserie: ["caroserie", "caroseria", "carrosserie", "body"]
  };

  let object = objectOverride.object || null;
  if (!object) {
    for (const [key, keywords] of Object.entries(OBJECT_KEYWORDS)) {
      if (keywords.some(k => text.includes(k))) {
        object = key;
        break;
      }
    }
  }
  object = canonicalizeObjectValue(object);

  const hasInteriorContext = interiorContextTerms.some(term => text.includes(term));
  const hasExteriorContext = exteriorContextTerms.some(term => text.includes(term));

  let inferredContext = null;
  if (hasInteriorContext && !hasExteriorContext) inferredContext = "interior";
  if (hasExteriorContext && !hasInteriorContext) inferredContext = "exterior";

  if (!inferredContext && object === "glass") {
    if (hasStrongGlassExteriorSignal(text)) {
      inferredContext = "exterior";
    } else if (hasStrongGlassInteriorSignal(text)) {
      inferredContext = "interior";
    }
  }

  const inferredSurface =
    text.includes("piele") ? "leather" :
    text.includes("alcantara") ? "alcantara" :
    text.includes("textil") ? "textile" :
    text.includes("plastic") ? "plastic" :
    (!object && text.includes("jante")) ? "wheels" :
    text.includes("geamuri") || text.includes("geam") ? "glass" :
    text.includes("vopsea") ? "paint" :
    text.includes("sticla") ? "glass" :
    null;

  let resolvedContext =
    objectOverride.context ||
    inferredContext;

  if (!resolvedContext && shouldDefaultLeatherToInterior(text, { surface: inferredSurface })) {
    resolvedContext = "interior";
    logInfo("LEATHER_CONTEXT_DEFAULT", {
      applied: true,
      context: resolvedContext,
      surface: inferredSurface,
      object: object || null,
      message: text
    });
  }

  return {
    context: resolvedContext,
    surface: inferredSurface,

    object
  };
}

function extractSlotsForSafetyQuery(message) {
  const msg = String(message || "").toLowerCase();
  const objectOverride = extractObjectOverrides(msg);

  let context = objectOverride.context || null;
  let object = objectOverride.object || null;
  let surface = null;

  // CONTEXT
  if (msg.includes("interior") || msg.includes("interioara") || msg.includes("interioare") || msg.includes("in interior")) context = "interior";
  if (msg.includes("exterior") || msg.includes("exterioara") || msg.includes("exterioare") || msg.includes("in exterior")) context = "exterior";

  // OBJECT (check these BEFORE surfaces to avoid "jante" being mapped to "wheels" surface)
  if (msg.includes("scaun")) object = "scaun";
  if (msg.includes("cotiera")) object = "cotiera";
  if (msg.includes("parbriz")) object = "glass";
  if (msg.includes("mocheta")) object = "mocheta";
  if (msg.includes("bord")) object = "bord";
  if (msg.includes("volan")) object = "volan";
  if (msg.includes("sticla") || msg.includes("geam") || msg.includes("geamuri")) object = object || "glass";
  if (msg.includes("jante") || msg.includes("roti") || msg.includes("anvelope")) object = object || "jante";
  if (msg.includes("caroserie") || msg.includes("carrosserie")) object = object || "caroserie";
  object = canonicalizeObjectValue(object);

  // SURFACE
  if (msg.includes("piele")) surface = "leather";
  if (msg.includes("alcantara")) surface = "alcantara";
  if (msg.includes("textil")) surface = "textile";
  if (msg.includes("plastic")) surface = "plastic";
  if (msg.includes("vopsea")) surface = "paint";
  if (msg.includes("sticla") || msg.includes("geam") || msg.includes("parbriz")) surface = surface || "glass";

  // AUTO-INFER CONTEXT from object/surface when not explicit
  if (!context) {
    if (object === "scaun" || object === "cotiera" || object === "mocheta" || object === "bord" || object === "volan" ||
        surface === "leather" || surface === "textile" || surface === "alcantara" || surface === "plastic") {
      context = "interior";
    }
    if (object === "jante" || object === "caroserie" || surface === "paint") {
      context = "exterior";
    }
    if (!context && object === "glass") {
      if (hasStrongGlassExteriorSignal(msg)) {
        context = "exterior";
      } else if (hasStrongGlassInteriorSignal(msg)) {
        context = "interior";
      }
    }
  }

  return { context, object, surface };
}

function mergeSlots(sessionSlots, newSlots) {
  return {
    context: newSlots.context || sessionSlots.context || null,
    surface: newSlots.surface || sessionSlots.surface || null,
    object: newSlots.object || sessionSlots.object || null
  };
}

function hasRequiredSelectionSlots(slots) {
  return (
    slots &&
    slots.context &&
    slots.object &&
    slots.surface
  );
}

function shouldForceSurfaceClarification(message, slots) {
  const msg = String(message || "").toLowerCase();

  const mentionsSurface =
    msg.includes("textil") ||
    msg.includes("piele") ||
    msg.includes("plastic");

  return !mentionsSurface && !slots.surface;
}

function shouldAsk(routingDecision, slots, message, sessionContext) {
  const action = routingDecision.action;
  const msg = String(message || "").toLowerCase();

  const hasSurface = !!slots.surface;
  const hasContext = !!slots.context;
  const hasObject = !!slots.object;

  const isAmbiguous =
    msg.includes("ce recomanzi") ||
    msg.includes("ceva bun") ||
    msg.length < 15;

  const mentionsSurface =
    msg.includes("textil") ||
    msg.includes("piele") ||
    msg.includes("plastic");

  if (action === "procedural") {
    const flowCandidate = getProceduralFlowCandidate(
      "product_guidance",
      message,
      slots,
      sessionContext
    );

    if (flowCandidate) {
      if (shouldExecuteFlow(flowCandidate, slots)) {
        return { ask: false };
      }

      const missingFlowSlot = getFlowMissingSlot(flowCandidate, slots);
      const promptSlot = mapFlowMissingSlot(flowCandidate, missingFlowSlot, slots);

      if (promptSlot === "context") {
        return { ask: true, type: "context" };
      }

      if (promptSlot === "surface") {
        return { ask: true, type: "surface" };
      }
    }

    const requiresSurface = hasObject;

    if (requiresSurface && !hasSurface) {
      return { ask: true, type: "surface" };
    }
  }

  if (action === "selection") {
    if (!hasContext && isAmbiguous) {
      return { ask: true, type: "context" };
    }

    if (!hasSurface && !mentionsSurface) {
      return { ask: true, type: "surface" };
    }
  }

  return { ask: false };
}

function applyObjectSlotInference(slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const inference = safeSlots.object ? OBJECT_SLOT_INFERENCE[safeSlots.object] : null;

  if (!inference) {
    return safeSlots;
  }

  return {
    ...safeSlots,
    context: safeSlots.context || inference.context || null,
    surface: safeSlots.surface || inference.surface || null
  };
}

function applyObjectContextInferenceInPlace(slots) {
  if (!slots || typeof slots !== "object") {
    return slots;
  }

  if (!slots.context && slots.object) {
    const inferredContext = OBJECT_CONTEXT_MAP[slots.object] || null;
    if (inferredContext) {
      slots.context = inferredContext;
    }
  }

  return slots;
}

function isPendingQuestionFulfilled(pendingQuestion, slots) {
  if (!pendingQuestion || typeof pendingQuestion !== "object") {
    return false;
  }

  const safeSlots = slots && typeof slots === "object" ? slots : {};

  if (pendingQuestion.type === "confirm_context") {
    return Boolean(safeSlots.context);
  }

  if (pendingQuestion.slot === "context") {
    return Boolean(safeSlots.context);
  }

  if (pendingQuestion.slot === "surface") {
    return Boolean(safeSlots.surface);
  }

  if (pendingQuestion.slot === "object") {
    return Boolean(safeSlots.object || safeSlots.surface);
  }

  return false;
}

function detectProblemIntent(message) {
  const text = String(message || "").toLowerCase();
  const problemKeywords = [
    "murdar",
    "pete",
    "nu reusesc",
    "nu merge",
    "nu pot",
    "am problema",
    "nu iese",
    "am dificultati",
    "cum curat",
    "am nevoie sa curat",
    "problema"
  ];

  return problemKeywords.some(keyword => text.includes(keyword));
}

function getAllowedObjects(slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};

  if (safeSlots.context === "interior") {
    return ["cotiera", "scaun", "plafon", "bord", "volan", "mocheta"];
  }

  if (safeSlots.context === "exterior") {
    return ["oglinda", "geam", "parbriz", "oglinzi"];
  }

  return ["cotiera", "scaun", "plafon", "bord", "oglinda", "geam", "parbriz", "oglinzi", "volan", "mocheta"];
}

function hasRequiredKnowledgeSlots(message, slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};

  if (!safeSlots.context) return false;
  if (safeSlots.context === "interior" && detectProblemIntent(message) && !safeSlots.object) {
    return false;
  }
  if (!safeSlots.surface) return false;

  return true;
}

function isCleaningFlow(message, sessionContext) {
  const safeSessionContext = sessionContext && typeof sessionContext === "object"
    ? sessionContext
    : {};
  const sessionTags = Array.isArray(safeSessionContext.tags) ? safeSessionContext.tags : [];

  return detectProblemIntent(message) || sessionTags.includes("cleaning");
}

function hasPersistedBugIntent(message, sessionContext) {
  const msg = String(message || "").toLowerCase();

  return (
    msg.includes("insect") ||
    msg.includes("insecte") ||
    msg.includes("bugs") ||
    sessionContext?.intentFlags?.bug === true
  );
}

function getFlowResolverMessage(message, sessionContext) {
  const rawMessage = String(message || "");
  const msg = rawMessage.toLowerCase();

  if (!hasPersistedBugIntent(rawMessage, sessionContext)) {
    return rawMessage;
  }

  if (msg.includes("insect") || msg.includes("insecte") || msg.includes("bugs")) {
    return rawMessage;
  }

  return rawMessage;
}

function requiresObjectClarification(message, intent, slots, sessionContext) {
  if (intent !== "product_guidance") {
    return false;
  }

  if (slots.object) {
    return false;
  }

  if (getProceduralFlowCandidate(intent, message, slots, sessionContext)) {
    return false;
  }

  if (!isCleaningFlow(message, sessionContext)) {
    return false;
  }

  return slots.context === "interior" && detectProblemIntent(message);
}

function getMissingSlot(slots) {
  const slotSource = slots && typeof slots === "object" ? slots : {};
  console.log("GET_MISSING_SLOT_INPUT", slotSource);

  const hasContext = slotSource.context !== null && slotSource.context !== undefined && String(slotSource.context).trim() !== "";
  const hasObject = slotSource.object !== null && slotSource.object !== undefined && String(slotSource.object).trim() !== "";
  const hasSurface = slotSource.surface !== null && slotSource.surface !== undefined && String(slotSource.surface).trim() !== "";

  if (!hasContext) return "context";
  if (!hasObject) return "object";
  if (!hasSurface) return "surface";

  return null;
}

function processSlots(message, intent, sessionContext, options = {}) {
  const extracted = extractSlotsFromMessage(message);
  const shouldMerge = options.mergeWithSession === true;
  const baseSlots = shouldMerge ? (sessionContext.slots || {}) : {};
  const slots = normalizeSlots(applyObjectSlotInference(mergeSlots(baseSlots, extracted)));

  const missing = getMissingSlot(slots);

  return {
    slots,
    missing
  };
}

function normalizeSlots(slots) {
  if (!slots) {
    return slots;
  }

  const normalized = { ...slots };
  normalized.object = canonicalizeObjectValue(normalized.object);

  if (normalized.surface === "wheels" && !normalized.object) {
    normalized.object = "wheels";
    normalized.surface = null;
  }

  if (normalized.object === "glass" && !normalized.surface) {
    normalized.surface = "glass";
  }

  return normalized;
}

function getAllowedSurfaces(slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};

  if (safeSlots.object && OBJECT_SURFACE_MAP[safeSlots.object]) {
    return OBJECT_SURFACE_MAP[safeSlots.object];
  }

  if (safeSlots.context === "interior") {
    return ["textile", "leather", "alcantara", "plastic"];
  }

  if (safeSlots.context === "exterior") {
    return ["paint", "wheels", "glass"];
  }

  return ["textile", "leather", "alcantara", "plastic", "paint", "wheels", "glass"];
}

function detectContextHint(message) {
  const text = String(message || "").toLowerCase();

  const interiorObjects = [
    "cotiera", "scaun", "bord", "volan", "tapiterie", "mocheta", "interior", "interioara", "interioare", "in interior"
  ];

  const exteriorObjects = [
    "caroserie", "caroseria", "jante", "roti", "vopsea", "exterior", "exterioara", "exterioare", "in exterior"
  ];

  if (interiorObjects.some(w => text.includes(w))) {
    return "interior";
  }

  if (exteriorObjects.some(w => text.includes(w))) {
    return "exterior";
  }

  return null;
}

function inferWheelsSurfaceFromObject(slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const object = String(safeSlots.object || "").toLowerCase();

  if (!safeSlots.surface && (object === "wheels" || object === "jante")) {
    return {
      ...safeSlots,
      surface: "wheels"
    };
  }

  return safeSlots;
}

/**
 * Generate fallback response when no products found
 */
function generateFallbackResponse(message, settings, availableTags) {
  const fallbackReply = settings?.fallback_message || "Hai sa vedem cum te pot ajuta mai bine. Spune-mi, te intereseaza curatare interior, exterior sau alt tip de produs?";

  return {
    reply: fallbackReply,
    products: []
  };
}

/**
 * Ensure product limit is enforced
 */
function enforceProductLimit(products, maxLimit) {
  if (!Array.isArray(products)) {
    warn(SOURCE, "Products is not an array, returning empty array");
    return [];
  }

  const limit = Math.min(maxLimit || 5, 10); // Hard cap at 10
  if (products.length > limit) {
    info(SOURCE, `Limiting products from ${products.length} to ${limit}`);
    return products.slice(0, limit);
  }

  return products;
}

const MAX_SELECTION_PRODUCTS = 3;
const ACCESSORY_TAGS = ["microfiber", "brush", "drying_towel", "tool", "wash_mitt", "bucket"];
const HARD_FILTER_RULES = {
  "interior|textile": {
    allow: ["textile", "cleaner", "stain_remover", "upholstery_cleaner", "textile_cleaner", "microfiber", "brush"],
    requiredAny: ["stain_remover", "textile_cleaner", "upholstery_cleaner"],
    requiredAllCombos: [["textile", "cleaner"]],
    exclude: [
      "polish", "clay", "wax", "exterior_cleaner", "exterior", "paint", "leather",
      "fragrance", "scent", "odorizant", "air_freshener", "odor", "deodorant", "parfum"
    ]
  },
  "interior|leather": {
    allow: ["leather", "leather_cleaner", "leather_conditioner", "interior_cleaner", "cleaner", "microfiber"],
    requiredAny: ["leather_cleaner", "leather_conditioner"],
    requiredAllCombos: [["leather", "cleaner"]],
    exclude: [
      "textile", "polish", "wax", "paint",
      "fragrance", "scent", "odorizant", "air_freshener", "odor", "deodorant", "parfum"
    ]
  },
  "interior|plastic": {
    allow: ["plastic", "interior_cleaner", "cleaner", "microfiber", "brush"],
    exclude: ["polish", "wax", "paint", "exterior"]
  },
  "exterior|paint": {
    allow: ["paint", "shampoo", "prewash", "bug_remover", "microfiber", "drying_towel", "cleaner"],
    requiredAny: ["shampoo", "prewash", "bug_remover"],
    requiredAllCombos: [["paint", "cleaner"]],
    exclude: ["textile", "leather", "interior"]
  },
  "exterior|glass": {
    allow: ["glass", "glass_cleaner", "microfiber"],
    exclude: ["textile", "leather", "interior", "polish"]
  },
  "exterior|wheels": {
    allow: ["wheels", "wheel_cleaner", "brush", "microfiber"],
    exclude: ["textile", "leather", "interior"]
  }
};

function normalizeProductTags(product) {
  return Array.isArray(product?.tags)
    ? product.tags.map(tag => String(tag || "").toLowerCase()).filter(Boolean)
    : [];
}

function isAccessoryProduct(product) {
  const tags = normalizeProductTags(product);
  return tags.some(tag => ACCESSORY_TAGS.includes(tag));
}

function matchesAnyProductTag(product, tagsToMatch = []) {
  const normalizedTags = normalizeProductTags(product);
  const safeTagsToMatch = Array.isArray(tagsToMatch)
    ? tagsToMatch.map(tag => String(tag || "").toLowerCase()).filter(Boolean)
    : [];

  if (safeTagsToMatch.length === 0) {
    return false;
  }

  return safeTagsToMatch.some(tag => normalizedTags.includes(tag));
}

function matchesAllProductTags(product, tagsToMatch = []) {
  const normalizedTags = normalizeProductTags(product);
  const safeTagsToMatch = Array.isArray(tagsToMatch)
    ? tagsToMatch.map(tag => String(tag || "").toLowerCase()).filter(Boolean)
    : [];

  if (safeTagsToMatch.length === 0) {
    return false;
  }

  return safeTagsToMatch.every(tag => normalizedTags.includes(tag));
}

function isFragranceOrOdorProduct(product) {
  const tags = normalizeProductTags(product);
  const name = String(product?.name || "").toLowerCase();
  const fragranceTags = ["fragrance", "scent", "odorizant", "air_freshener", "odor", "deodorant", "parfum"];
  const fragranceKeywords = [
    "odorizant",
    "parfum",
    "scent",
    "air re-fresher",
    "air refresher",
    "air freshener",
    "new car scent",
    "deodorant"
  ];

  if (tags.some(tag => fragranceTags.includes(tag))) {
    return true;
  }

  return fragranceKeywords.some(keyword => name.includes(keyword));
}

function applyHardFilter(candidates, slots) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const key = `${safeSlots.context || ""}|${safeSlots.surface || ""}`;
  const rule = HARD_FILTER_RULES[key] || null;

  if (!rule) {
    return {
      products: safeCandidates,
      meta: {
        applied: false,
        key,
        allow: [],
        exclude: [],
        beforeCount: safeCandidates.length,
        afterCount: safeCandidates.length
      }
    };
  }

  const allow = Array.isArray(rule.allow) ? rule.allow : [];
  const exclude = Array.isArray(rule.exclude) ? rule.exclude : [];
  const requiredAny = Array.isArray(rule.requiredAny) ? rule.requiredAny : [];
  const requiredAllCombos = Array.isArray(rule.requiredAllCombos)
    ? rule.requiredAllCombos.filter(combo => Array.isArray(combo) && combo.length > 0)
    : [];

  const allowExcludeFiltered = safeCandidates.filter(product => {
    const matchesAllow = allow.length === 0 || matchesAnyProductTag(product, allow);
    const matchesExclude = matchesAnyProductTag(product, exclude);
    return matchesAllow && !matchesExclude;
  });

  const fragranceFiltered = allowExcludeFiltered.filter(product => {
    if ((key === "interior|textile" || key === "interior|leather") && isFragranceOrOdorProduct(product)) {
      logInfo("HARD_FILTER_FRAGRANCE_EXCLUDE", {
        key,
        productName: product?.name || null,
        tags: normalizeProductTags(product)
      });
      return false;
    }
    return true;
  });

  const allowsAccessoryBypass = allow.some(tag => ACCESSORY_TAGS.includes(String(tag || "").toLowerCase()));
  const hasRequiredConstraint = requiredAny.length > 0 || requiredAllCombos.length > 0;

  const requiredFiltered = hasRequiredConstraint
    ? fragranceFiltered.filter(product => {
        const matchesRequiredAny = requiredAny.length > 0 && matchesAnyProductTag(product, requiredAny);
        const matchesRequiredAllCombo = requiredAllCombos.length > 0 && requiredAllCombos.some(combo => matchesAllProductTags(product, combo));
        const matchesAccessoryGate = allowsAccessoryBypass && isAccessoryProduct(product);
        return matchesRequiredAny || matchesRequiredAllCombo || matchesAccessoryGate;
      })
    : fragranceFiltered;

  const filtered = requiredFiltered;

  return {
    products: filtered,
    meta: {
      applied: true,
      key,
      allow,
      requiredAny,
      requiredAllCombos,
      allowsAccessoryBypass,
      exclude,
      beforeCount: safeCandidates.length,
      afterAllowExcludeCount: allowExcludeFiltered.length,
      afterRequiredCount: requiredFiltered.length,
      afterCount: filtered.length
    }
  };
}

function isGenericProduct(product) {
  const tags = normalizeProductTags(product);
  const description = String(product?.short_description || product?.description || "").trim();
  const name = String(product?.name || "").trim().toLowerCase();

  if (isAccessoryProduct(product) && tags.length >= 1) {
    return false;
  }

  if (tags.length < 2) {
    return true;
  }

  if (!description || description.length < 25) {
    return true;
  }

  if (/^(fara descriere(?: scurta disponibila)?|descriere scurta disponibila|produs universal)$/i.test(description)) {
    return true;
  }

  if ((name === "produs" || name === "solutie") && tags.length < 3) {
    return true;
  }

  return false;
}

function buildMicroExplanation(product, slots = {}) {
  const tags = normalizeProductTags(product);
  const description = String(product?.short_description || product?.description || "").trim();

  if (tags.includes("stain_remover")) return "→ pentru pete dificile pe textile, fara sa afecteze materialul";
  if (tags.includes("textile_cleaner") || tags.includes("upholstery_cleaner") || (tags.includes("textile") && tags.includes("cleaner"))) {
    return "→ pentru curatare sigura a textilelor din interior";
  }
  if (tags.includes("leather_cleaner") || (tags.includes("leather") && tags.includes("cleaner"))) {
    return "→ pentru curatare eficienta a pielii, fara sa o usuce";
  }
  if (tags.includes("leather_conditioner") || (tags.includes("leather") && tags.includes("protection"))) {
    return "→ pentru hidratare si protectie dupa curatare";
  }
  if (tags.includes("brush")) return "→ ajuta la desprinderea murdariei din fibre";
  if (tags.includes("microfiber")) return "→ pentru stergere fara scame si fara zgarieturi";
  if (tags.includes("shampoo")) return "→ pentru spalare sigura a vopselei la exterior";
  if (tags.includes("prewash") || tags.includes("snow_foam")) return "→ pentru a inmuia murdaria inainte de contact";
  if (tags.includes("bug_remover")) return "→ pentru indepartarea insectelor fara frecare agresiva";
  if (tags.includes("drying_towel")) return "→ pentru uscare rapida, fara urme";

  if (slots?.surface === "textile" && tags.includes("textile")) {
    return "→ pentru curatare sigura a textilelor din interior";
  }

  if (slots?.surface === "leather" && tags.includes("leather")) {
    return "→ pentru curatare eficienta a pielii, fara sa o usuce";
  }

  if (slots?.surface === "paint" && tags.includes("paint")) {
    return "→ pentru spalare sigura a vopselei la exterior";
  }

  if (description && description.length > 35) {
    const fragment = description.split(/[.!?]/)[0].trim();
    if (fragment && fragment.length > 20) {
      return `→ ${fragment.slice(0, 110)}`;
    }
  }

  return "";
}

function returnSelectionFailSafe(interactionRef, sessionId, selectionDecision, selectionSlots = null) {
  const reply = "Nu sunt sigur ce produs se potrivește perfect aici, dar te pot ghida pas cu pas dacă vrei.";
  const failSafeDecision = {
    ...(selectionDecision || {}),
    action: "knowledge",
    flowId: null,
    missingSlot: null
  };
  interactionRef.slots = selectionSlots || interactionRef.slots || null;
  updateSessionWithProducts(sessionId, [], "guidance");
  emit("ai_response", { response: reply });
  logResponseSummary("knowledge", { products: 0 });
  return endInteraction(interactionRef, { reply, products: [] }, {
    decision: failSafeDecision,
    outputType: "reply",
    products: []
  });
}

function filterProducts(products, slots) {
  if (!products || !Array.isArray(products)) return [];

  const safeSlots = slots && typeof slots === "object" ? slots : {};

  return products.filter(product => {
    const tags = normalizeProductTags(product);
    const isAccessory = isAccessoryProduct(product);

    // CONTEXT FILTER
    if (safeSlots.context === "interior" && tags.includes("exterior")) return false;
    if (safeSlots.context === "exterior" && tags.includes("interior")) return false;

    if (isAccessory) {
      return true;
    }

    // SURFACE FILTER (STRICT)
    if (
      safeSlots.surface === "textile" &&
      !(
        (tags.includes("textile") && tags.includes("cleaner")) ||
        tags.includes("textile_cleaner") ||
        tags.includes("upholstery_cleaner") ||
        tags.includes("stain_remover")
      )
    ) return false;
    if (
      safeSlots.surface === "leather" &&
      !(
        (tags.includes("leather") && tags.includes("cleaner")) ||
        tags.includes("leather") ||
        tags.includes("leather_cleaner") ||
        tags.includes("leather_conditioner")
      )
    ) return false;
    if (
      safeSlots.surface === "paint" &&
      !(
        (tags.includes("paint") && tags.includes("cleaner")) ||
        tags.includes("paint") ||
        tags.includes("shampoo") ||
        tags.includes("prewash") ||
        tags.includes("bug_remover")
      )
    ) return false;
    if (safeSlots.surface === "glass" && !tags.includes("glass")) return false;
    if (safeSlots.surface === "wheels" && !tags.includes("wheels")) return false;

    return true;
  });
}

function buildProductBundle(products, options = {}) {
  const safeProducts = Array.isArray(products) ? products : [];
  const hardFilterKey = options && typeof options === "object"
    ? options.hardFilterKey || null
    : null;

  const getBundleRoles = (product) => {
    const tags = normalizeProductTags(product);
    if (hardFilterKey === "interior|textile") {
      return tags.filter(tag => tag !== "cleaner");
    }
    return tags;
  };

  const seen = new Set();
  const unique = safeProducts.filter(product => {
    const key = String(product?.id || product?.name || "");
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const solutions = unique.filter(product => {
    const roles = getBundleRoles(product);
    const isAccessory = roles.some(tag => ACCESSORY_TAGS.includes(tag));
    return !isAccessory;
  }).slice(0, 2);
  const accessories = unique.filter(product => {
    const roles = getBundleRoles(product);
    return roles.some(tag => ACCESSORY_TAGS.includes(tag));
  }).slice(0, 1);
  const bundle = [...solutions, ...accessories];

  if (bundle.length === 0) {
    return unique.slice(0, MAX_SELECTION_PRODUCTS);
  }

  return bundle.slice(0, MAX_SELECTION_PRODUCTS);
}

/**
 * Step 1: Retrieve client settings
 */
function getClientSettings(clientId) {
  try {
    debug(SOURCE, `Fetching settings for client: ${clientId}`);
    const settings = getSettings(clientId);
    return settings;
  } catch (err) {
    error(SOURCE, "Failed to load client settings", { clientId, error: err.message });
    // Return default settings as fallback
    return config.defaultSettings;
  }
}

/**
 * Step 3: Decide next action based on context
 */
function makeDecision(intent, sessionId) {
  try {
    const sessionContext = getSessionContext(sessionId);
    const activeProducts = sessionContext.activeProducts || [];
    const context = {
      intent: intent.type,
      activeProducts,
      session: sessionContext
    };

    const decision = decideNextAction(context);
    info(SOURCE, `Decision made: ${decision.action} (intent: ${intent.type}, activeProducts: ${activeProducts.length})`);
    return decision;
  } catch (err) {
    error(SOURCE, "Decision making failed", { error: err.message });
    return { action: "clarification" }; // Safe fallback
  }
}

function enrichTagsFromMessage(message, detectedTags) {
  const text = String(message || "").toLowerCase();
  const enriched = new Set(detectedTags);

  // --- LOCATION ---
  if (text.includes("interior")) {
    enriched.add("interior");
  }

  if (text.includes("exterior")) {
    enriched.add("exterior");
  }

  // --- SURFACE ---
  // IMPORTANT:
  // Do NOT infer surface types from object names (e.g. cotiera, scaun)
  // Only add surface tags if explicitly mentioned in the message
  if (text.includes("plastic")) enriched.add("plastic");
  if (text.includes("piele")) enriched.add("leather");
  if (text.includes("textil") || text.includes("textile")) enriched.add("textile");
  if (text.includes("sticla") || text.includes("geam")) enriched.add("glass");
  if (text.includes("vopsea")) enriched.add("paint");
  if (text.includes("cauciuc")) enriched.add("rubber");
  if (text.includes("apc") || text.includes("all purpose cleaner") || text.includes("allclean")) enriched.add("apc");

  // --- PURPOSE ---
  if (
    text.includes("curat") ||
    text.includes("spal") ||
    text.includes("murdar")
  ) {
    enriched.add("cleaning");
  }

  if (text.includes("protejez")) enriched.add("protection");
  if (text.includes("lustruiesc")) enriched.add("polish");

  return Array.from(enriched);
}

function filterContextTags(message, tags) {
  const text = String(message || "").toLowerCase();

  const INTERIOR_KEYWORDS = ["interior", "inauntru", "habitaclu"];
  const EXTERIOR_KEYWORDS = ["exterior", "afara", "caroserie"];

  const INTERIOR_OBJECTS = ["cotiera", "scaun", "bord", "volan", "tapiterie"];
  const EXTERIOR_OBJECTS = ["caroserie", "jante", "roti", "vopsea"];

  const mentionsInterior = INTERIOR_KEYWORDS.some(k => text.includes(k));
  const mentionsExterior = EXTERIOR_KEYWORDS.some(k => text.includes(k));

  const mentionsInteriorObject = INTERIOR_OBJECTS.some(k => text.includes(k));
  const mentionsExteriorObject = EXTERIOR_OBJECTS.some(k => text.includes(k));

  let filteredTags = Array.isArray(tags) ? [...tags] : [];

  if (!mentionsInterior && !mentionsInteriorObject) {
    filteredTags = filteredTags.filter(tag => tag !== "interior");
  }

  if (!mentionsExterior && !mentionsExteriorObject) {
    filteredTags = filteredTags.filter(tag => tag !== "exterior");
  }

  return filteredTags;
}

function buildFinalTags(coreTags, workingTags, slots = {}) {
  const slotTagKeys = new Set(["interior", "exterior", "leather", "textile", "alcantara", "plastic", "paint", "glass", "wheels"]);
  const slotTags = [
    slots.context,
    slots.surface
  ].filter(Boolean);
  const enrichedTags = (Array.isArray(workingTags) ? workingTags : []).filter(tag => !slotTagKeys.has(tag));
  const safeEnrichedTags = enrichedTags.filter(tag => {
    if (!SURFACE_TAGS.includes(tag)) return true;
    return Array.isArray(coreTags) && coreTags.includes(tag);
  });

  return [...new Set([
    ...(Array.isArray(coreTags) ? coreTags : []),
    ...slotTags,
    ...safeEnrichedTags
  ].filter(Boolean))];
}

function findProductsByRoleConfig(roleConfig, products) {
  const safeRoleConfig = roleConfig && typeof roleConfig === "object" ? roleConfig : {};
  const matchTags = Array.isArray(safeRoleConfig.matchTags)
    ? safeRoleConfig.matchTags.map(tag => String(tag).toLowerCase())
    : [];
  const matchText = Array.isArray(safeRoleConfig.matchText)
    ? safeRoleConfig.matchText.map(text => String(text).toLowerCase())
    : [];
  const safeProducts = Array.isArray(products) ? products : [];

  const strongMatches = safeProducts.filter((product) => {
    const productName = String(product?.name || "").toLowerCase();
    const productCategory = String(product?.category || "").toLowerCase();
    const searchText = String(product?.searchText || "").toLowerCase();
    const words = searchText.split(/\s+/).filter(Boolean);

    return matchText.some((text) => {
      const isStrongMatch =
        productName.includes(text) ||
        productCategory.includes(text) ||
        words.includes(text);

      return isStrongMatch;
    });
  });

  if (strongMatches.length > 0) {
    return strongMatches;
  }

  const weakMatches = safeProducts.filter((product) => {
    const productTags = Array.isArray(product?.tags)
      ? product.tags.map(tag => String(tag).toLowerCase())
      : [];

    return matchTags.some(tag => productTags.includes(tag));
  });

  return weakMatches;
}

function matchesRoleConfig(product, roleConfig) {
  const matches = findProductsByRoleConfig(roleConfig, [product]);
  return matches.length > 0;
}

function findProductByRole(role, products) {
  const roleConfig =
    role === "microfiber"
      ? { matchTags: ["drying_towel"], matchText: ["microfibra", "laveta"] }
      : productRoles[role] || null;

  if (!roleConfig) {
    return null;
  }

  const matches = findProductsByRoleConfig(roleConfig, products);
  return matches[0] || null;
}

function enrichProducts(products, catalog = []) {
  if (!Array.isArray(products) || products.length === 0) return products;

  const cleanerRoleConfigs = [
    productRoles.interior_cleaner,
    productRoles.contact_cleaner,
    productRoles.prewash_cleaner,
    productRoles.glass_cleaner,
    productRoles.wheel_cleaner
  ].filter(Boolean);
  const toolRoleConfigs = [
    productRoles.interior_tool,
    productRoles.wash_tool,
    productRoles.drying_tool
  ].filter(Boolean);

  const hasCleaner = products.some(product => cleanerRoleConfigs.some(roleConfig => matchesRoleConfig(product, roleConfig)));
  const hasTool = products.some(product => toolRoleConfigs.some(roleConfig => matchesRoleConfig(product, roleConfig)));
  const enriched = [...products];

  if (hasCleaner && !hasTool) {
    const microfiber = findProductByRole("microfiber", catalog);
    const microfiberId = microfiber?.id != null ? String(microfiber.id) : null;
    const alreadyIncluded = enriched.some(product => {
      const productId = product?.id != null ? String(product.id) : null;
      return microfiberId != null && productId === microfiberId;
    });

    if (microfiber && !alreadyIncluded) {
      enriched.push(microfiber);
    }
  }

  return enriched;
}

function getFlowDisambiguationQuestion(candidateFlows, slots) {
  const safeFlows = Array.isArray(candidateFlows) ? candidateFlows : [];
  const safeSlots = slots && typeof slots === "object" ? slots : {};

  const contextOptions = [...new Set(
    safeFlows.flatMap((flow) => Array.isArray(flow?.triggers?.contexts) ? flow.triggers.contexts : [])
  )].filter(Boolean);

  if (!safeSlots.context && contextOptions.length > 1) {
    return {
      state: "NEEDS_CONTEXT",
      message: "Vrei să cureți interiorul sau exteriorul mașinii?"
    };
  }

  const surfaceOptions = [...new Set(
    safeFlows.flatMap((flow) => Array.isArray(flow?.triggers?.surfaces) ? flow.triggers.surfaces : [])
  )].filter(Boolean);

  if (!safeSlots.surface && surfaceOptions.length > 1) {
    const labelMap = {
      textile: "textil",
      leather: "piele",
      alcantara: "alcantara",
      plastic: "plastic",
      paint: "vopsea",
      wheels: "jante",
      glass: "geamuri"
    };
    const options = surfaceOptions.map(surface => labelMap[surface] || surface).join(", ");

    return {
      state: "NEEDS_SURFACE",
      message: `Pe ce suprafata vrei să lucrezi? (${options})`
    };
  }

  return null;
}

function applyDeterministicTagFallback(message, detectedTags) {
  const text = String(message || "").toLowerCase();
  const normalizedTags = Array.isArray(detectedTags)
    ? detectedTags
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean)
    : [];

  const tags = new Set(normalizedTags);
  let fallbackUsed = !Array.isArray(detectedTags) || normalizedTags.length === 0;

  if (!Array.isArray(detectedTags) || normalizedTags.length === 0) {
    if (text.includes("parbriz")) {
      tags.add("glass");
      tags.add("exterior");
      fallbackUsed = true;
    }

    if (text.includes("jante")) {
      tags.add("wheels");
      tags.add("exterior");
      fallbackUsed = true;
    }

    if (text.includes("interior")) {
      tags.add("interior");
      fallbackUsed = true;
    }
  }

  if (tags.size === 0) {
    tags.add("cleaning");
    fallbackUsed = true;
  }

  const finalTags = Array.from(tags);
  if (fallbackUsed) {
    console.log("TAG_FALLBACK_USED", finalTags);
  }

  return finalTags;
}

function ensureMinimumTags(tags) {
  const normalized = Array.isArray(tags)
    ? tags
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean)
    : [];

  return normalized.length > 0 ? [...new Set(normalized)] : ["cleaning"];
}

/**
 * Step 4: Detect intent (tags) from user message
 * Uses hybrid approach: rules first, AI fallback
 */
async function detectUserIntent(message, settings, availableProductTags) {
  try {
    info(SOURCE, `Detecting intent for message: "${message}"`);

    const tags = await detectTags(
      message,
      settings.tag_rules,
      availableProductTags
    );

    const safeTags = applyDeterministicTagFallback(message, tags);
    info(SOURCE, `Tags detected: ${safeTags.join(", ")}`);
    return safeTags;
  } catch (err) {
    error(SOURCE, "Intent detection failed", { error: err.message });
    const safeTags = applyDeterministicTagFallback(message, null);
    return safeTags;
  }
}

/**
 * Step 3: Search for relevant products based on detected tags
 */
function findRelevantProducts(tags, products, maxProducts, options = {}) {
  try {
    if (tags.length === 0) {
      info(SOURCE, "No tags to search with, skipping search");
      return [];
    }

    const { strictTagFilter = false } = options;

    if (strictTagFilter) {
      const requestedTags = Array.isArray(tags)
        ? tags.map(tag => String(tag).toLowerCase())
        : [];
      const safeProducts = Array.isArray(products) ? products : [];
      const filtered = safeProducts.filter((product) => {
        const productTags = Array.isArray(product?.tags)
          ? product.tags.map(tag => String(tag).toLowerCase())
          : [];

        return requestedTags.some(tag => productTags.includes(tag));
      });

      return filtered;
    }

    info(SOURCE, `Searching for products with tags: ${tags.join(", ")}`);

    const found = searchProductsByTags(tags, products, maxProducts);
    const withForcedApc = ensureApcProductIncluded(found, products, tags);

    if (withForcedApc.length === 0) {
      warn(SOURCE, "No products matched the detected tags");
      const safeProducts = Array.isArray(products) ? products : [];
      debug(SOURCE, `Available products: ${safeProducts.map(p => p.name).join(", ")}`);
      return [];
    }

    info(SOURCE, `Found ${withForcedApc.length} product(s):`, {
      products: withForcedApc.map(p => ({ name: p.name, score: p.score, price: p.price }))
    });

    return withForcedApc;
  } catch (err) {
    error(SOURCE, "Product search failed", { error: err.message });
    return [];
  }
}

/**
 * Step 4: Apply ranking to maximize conversion
 */
function applyRanking(products, context, settings) {
  try {
    if (!Array.isArray(products) || products.length === 0) {
      return [];
    }

    info(SOURCE, `Ranking ${products.length} products for conversion optimization`);
    const ranked = rankProducts(products, context, settings);
    const safeRanked = Array.isArray(ranked) ? ranked : products;

    debug(SOURCE, `Ranking complete:`, {
      topProduct: safeRanked[0]?.name,
      scores: safeRanked.slice(0, 3).map(p => ({ name: p.name, score: p.score }))
    });

    return safeRanked;
  } catch (err) {
    error(SOURCE, "Product ranking failed", { error: err.message });
    return products; // Return original products as fallback
  }
}

/**
 * Step 5: Apply fallback if no products found
 */
function applyFallbackProducts(products) {
  const safeProducts = products || [];

  return safeProducts.length > 0
    ? safeProducts.slice(0, 3)
    : [];
}

/**
 * Step 6: Choose response strategy
 */
function determineStrategy(intent, context, settings, sessionId) {
  try {
    // Get session context for continuity
    const sessionContext = getSessionContext(sessionId);
    const activeProducts = sessionContext.activeProducts || [];
    const enhancedContext = {
      ...context,
      seenProducts: activeProducts,
      lastResponseType: sessionContext.lastResponseType
    };

    const strategy = chooseStrategy(intent.type, enhancedContext, settings);
    info(SOURCE, `Selected strategy: ${strategy} (session continuity considered)`);
    return strategy;
  } catch (err) {
    error(SOURCE, "Strategy selection failed", { error: err.message });
    return "direct"; // Safe fallback
  }
}

function resolveStrategy(decision, context, settings, sessionId) {
  if (decision.state === "NEEDS_CONTEXT" || decision.state === "NEEDS_SURFACE") {
    return "guidance";
  }

  if (decision.isSafety) {
    return "guidance";
  }

  return determineStrategy(
    { type: decision.intent },
    context,
    settings,
    sessionId
  );
}

/**
 * Step 7: Build optimized prompt with found products
 */
function createOptimizedPrompt(message, products, settings, detectedTags, strategy, language = "en", guidanceType = "general", knowledgeContext = "", slots = {}, queryType = null) {
  try {
    debug(SOURCE, `Building prompt with ${products.length} product(s)`, {
      products: products.map(p => p.name),
      tags: detectedTags,
      strategy,
      language
    });

    const prompt = buildPrompt({
      products,
      settings,
      userMessage: message,
      detectedTags,
      context: {
        tags: detectedTags,
        slots,
        queryType,
        object: slots?.object || null
      },
      strategy,
      language,
      guidanceType,
      knowledgeContext,
      object: slots?.object || null
    });

    debug(SOURCE, `Prompt built (length: ${prompt.length} chars)`);
    return prompt;
  } catch (err) {
    error(SOURCE, "Prompt building failed", { error: err.message });
    // Return a minimal fallback prompt
    return `You MUST respond ONLY in Romanian. Do not use English.\n\nUtilizator: ${message}\n\nOfera un raspuns util despre produse de auto detailing.`;
  }
}

/**
 * Step 9: Track impressions for analytics
 */
function trackProductImpressions(products, sessionId) {
  try {
    if (Array.isArray(products) && products.length > 0) {
      trackImpressions(products, sessionId);
      debug(SOURCE, `Tracked impressions for ${products.length} products`);
    }
  } catch (err) {
    error(SOURCE, "Impression tracking failed", { error: err.message });
    // Don't fail the main flow for tracking issues
  }
}

/**
 * Check if user is asking a follow-up question
 * Follow-up keywords: cum (how), plan (plan), folosesc (use)
 */
function isFollowUpQuestion(message) {
  const followUpKeywords = ["cum", "plan", "folosesc"];
  const lowerMessage = message.toLowerCase();
  return followUpKeywords.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Check if follow-up message is short enough to route directly to guidance
 */
function isShortFollowUpMessage(message) {
  const words = message
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0);

  return words.length > 0 && words.length <= 6 && isFollowUpQuestion(message);
}

function isFollowUpMessage(message) {
  const msg = String(message || "").toLowerCase().trim();

  return (
    msg.length < 25 ||
    msg === "da" ||
    msg === "nu" ||
    msg.includes("mai") ||
    msg.includes("si") ||
    msg.includes("alt") ||
    msg.includes("asta") ||
    msg.includes("corect")
  );
}

function isHardReset(message) {
  const msg = String(message || "").toLowerCase();

  return (
    msg.includes("cum curat") ||
    msg.includes("vreau sa") ||
    msg.includes("cum spal") ||
    msg.includes("cum fac") ||
    msg.includes("exterior") ||
    msg.includes("interior masina")
  );
}

function isNewRootQuery(message) {
  const msg = String(message || "").toLowerCase();

  return (
    msg.includes("cum spal masina") ||
    msg.includes("cum curat masina") ||
    msg.includes("cum spal") ||
    msg.includes("cum curat") ||
    msg.includes("vreau sa spal") ||
    msg.includes("vreau sa curat")
  );
}

function isShortSlotValueMessage(message) {
  const msg = String(message || "").toLowerCase().trim();
  if (!msg) return false;

  const words = msg.split(/\s+/).filter(Boolean);
  if (words.length > 2) return false;

  const slotValues = new Set([
    "interior", "exterior",
    "textil", "textile", "piele", "plastic", "alcantara", "vopsea",
    "geam", "geamuri", "parbriz", "sticla",
    "mocheta", "cotiera", "scaun", "plafon",
    "jante", "roti", "anvelope"
  ]);

  return words.every(word => slotValues.has(word));
}

function isDirectPendingClarificationAnswer(message, pendingQuestion) {
  const msg = String(message || "").toLowerCase().trim();
  const pending = pendingQuestion && typeof pendingQuestion === "object"
    ? pendingQuestion
    : null;

  if (!pending) {
    return false;
  }

  if (pending.type === "confirm_context") {
    return isYes(msg) || isNo(msg);
  }

  if (pending.slot === "context") {
    return msg.includes("interior") || msg.includes("exterior");
  }

  if (pending.slot === "surface") {
    return ["textil", "textile", "piele", "plastic", "alcantara", "vopsea", "geam", "glass"]
      .some(token => msg.includes(token));
  }

  if (pending.slot === "object") {
    return ["mocheta", "cotiera", "scaun", "plafon", "parbriz", "jante", "roti", "anvelope", "geam", "sticla", "vopsea"]
      .some(token => msg.includes(token));
  }

  return false;
}

function shouldHardResetForNewRootQuery(message, sessionContext) {
  if (!isNewRootQuery(message)) {
    return false;
  }

  if (isShortSlotValueMessage(message)) {
    return false;
  }

  if (isDirectPendingClarificationAnswer(message, sessionContext?.pendingQuestion)) {
    return false;
  }

  return true;
}

function detectObject(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("masina")) return "masina";
  if (msg.includes("cotiera")) return "cotiera";
  if (msg.includes("scaun")) return "scaun";

  return null;
}

function isCorrection(message) {
  const msg = String(message || "").toLowerCase();

  return (
    msg.includes("nu") &&
    (
      msg.includes("interior") ||
      msg.includes("exterior") ||
      msg.includes("textil") ||
      msg.includes("piele")
    )
  );
}

function isLikelySlotFill(message) {
  const msg = String(message || "").toLowerCase().trim();

  if (msg.length < 20) {
    return true;
  }

  if (
    msg.includes("interior") ||
    msg.includes("exterior") ||
    msg.includes("textil") ||
    msg.includes("piele") ||
    msg.includes("plastic") ||
    msg.includes("vopsea")
  ) {
    return true;
  }

  return false;
}

function isProceduralQuery(message, intent) {
  if (intent !== "product_guidance") {
    return false;
  }

  const text = String(message || "").toLowerCase();
  const proceduralSignals = ["cum", "cum spal", "cum curat", "pasii"];
  return proceduralSignals.some(signal => text.includes(signal));
}

function isExplicitProductRequest(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("ce folosesc");
}

function isYes(message) {
  const text = String(message || "").toLowerCase().trim();
  return ["da", "yes", "ok", "corect"].includes(text);
}

function isNo(message) {
  const text = String(message || "").toLowerCase().trim();
  return ["nu", "no"].includes(text);
}

function isNewSearch(message) {
  const keywords = [
    "caut",
    "vreau",
    "recomanda",
    "produse",
    "solutii"
  ];

  const msg = message.toLowerCase();

  return keywords.some(k => msg.includes(k));
}

function shouldAskMaterialQuestion(tags, message) {
  const lowerMessage = String(message || "").toLowerCase();
  const normalizedTags = Array.isArray(tags)
    ? tags.map(tag => String(tag).toLowerCase())
    : [];

  const materialKeywords = ["piele", "textil", "alcantara"];
  const hasMaterialInMessage = materialKeywords.some(keyword => lowerMessage.includes(keyword));
  const hasMaterialInTags = normalizedTags.some(tag => ["leather", "textile", "alcantara"].includes(tag));

  if (hasMaterialInMessage || hasMaterialInTags) {
    return false;
  }

  const questionTriggerKeywords = [
    "suprafata",
    "tapiterie",
    "scaun",
    "cotiera",
    "interior",
    "curata",
    "detergent",
    "protect"
  ];

  return questionTriggerKeywords.some(keyword => lowerMessage.includes(keyword));
}

function isMaterialAnswer(message) {
  const msg = message.toLowerCase().trim();

  return [
    "piele",
    "textil",
    "alcantara",
    "plastic",
    "sticla"
  ].includes(msg);
}

const RO_WORDS = [
  "salut", "buna", "bună", "cum", "cat", "unde", "cand",
  "curat", "curata", "spal", "masina", "cotiera", "bord",
  "murdar", "solutie"
];

function detectLanguage(message) {
  if (!message) return "en";

  const text = String(message).toLowerCase();

  // Romanian keyword override — checked before any other logic
  if (RO_WORDS.some(word => text.includes(word))) {
    return "ro";
  }

  const romanianIndicators = [
    "ce", "cum", "cand", "unde", "cat", "cat timp",
    "pentru", "este", "sunt", "vreau", "am", "imi",
    "ma", "la", "si", "sau", "din"
  ];

  const hasRomanian = romanianIndicators.some((word) => {
    if (word.includes(" ")) {
      return text.includes(word);
    }

    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\W)${escapedWord}(\\W|$)`, "i").test(text);
  });

  return hasRomanian ? "ro" : "en";
}

const KNOWLEDGE_MIN_SCORE = 2;
const OBJECT_TAGS = ["cotiera", "scaun", "volan", "bord", "tapiterie"];

const TAG_MAP = {
  // Romanian surface → English
  "piele": "leather",
  "textil": "textile",
  "textile": "textile",
  "plastic": "plastic",
  "sticla": "glass",
  "vopsea": "paint",
  "metal": "metal",
  "cauciuc": "rubber",
  // Romanian purpose → English
  "curatare": "cleaning",
  "curata": "cleaning",
  "spalare": "cleaning",
  "protectie": "protection",
  "polish": "polish",
  "lustruire": "polish",
  // Location (already English but kept for completeness)
  "interior": "interior",
  "exterior": "exterior"
};

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const result = [];
  for (const tag of tags) {
    const lower = String(tag || "").toLowerCase().trim();
    const mapped = TAG_MAP[lower] || lower;
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      result.push(mapped);
    }
  }
  return result;
}

function getTagWeight(tag) {
  if (OBJECT_TAGS.includes(tag)) return 3;
  if (["textile", "leather", "plastic", "paint", "glass"].includes(tag)) return 2;
  if (["interior", "exterior"].includes(tag)) return 1;
  return 1;
}

function filterKnowledgeByTags(knowledgeList, detectedTags) {
  if (!Array.isArray(detectedTags) || detectedTags.length === 0) {
    return knowledgeList;
  }
  return knowledgeList.filter(item => {
    const normalizedItemTags = normalizeTags(item.tags);
    return normalizedItemTags.some(tag => detectedTags.includes(tag));
  });
}

function getRelevantKnowledge(message, knowledgeList, detectedTags = [], slots = {}) {
  const normalizedDetectedTags = normalizeTags(detectedTags);
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  debug(SOURCE, `DETECTED TAGS: ${normalizedDetectedTags.join(", ")}`);

  const filtered = filterKnowledgeByTags(knowledgeList, normalizedDetectedTags);
  debug(SOURCE, `KNOWLEDGE AFTER TAG FILTER: ${filtered.length}`);

  const scored = filtered
    .map(k => {
      const normalizedItemTags = normalizeTags(k.tags);
      const matchedTags = normalizedItemTags.filter(tag => normalizedDetectedTags.includes(tag));
      const knowledgeText = [k.title, k.searchText, k.content, ...(Array.isArray(k.tags) ? k.tags : [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      let score = matchedTags.reduce((acc, tag) => acc + getTagWeight(tag), 0);

      for (const tag of matchedTags) {
        if (OBJECT_TAGS.includes(tag) && normalizedDetectedTags.includes(tag)) {
          score += 2;
        }
      }

      const hasObjectOrSurfaceMatch = matchedTags.some(tag => OBJECT_TAGS.includes(tag) || SURFACE_TAGS.includes(tag));
      const isGenericOnly = matchedTags.length > 0 && matchedTags.every(tag => ["cleaning", "interior"].includes(tag));
      if (isGenericOnly && !hasObjectOrSurfaceMatch) {
        score -= 1;
      }

      if (safeSlots.surface === "textile") {
        const hasTextile = normalizedItemTags.includes("textile") || knowledgeText.includes("textil") || knowledgeText.includes("textile");
        const hasCleaning = normalizedItemTags.includes("cleaning") || normalizedItemTags.includes("curatare") || knowledgeText.includes("curatare") || knowledgeText.includes("cureti");
        if (hasTextile && hasCleaning) {
          score += 3;
        }
      }

      if (safeSlots.object) {
        const objectTerms = OBJECT_MATCH_TERMS[safeSlots.object] || [safeSlots.object];
        if (objectTerms.some(term => knowledgeText.includes(term))) {
          score += 2;
        }
      }

      const isGenericExplainer = knowledgeText.includes("ce este") || knowledgeText.includes("cum se foloseste") || knowledgeText.includes("cum se foloseste");
      const hasSpecificSlotContext = Boolean(safeSlots.object || safeSlots.surface);
      const hasSpecificProceduralSignal = knowledgeText.includes("cum cureti") || knowledgeText.includes("curatare") || knowledgeText.includes("pas ");
      if (hasSpecificSlotContext && isGenericExplainer && !hasSpecificProceduralSignal) {
        score -= 2;
      }

      return { ...k, score, matchedTags };
    })
    .filter(k => k.score >= KNOWLEDGE_MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  const best = scored[0] || null;
  debug(SOURCE, `BEST KNOWLEDGE MATCH: ${best?.title} (score: ${best?.score})`);

  return scored.slice(0, 2);
}

function detectGuidanceType(message) {
  if (!message || typeof message !== "string") {
    warn(SOURCE, `Invalid message in detectGuidanceType`);
    return "general";
  }

  const text = message.toLowerCase();

  if (text.includes("cat timp") || text.includes("cat de des")) {
    return "frequency";
  }

  if (text.includes("cum sa") || text.includes("cum folosesc")) {
    return "how_to";
  }

  if (text.includes("diferenta") || text.includes("vs")) {
    return "comparison";
  }

  return "general";
}

function isInformationalQuestion(message) {
  const text = message.toLowerCase();

  const keywords = [
    "diferenta",
    "cum",
    "ce este",
    "cand",
    "de ce",
    "la cat timp"
  ];

  return keywords.some(k => text.includes(k));
}

function isSafetyQuestion(message) {
  const text = String(message || "").toLowerCase();
  const keywords = ["pot folosi", "pot sa", "este sigur", "e sigur", "merge pe", "compatibil", "ok pentru", "functioneaza pe"];
  return keywords.some(k => text.includes(k));
}

function hasEnoughInfo(tags) {
  const hasCleaning = tags.includes("cleaning");
  const hasInterior = tags.includes("interior");

  const hasMaterial =
    tags.includes("leather") ||
    tags.includes("textile") ||
    tags.includes("alcantara") ||
    tags.includes("plastic") ||
    tags.includes("glass");

  return hasCleaning && hasInterior && hasMaterial;
}

function detectMetaIntent(message) {
  const msg = String(message || "").toLowerCase();

  if (
    msg.includes("nu e bine") ||
    msg.includes("nu ajuta") ||
    msg.includes("gresit")
  ) {
    return "dissatisfaction";
  }

  if (
    msg.includes("nu mai recomanda") ||
    msg.includes("fara produse")
  ) {
    return "no_recommendations";
  }

  if (
    msg.includes("de ce intrebi") ||
    msg.includes("de ce")
  ) {
    return "meta_question";
  }

  return null;
}

function detectDomain(message) {
  const msg = String(message || "").toLowerCase();
  if (msg.includes("ceramica") || msg.includes("coating")) return "protection";
  if (msg.includes("polish") || msg.includes("lustruire")) return "polishing";
  if (msg.includes("curat") || msg.includes("spal")) return "cleaning";
  return null;
}

function isNewTopic(message, sessionContext) {
  const msg = String(message || "").toLowerCase();
  const knownObjects = ["cotiera", "scaun", "bord", "masina", "jante", "parbriz"];
  const detectedObject = knownObjects.find(obj => msg.includes(obj));
  const currentObject = sessionContext?.slots?.object;

  if (detectedObject && currentObject && detectedObject !== currentObject) {
    return true;
  }

  const hasNewVerb =
    msg.includes("cum") ||
    msg.includes("cum aplic") ||
    msg.includes("cum spal") ||
    msg.includes("cum curat") ||
    msg.includes("vreau sa");

  const newDomain = detectDomain(message);
  const oldDomain = sessionContext?.domain;

  const domainChanged = newDomain && oldDomain && newDomain !== oldDomain;

  return hasNewVerb || domainChanged;
}

function detectUserControl(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("nu vreau recomandari") || msg.includes("fara recomandari")) {
    return "disable_recommendations";
  }

  if (msg.includes("vreau recomandari")) {
    return "enable_recommendations";
  }

  return null;
}

function detectInterrupt(message) {
  const msg = String(message || "").toLowerCase();

  if (
    msg.includes("nu ai intrebat") ||
    msg.includes("te-ai pierdut") ||
    msg.includes("nu raspunzi") ||
    msg.includes("nu e bine") ||
    msg.includes("gresit")
  ) {
    return "dissatisfaction";
  }

  if (
    msg.includes("de ce intrebi") ||
    msg.includes("ce vrei sa stii") ||
    msg.includes("de ce")
  ) {
    return "meta";
  }

  return null;
}

function isLowSignal(message, intentConfidence = null) {
  const msg = String(message || "").toLowerCase().trim();

  if (!msg) return true;
  if (msg.length < 5) return true;

  const vagueInputs = [
    "test",
    "ceva",
    "ajuta-ma",
    "recomanda ceva",
    "vreau ceva"
  ];

  if (vagueInputs.some(v => msg.includes(v))) {
    return true;
  }

  const signalKeywords = [
    "interior", "exterior", "curat", "spal", "jante", "roti", "anvelope",
    "parbriz", "vopsea", "piele", "textil", "plastic", "insect", "cum",
    "ce", "unde", "de ce", "pot", "folosi", "produs"
  ];
  const hasSignalKeyword = signalKeywords.some(keyword => msg.includes(keyword));
  const words = msg.split(/\s+/).filter(Boolean);
  const isSingleToken = words.length === 1;
  const uniqueRatio = msg.length > 0 ? new Set(msg.replace(/\s+/g, "")).size / msg.replace(/\s+/g, "").length : 1;
  const hasLongConsonantRun = /[bcdfghjklmnpqrstvwxyz]{5,}/i.test(msg);
  const looksLikeGarbageToken = isSingleToken && msg.length >= 8 && !hasSignalKeyword && (uniqueRatio < 0.45 || hasLongConsonantRun);

  if (looksLikeGarbageToken) {
    return true;
  }

  if (typeof intentConfidence === "number" && intentConfidence < 0.6 && !hasSignalKeyword) {
    return true;
  }

  return false;
}

function isSelectionFollowUp(message) {
  const msg = String(message || "").toLowerCase();

  return (
    msg.includes("de care") ||
    msg.includes("ce recomanzi") ||
    msg.includes("link") ||
    msg.includes("ce produs") ||
    msg.includes("care e mai bun")
  );
}

function normalizeRomanianText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

function detectSelectionEscalationTrigger(message) {
  const msg = normalizeRomanianText(message);

  if (!msg || msg === "ok") {
    return null;
  }

  if (msg.includes("care este diferenta") || msg.includes("mai explica")) {
    return null;
  }

  if (msg.includes("apc") && msg.includes("link")) {
    return "apc+link";
  }

  if (msg.includes("sampon") && (msg.includes("recomanzi") || msg.includes("ce recomanzi") || msg.includes("care recomanzi"))) {
    return "sampon+recomanzi";
  }

  if (msg.includes("de care")) return "de_care";
  if (msg.includes("care recomanzi")) return "care_recomanzi";
  if (msg.includes("pe care")) return "pe_care";
  if (msg.includes("ce recomanzi")) return "ce_recomanzi";
  if (msg.includes("trimite link")) return "trimite_link";
  if (msg.includes("unde gasesc")) return "unde_gasesc";
  if (msg.includes("vreau sa cumpar")) return "vreau_sa_cumpar";
  if (msg.includes("link")) return "link";

  return null;
}

function isSelectionEscalation(message, context = {}) {
  const previousAction = String(context?.previousAction || "").toLowerCase().trim();
  if (previousAction !== "knowledge" && previousAction !== "informational") {
    return { escalate: false, matchedTrigger: null };
  }

  const matchedTrigger = detectSelectionEscalationTrigger(message);
  if (!matchedTrigger) {
    return { escalate: false, matchedTrigger: null };
  }

  return {
    escalate: true,
    matchedTrigger
  };
}

function getTopicHintFromMessage(message) {
  const msg = normalizeRomanianText(message);

  if (msg.includes("apc")) {
    return "apc";
  }

  if (msg.includes("sampon")) {
    return "sampon";
  }

  return null;
}

function getContextHintForEscalation(message) {
  const msg = normalizeRomanianText(message);
  if (msg.includes("interior")) return "interior";
  if (msg.includes("exterior")) return "exterior";
  return null;
}

function getDeterministicIntent(message) {
  const msg = String(message || "").toLowerCase();

  if (
    hasExplicitInsectSignal(msg) ||
    GLASS_OBJECT_ALIASES.some(alias => msg.includes(alias))
  ) {
    return "procedural";
  }

  if (
    msg.includes("cum") ||
    msg.includes("cum sa") ||
    msg.includes("vreau sa curat") ||
    msg.includes("vreau sa spal")
  ) {
    return "procedural";
  }

  if (
    msg.includes("pot folosi") ||
    msg.includes("este sigur") ||
    msg.includes("afecteaza") ||
    msg.includes("exista")
  ) {
    return "knowledge";
  }

  if (
    (msg === "pa" || msg === "la revedere") &&
    msg.length < 15
  ) {
    return "farewell";
  }

  return null;
}

function needsContextFirst(message, slots) {
  const msg = String(message || "").toLowerCase();
  const safeSlots = slots && typeof slots === "object" ? slots : {};

  if (
    msg.includes("masina") &&
    (msg.includes("spal") || msg.includes("curat"))
  ) {
    return !safeSlots.context;
  }

  return false;
}

function requiresSurface(intentType) {
  return intentType === "procedural" || intentType === "selection";
}

function isCompatibilitySafetyQuery(message) {
  const msg = String(message || "").toLowerCase();
  const compatibilityPhrases = ["pot folosi", "pot sa dau", "este sigur", "e ok", "merge"];
  const materialTokens = ["piele", "textil", "plastic"];

  return (
    compatibilityPhrases.some(phrase => msg.includes(phrase)) &&
    msg.includes("apc") &&
    materialTokens.some(token => msg.includes(token))
  );
}

function getCompatibilitySafetyReply(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("piele")) {
    return "Pe piele, APC-ul se foloseste doar foarte diluat si testat pe o zona mica. Ideal este un cleaner dedicat pentru piele.";
  }

  if (msg.includes("textil")) {
    return "Pe textil, APC-ul poate fi folosit diluat, cu test preliminar si fara sa imbibi excesiv materialul.";
  }

  if (msg.includes("plastic")) {
    return "Pe plastic, APC-ul este in general ok daca este diluat corect si sters complet dupa aplicare.";
  }

  return "Pot sa te ajut cu compatibilitatea produselor, dar spune-mi exact materialul vizat.";
}

function isSafetyQuery(message) {
  const msg = String(message || "").toLowerCase();

  return (
    isCompatibilitySafetyQuery(msg) ||
    msg.includes("pot sa") ||
    msg.includes("pot folosi") ||
    msg.includes("este sigur") ||
    msg.includes("e sigur") ||
    msg.includes("safe pe") ||
    msg.includes("sigur pe") ||
    msg.includes("merge pe") ||
    msg.includes("compatibil") ||
    msg.includes("afecteaza")
  );
}

function detectProblemType(message) {
  const msg = String(message || "").toLowerCase();

  if (msg.includes("insect")) return "insects";
  if (msg.includes("ciment")) return "cement";
  if (msg.includes("gudron")) return "tar";
  if (msg.includes("rasina")) return "resin";
  if (msg.includes("calcar")) return "mineral";

  return null;
}

function clearProblemType(sessionContext, sessionId) {
  if (!sessionContext?.problemType) {
    return;
  }

  sessionContext.problemType = null;
  saveSession(sessionId, sessionContext);
}

function consumeValidationInfo(sessionContext, sessionId) {
  if (sessionContext && sessionContext.validationInfoMessage) {
    const msg = sessionContext.validationInfoMessage;
    sessionContext.validationInfoMessage = null;
    saveSession(sessionId, sessionContext);
    return msg;
  }
  return null;
}

function clearProceduralStateForKnowledgeBoundary(sessionContext, sessionId) {
  const safeContext = sessionContext && typeof sessionContext === "object"
    ? sessionContext
    : {};

  const currentSlots = safeContext.slots && typeof safeContext.slots === "object"
    ? safeContext.slots
    : {};

  safeContext.lastProceduralSlots = { ...currentSlots };
  safeContext.proceduralSlots = {};
  safeContext.slots = {};
  safeContext.pendingQuestion = null;
  safeContext.state = "IDLE";

  saveSession(sessionId, safeContext);

  return safeContext;
}

function resetSessionAfterAbuse(sessionContext, sessionId) {
  const safeContext = sessionContext && typeof sessionContext === "object"
    ? sessionContext
    : {};

  safeContext.slots = {};
  safeContext.pendingQuestion = null;
  safeContext.pendingSelection = false;
  safeContext.pendingSelectionMissingSlot = null;
  safeContext.state = "IDLE";
  safeContext.originalIntent = null;
  safeContext.lastFlow = null;
  safeContext.intentFlags = {};

  saveSession(sessionId, safeContext);
  logInfo("PENDING_QUESTION_TRANSITION", {
    reason: "abuse_reset",
    pendingQuestion: null,
    slots: safeContext.slots
  });

  return safeContext;
}

const NON_CLEANING_GREETINGS = ["salut", "salutare", "buna", "hello"];
const NON_CLEANING_SMALL_TALK = ["ce faci", "cum esti"];
const NON_CLEANING_DISCOUNT = ["cod de reducere", "reducere", "discount"];
const NON_CLEANING_META = ["o sa inlocuiesti", "vorbesc cu clientii", "baietii"];
const NON_CLEANING_PROFANITY = ["prost", "idiot", "dracu", "naiba", "dute"];

function normalizeMessageText(message) {
  return String(message || "").toLowerCase().trim();
}

function messageIncludesAny(text, terms) {
  return terms.some(term => text.includes(term));
}

function shouldResetForNonCleaningMessage(message) {
  const text = normalizeMessageText(message);

  if (!text) {
    return false;
  }

  return (
    messageIncludesAny(text, NON_CLEANING_GREETINGS) ||
    messageIncludesAny(text, NON_CLEANING_SMALL_TALK) ||
    messageIncludesAny(text, NON_CLEANING_DISCOUNT) ||
    messageIncludesAny(text, NON_CLEANING_META) ||
    messageIncludesAny(text, NON_CLEANING_PROFANITY)
  );
}

function isNonCleaningDomainMessage(message) {
  return shouldResetForNonCleaningMessage(message);
}

function getNonCleaningDomainReply(message) {
  const text = normalizeMessageText(message);

  if (messageIncludesAny(text, NON_CLEANING_DISCOUNT)) {
    return "Nu am un cod de reducere activ in acest moment, dar te pot ajuta cu recomandari potrivite pentru ce vrei sa cureti.";
  }

  if (messageIncludesAny(text, NON_CLEANING_SMALL_TALK)) {
    return "Sunt aici sa te ajut cu solutii de detailing. Spune-mi ce vrei sa cureti.";
  }

  if (messageIncludesAny(text, NON_CLEANING_PROFANITY)) {
    return "Pot continua daca imi spui concret ce suprafata sau problema vrei sa rezolvi.";
  }

  if (messageIncludesAny(text, NON_CLEANING_META)) {
    return "Sunt aici sa te ajut cu raspunsuri despre detailing auto. Spune-mi ce vrei sa cureti.";
  }

  if (messageIncludesAny(text, NON_CLEANING_GREETINGS)) {
    return "Salut! Spune-mi ce vrei sa cureti si te ghidez.";
  }

  return "Te pot ajuta cu recomandari pentru curatare auto. Spune-mi ce vrei sa cureti.";
}

const SINGLE_TOKEN_SLOT_VALUES = {
  context: {
    interior: "interior",
    exterior: "exterior"
  },
  surface: {
    vopsea: "paint",
    textil: "textile",
    piele: "leather"
  },
  object: {
    parbriz: "glass",
    geam: "glass",
    geamuri: "glass",
    sticla: "glass",
    bancheta: "scaun"
  }
};

function extractSingleToken(message) {
  const text = normalizeMessageText(message);
  if (!text) return null;

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) {
    return null;
  }

  return tokens[0];
}

function getSingleTokenBindingForPendingQuestion(message, pendingQuestion) {
  const pending = pendingQuestion && typeof pendingQuestion === "object"
    ? pendingQuestion
    : null;
  if (!pending?.slot) {
    return null;
  }

  const token = extractSingleToken(message);
  if (!token) {
    return null;
  }

  const mapForSlot = SINGLE_TOKEN_SLOT_VALUES[pending.slot] || null;
  if (!mapForSlot || !Object.prototype.hasOwnProperty.call(mapForSlot, token)) {
    return null;
  }

  if (pending.slot === "surface") {
    return { slot: "surface", value: mapForSlot[token] };
  }

  if (pending.slot === "object") {
    return { slot: "object", value: mapForSlot[token] };
  }

  return { slot: "context", value: mapForSlot[token] };
}

function hasStrongSlots(slots) {
  return Boolean(slots?.object || slots?.surface);
}

function getGuidedRedirectMessage(message) {
  const msg = String(message || "").toLowerCase();

  if (
    msg.includes("miros") ||
    msg.includes("problema generala") ||
    msg.includes("nu stiu")
  ) {
    return "Te pot ajuta cu curățarea interiorului. Vrei să începem cu scaunele sau mocheta?";
  }

  return null;
}

function getSafeFallbackReply() {
  return "Nu sunt sigur că îți pot da un răspuns corect pentru asta.\nPot să te ajut cu:\n- curățare interior\n- spălare exterior";
}

function isKnownCleaningEntry(message) {
  const msg = String(message || "").toLowerCase();

  return [
    "curat",
    "curata",
    "curatare",
    "spal",
    "spalare",
    "decontamin",
    "insect",
    "interior",
    "exterior",
    "scaun",
    "mocheta",
    "cotiera",
    "parbriz",
    "jante",
    "geam",
    "vopsea",
    "piele",
    "textil"
  ].some(keyword => msg.includes(keyword));
}

function resolveAction({
  message,
  slots,
  problemType = null
}) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const resolvedMessage = typeof message === "string"
    ? message
    : String(message?.text || "");
  const routingDecision = message && typeof message === "object"
    ? message.routingDecision
    : null;
  const guidedRedirectMessage = getGuidedRedirectMessage(resolvedMessage);
  const strongSlotsPresent = hasStrongSlots(safeSlots);
  const knownCleaningEntry = isKnownCleaningEntry(resolvedMessage);

  if (isSafetyQuery(resolvedMessage)) {
    console.log("SAFETY_OVERRIDE", {
      message: resolvedMessage,
      slots: safeSlots
    });
    return {
      action: "knowledge",
      flowId: null,
      missingSlot: null
    };
  }

  console.log("SLOT_CHECK_SOURCE", safeSlots);
  let action = routingDecision?.action || null;

  if (action === "selection") {
    const missingSlot = getRouterMissingSlot(safeSlots);

    if (missingSlot) {
      return {
        action: "clarification",
        flowId: null,
        missingSlot
      };
    }

    return {
      action: "recommend",
      flowId: null,
      missingSlot: null
    };
  }

  if (action === "knowledge") {
    if (guidedRedirectMessage && !problemType && !strongSlotsPresent) {
      return {
        action: "knowledge",
        flowId: null,
        missingSlot: null,
        safeFallback: true,
        replyOverride: guidedRedirectMessage
      };
    }

    if (!problemType && !strongSlotsPresent) {
      return {
        action: "knowledge",
        flowId: null,
        missingSlot: null,
        safeFallback: true
      };
    }

    return {
      action: "knowledge",
      flowId: null,
      missingSlot: null
    };
  }

  if (action === "safety") {
    return {
      action: "safety",
      flowId: null,
      missingSlot: null
    };
  }

  if (action === "procedural") {
    if (guidedRedirectMessage && !problemType && !strongSlotsPresent) {
      return {
        action: "knowledge",
        flowId: null,
        missingSlot: null,
        safeFallback: true,
        replyOverride: guidedRedirectMessage
      };
    }

    if (!problemType && !strongSlotsPresent && !knownCleaningEntry) {
      return {
        action: "knowledge",
        flowId: null,
        missingSlot: null,
        safeFallback: true
      };
    }

    const missingSlot = getMissingSlot(safeSlots);

    if (missingSlot) {
      console.log("FLOW_DECISION", {
        flowCandidate: null,
        missingSlot
      });

      return {
        action: "clarification",
        flowId: null,
        missingSlot
      };
    }

    const flowResolution = resolveFlow({
      intent: "product_guidance",
      message: resolvedMessage,
      slots: safeSlots,
      problemType
    });

    if (flowResolution && flowResolution.type === "knowledge_override") {
      return {
        action: "knowledge",
        flowId: null,
        missingSlot: null
      };
    }

    const flowCandidates = resolveFlowCandidates({
      intent: "product_guidance",
      message: resolvedMessage,
      slots: safeSlots,
      problemType
    });
    const flowCandidate = Array.isArray(flowCandidates) && flowCandidates.length > 0
      ? flowCandidates[0]
      : null;

    console.log("FLOW_DECISION", {
      flowCandidate: flowCandidate?.flowId || null,
      missingSlot
    });

    if (flowCandidate && flowCandidate.flowId) {
      return {
        action: "flow",
        flowId: flowCandidate.flowId,
        missingSlot: null
      };
    }

    if (guidedRedirectMessage && !problemType && !strongSlotsPresent) {
      return {
        action: "knowledge",
        flowId: null,
        missingSlot: null,
        safeFallback: true,
        replyOverride: guidedRedirectMessage
      };
    }

    return {
      action: "knowledge",
      flowId: null,
      missingSlot: null,
      safeFallback: true
    };
  }

  if (action) {
    return {
      action,
      flowId: null,
      missingSlot: routingDecision?.missingSlot || null
    };
  }

  return {
    action: "knowledge",
    flowId: null,
    missingSlot: null
  };
}

/**
 * P1 - INPUT SANITY: Preprocess message with trim, lowercase, strip HTML artifacts
 * No typo correction, minimal safety only.
 */
function normalizeMessage(message) {
  let msg = String(message || "").trim().toLowerCase();

  // Strip known HTML artifacts from logging/rendering
  msg = msg.replace(/&nbsp;/g, " ");
  msg = msg.replace(/&lt;/g, "<");
  msg = msg.replace(/&gt;/g, ">");
  msg = msg.replace(/&amp;/g, "&");
  msg = msg.replace(/&#039;/g, "'");
  msg = msg.replace(/&quot;/g, '"');
  // Strip any other common HTML entities
  msg = msg.replace(/&#?[a-z0-9]+;/g, " ");
  // Collapse multiple spaces
  msg = msg.replace(/\s+/g, " ").trim();

  // Route transformations (not typo correction)
  if (msg.includes("vreau sa curat")) {
    msg = msg.replace("vreau sa curat", "cum curat");
  }

  if (msg.includes("vreau sa spal")) {
    msg = msg.replace("vreau sa spal", "cum spal");
  }

  return msg;
}

/**
 * P1 - BASIC SAFETY: Profanity/insult detection (minimal list)
 * Returns true if message violates safety, false otherwise. No complex NLP upgrades.
 */
const PROFANITY_INSULT_LIST = [
  "prost", "idiot", "imbecil", "dobitoc", "nenorocit",
  "dracu", "naiba", "dute dracu", "dute in p",
  "muie", "fut", "cacat", "cocaini", "pizda", "pula"
];

const SAFETY_PHRASE_PATTERNS = [
  "pot folosi",
  "pot sa folosesc",
  "este sigur",
  "e sigur",
  "safe pe",
  "sigur pe"
];

function isSafetyViolation(message) {
  const text = String(message || "").toLowerCase().trim();
  if (PROFANITY_INSULT_LIST.some(term => text.includes(term))) {
    return true;
  }

  return /(\b(fut|pula|pizda|muie|cacat|dracu|naiba)\b)/i.test(text);
}

function isSafetyEntryMessage(message) {
  const msg = String(message || "").toLowerCase();
  if (isSafetyQuery(msg)) {
    return true;
  }

  return SAFETY_PHRASE_PATTERNS.some(pattern => msg.includes(pattern));
}

function getSafetyViolationReply() {
  return "Te pot ajuta cu intrebari legate de curatarea masinii sau produse.";
}

/**
 * ROUTING PURITY: Detect knowledge-style questions that should NOT enter procedural slot-filling
 * Examples: "cat dureaza...", "cum...", "ce este...", "de ce...", etc.
 */
function isKnowledgeQuestion(message) {
  const text = String(message || "").toLowerCase().trim();
  const knowledgePatterns = [
    /^cat\s+(dureaza|cost|e|este)/,  // cat dureaza? cat e?
    /^cum\s+/,                        // cum se curata? cum...?
    /^ce\s+(este|e)\s+/,             // ce este acesta? ce e...?
    /^de\s+ce/,                       // de ce?
    /^care\s+(e|este)/,               // care e diferenta?
    /^care\s+sunt\s+/,               // care sunt avantajele?
    /^ce\s+diferenta/,                // ce diferenta?
    /^ce\s+se\s+intampla/,            // ce se intampla?
    /^cum\s+se\s+curata/,             // cum se curata?
    /^care\s+(sunt|e|este)\s+diferentele/, // care sunt diferentele?
  ];
  return knowledgePatterns.some(pattern => pattern.test(text));
}

/**
 * ROUTING PURITY: Check if message contains explicit interior intent that should NOT be overridden
 */
function hasExplicitInteriorIntent(message) {
  const text = String(message || "").toLowerCase().trim();
  const interiorKeywords = [
    "interior", "interioara", "interioare", "in interior",
    "scaun", "scaune", "mocheta", "tapiterie", "cotiera",
    "bord", "plafon", "oglinda interior", "parbriz interior"
  ];
  return interiorKeywords.some(keyword => text.includes(keyword));
}

/**
 * ROUTING PURITY: Detect negations/corrections that should not trigger new flow selection
 * Examples: "nu avem", "nu e", "fara", "n-avem"
 */
function isNegationCorrection(message) {
  const text = String(message || "").toLowerCase().trim();
  const negationPatterns = [
    /\bnu\s+(avem|e|este|am)/,  // nu avem, nu e, nu este, nu am
    /\bfara\s+/,                 // fara...
    /\bn-avem/,                   // n-avem
  ];
  return negationPatterns.some(pattern => pattern.test(text));
}

/**
 * ROUTING PURITY: Create canonical routing decision object for logging
 */
function createCanonicalRoutingDecision({
  queryType,
  action,
  reason,
  slots = {},
  flowId = null,
  missingSlot = null,
  pendingSelectionState = null
}) {
  return {
    queryType,
    action,
    reason,
    slots: {
      context: slots.context || null,
      surface: slots.surface || null,
      object: slots.object || null
    },
    flowId,
    missingSlot,
    pendingSelectionState
  };
}

/**
 * ROUTING PURITY: Detect explicit context from message before any defaults
 * Prevents procedural defaults from overriding explicit interior/exterior intent
 * Returns: "interior", "exterior", or null (if ambiguous or not detected)
 */
function detectExplicitContext(message) {
  const s = String(message || "").toLowerCase();
  
  const hasInterior =
    s.includes("interior") || 
    s.includes("interioara") || 
    s.includes("interioare") || 
    s.includes("in interior");
  
  const hasExterior =
    s.includes("exterior") || 
    s.includes("exterioara") || 
    s.includes("exterioare") || 
    s.includes("in exterior");
  
  // Clear winner: only interior keywords found
  if (hasInterior && !hasExterior) return "interior";
  
  // Clear winner: only exterior keywords found
  if (hasExterior && !hasInterior) return "exterior";
  
  // Ambiguous (both found) or neither found
  return null;
}

function detectStrongContextOverride(message) {
  const text = String(message || "").toLowerCase();

  if (text.includes("jante")) {
    return {
      context: "exterior",
      object: "jante",
      surface: "wheels",
      reason: "strong_keyword_jante"
    };
  }

  if (text.includes("bord")) {
    return {
      context: "interior",
      object: null,
      surface: null,
      reason: "strong_keyword_bord"
    };
  }

  if (text.includes("scaun")) {
    return {
      context: "interior",
      object: null,
      surface: null,
      reason: "strong_keyword_scaun"
    };
  }

  return null;
}

function isWheelsObjectLike(slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const object = String(safeSlots.object || "").toLowerCase();
  return object === "wheels" || object === "jante" || safeSlots.surface === "wheels";
}

/**
 * Deterministic slot combination validator.
 * Returns { status: "VALID"|"INVALID"|"CORRECTABLE", correctedSlots?, userMessage?, ask?, reasonCode }
 */
function validateCombination(context, object, surface) {
  const rule = object ? SLOT_DOMAIN_RULES[object] : null;

  if (!rule) {
    // Object unknown or not in domain rules – skip validation, let routing handle it
    return { status: "VALID", reasonCode: "OBJ_UNKNOWN_SKIP_VALIDATION" };
  }

  const correctedSlots = {};
  let reasonCode = null;

  // 1. Context unknown → infer from rule
  const effectiveContext = context || null;
  if (!effectiveContext) {
    correctedSlots.context = rule.context;
    reasonCode = "OBJ_INFERRED_CONTEXT";
    if (object === "jante") {
      return {
        status: "CORRECTABLE",
        correctedSlots,
        userMessage: "Jantele sunt la exterior. Te ajut cu curatarea lor.",
        reasonCode
      };
    }
  }

  // 2. Context conflicts with object's canonical domain → CORRECTABLE with correction message
  const resolvedContext = correctedSlots.context || effectiveContext;
  if (resolvedContext && resolvedContext !== rule.context) {
    correctedSlots.context = rule.context;
    reasonCode = "CONTEXT_CONFLICT_WITH_OBJECT";
    // Apply the implied single surface too (e.g. jante → wheels)
    if (rule.allowedSurfaces.length === 1) {
      correctedSlots.surface = rule.allowedSurfaces[0];
    }
    let userMessage;
    if (object === "jante" && resolvedContext === "interior") {
      userMessage = "Jantele sunt la exterior. Te ajut cu curatarea lor.";
    } else if ((object === "scaun" || object === "bancheta") && resolvedContext === "exterior") {
      userMessage = "Scaunele sunt la interior. Te ajut cu curatarea lor.";
      if (!surface) {
        correctedSlots.surface = "textile";
      }
    } else if (object === "bord" && resolvedContext === "exterior") {
      userMessage = "Bordul este la interior. Te ajut cu curatarea lui.";
    } else if (object === "mocheta" && resolvedContext === "exterior") {
      userMessage = "Mocheta este la interior. Te ajut cu curatarea ei.";
    } else if (object === "caroserie" && resolvedContext === "interior") {
      userMessage = "Caroseria este la exterior. Te ajut cu curatarea ei.";
    } else {
      // Generic conflict correction – silent auto-fix, no user message
      userMessage = null;
    }
    return {
      status: "CORRECTABLE",
      correctedSlots,
      userMessage: userMessage || undefined,
      reasonCode
    };
  }

  // 3. Surface unknown + object implies exactly one surface → infer silently
  const effectiveSurface = surface || null;
  if (!effectiveSurface && rule.allowedSurfaces.length === 1) {
    correctedSlots.surface = rule.allowedSurfaces[0];
    if (!reasonCode) reasonCode = "OBJ_INFERRED_SURFACE";
  }

  // 4. Surface provided but not in allowed list → INVALID with targeted clarification
  if (effectiveSurface && !rule.allowedSurfaces.includes(effectiveSurface)) {
    reasonCode = "SURFACE_NOT_ALLOWED_FOR_OBJECT";
    let ask;
    if (object === "scaun" || object === "bancheta" || object === "tapiterie") {
      ask = { question: "Scaunele nu sunt din vopsea. Sunt textile sau piele?", choices: ["textile", "piele"] };
    } else if (object === "geam" || object === "parbriz") {
      ask = { question: "Geamurile nu sunt din piele. Sunt din sticla?", choices: ["da", "nu"] };
    } else if (object === "jante") {
      ask = { question: "Jantele nu sunt din textile. Sunt suprafata de roti?", choices: ["da", "nu"] };
    } else if (object === "mocheta") {
      ask = { question: "Mocheta este din material textil. Vrei sa continui cu curatarea ei?", choices: ["da", "nu"] };
    } else if (object === "bord" || object === "consola") {
      ask = { question: "Bordul este din plastic. Vrei sa continui cu curatarea lui?", choices: ["da", "nu"] };
    } else if (object === "caroserie") {
      ask = { question: "Caroseria are suprafata de vopsea. Vrei sa continui cu tratamentul ei?", choices: ["da", "nu"] };
    } else {
      const allowed = rule.allowedSurfaces.join(", ");
      ask = { question: `Suprafata indicata nu este valida pentru ${object}. Suprafete permise: ${allowed}. Poti confirma suprafata corecta?` };
    }
    return {
      status: "INVALID",
      ask,
      reasonCode,
      correctedSlots: Object.keys(correctedSlots).length > 0 ? correctedSlots : undefined
    };
  }

  if (Object.keys(correctedSlots).length === 0) {
    return { status: "VALID", reasonCode: "VALID" };
  }

  return { status: "CORRECTABLE", correctedSlots, reasonCode };
}

function overrideIntent(message, detectedIntent) {
  const msg = String(message || "").toLowerCase().trim();
  const safeIntent = detectedIntent && typeof detectedIntent === "object"
    ? detectedIntent
    : { type: detectedIntent, confidence: 0.7 };

  if (
    msg.includes("cum") ||
    msg.includes("cum sa") ||
    msg.includes("vreau sa curat") ||
    msg.includes("vreau sa spal") ||
    msg.includes("sa curat") ||
    msg.includes("sa spal")
  ) {
    return { ...safeIntent, type: "product_guidance", confidence: 1.0 };
  }

  if (safeIntent.type === "farewell") {
    if (
      msg.length > 10 ||
      msg.includes("cum") ||
      msg.includes("curat") ||
      msg.includes("spal")
    ) {
      return { ...safeIntent, type: "product_guidance", confidence: 0.9 };
    }
  }

  return safeIntent;
}

function getIntentConfidenceValue(confidence) {
  if (typeof confidence === "number") {
    return confidence;
  }

  if (confidence === "high") return 0.9;
  if (confidence === "medium") return 0.7;
  if (confidence === "low") return 0.3;
  return 0.7;
}

/**
 * Main chat handler
 * New flow: Session → Intent → Context → Decision → [Guide Flow | Normal Flow]
 * Prioritizes session continuity and intelligent decision making
 */
async function handleChat(message, clientId, products, sessionId = "default") {
  if (typeof message === "object" && message != null && message.sessionId != null) {
    sessionId = String(message.sessionId);
  }
  if (typeof message === "object" && message != null && message.clientId != null) {
    clientId = message.clientId;
  }

  let userMessage = message;

  if (typeof message === "object" && message.message) {
    userMessage = message.message;
  }

  if (typeof userMessage !== "string") {
    userMessage = userMessage == null ? "" : String(userMessage);
  }

  const routingMessage = normalizeMessage(userMessage);

  // P1 - ENHANCED LOGGING: Track normalized message processing
  if (routingMessage !== String(userMessage).toLowerCase()) {
    logInfo("MESSAGE_NORMALIZED", {
      original: userMessage,
      normalized: routingMessage,
      reason: "html_artifacts_or_whitespace_stripped"
    });
  }

  if (!Array.isArray(products) || products.length === 0) {
    products = Array.isArray(fallbackProductsCatalog) ? fallbackProductsCatalog : [];
  }

  logInfo("CHAT", {
    clientId,
    sessionId,
    message: userMessage
  });

  emit("user_message", { message: userMessage, sessionId });

  let interactionRef = null;

  try {
    let sessionContext = getSession(sessionId);
    const clarificationPendingAtEntry = Boolean(sessionContext?.pendingQuestion) || String(sessionContext?.state || "").startsWith("NEEDS_");
    logInfo("PENDING_SELECTION_LOADED", {
      sessionId,
      pendingSelection: sessionContext?.pendingSelection,
      missing: sessionContext?.pendingSelectionMissingSlot
    });

    interactionRef = {
      timestamp: new Date().toISOString(),
      sessionId,
      message: userMessage,
      queryType: null,
      intentType: null,
      tags: null,
      slots: null,
      decision: { action: null, flowId: null, missingSlot: null },
      feedback: extractFeedback(typeof message === "object" ? message : null),
      productsCatalog: products
    };

    const previousAction = String(sessionContext?.previousAction || sessionContext?.activeIntent || "").toLowerCase().trim() || null;
    const messageTopicHint = getTopicHintFromMessage(userMessage);
    if (messageTopicHint) {
      sessionContext.currentTopic = messageTopicHint;
      saveSession(sessionId, sessionContext);
    }

    let selectionEscalation = false;
    let selectionEscalationTrigger = null;

    // P0 - SAFETY + ABUSE ENTRY: must run before normal intent/tagging/routing
    if (isSafetyViolation(routingMessage)) {
      logInfo("SAFETY_VIOLATION_DETECTED", {
        message: userMessage,
        normalizedMessage: routingMessage
      });
      sessionContext = resetSessionAfterAbuse(sessionContext, sessionId);

      return endInteraction(interactionRef, {
        type: "reply",
        message: getSafetyViolationReply()
      }, {
        slots: {},
        decision: { action: "safety", flowId: null, missingSlot: null, safetyViolation: true, abuseReset: true },
        outputType: "reply"
      });
    }

    if (isSafetyEntryMessage(userMessage)) {
      interactionRef.queryType = "safety";
      sessionContext = clearProceduralStateForKnowledgeBoundary(sessionContext, sessionId);
      const safetyReply = isCompatibilitySafetyQuery(userMessage)
        ? getCompatibilitySafetyReply(userMessage)
        : "Este o intrebare buna de siguranta. Spune-mi materialul si produsul, iar eu iti spun dilutia/utilizarea corecta.";

      return endInteraction(interactionRef, {
        type: "reply",
        message: safetyReply
      }, {
        slots: extractSlotsForSafetyQuery(userMessage),
        decision: { action: "safety", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    if (!clarificationPendingAtEntry && shouldResetForNonCleaningMessage(userMessage)) {
      sessionContext = clearProceduralStateForKnowledgeBoundary(sessionContext, sessionId);

      return endInteraction(interactionRef, {
        type: "reply",
        message: getNonCleaningDomainReply(userMessage)
      }, {
        slots: {},
        decision: { action: "knowledge", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    const lowSignalIntent = clarificationPendingAtEntry ? null : detectIntent(routingMessage, sessionId);
    const lowSignalConfidence = clarificationPendingAtEntry
      ? 1
      : getIntentConfidenceValue(
          typeof lowSignalIntent === "string" ? null : lowSignalIntent?.confidence
        );
    const lowSignalSlots = extractSlotsFromMessage(userMessage);

    if (!clarificationPendingAtEntry && isLowSignal(userMessage, lowSignalConfidence) && !hasStrongSlots(lowSignalSlots)) {
      sessionContext.slots = {};
      sessionContext.state = "IDLE";
      sessionContext.pendingQuestion = null;
      sessionContext.originalIntent = null;
      saveSession(sessionId, sessionContext);
      logInfo("LOW_SIGNAL_INPUT", {
        message: userMessage,
        confidence: lowSignalConfidence
      });

      return endInteraction(interactionRef, {
        type: "question",
        message: "Te pot ajuta cu interior sau exterior? Sau imi poti spune ce vrei sa cureti?"
      }, {
        decision: {
          action: "clarification",
          flowId: null,
          missingSlot: "context"
        },
        outputType: "question"
      });
    }

    const interrupt = detectInterrupt(userMessage);
    if (interrupt === "dissatisfaction") {
      return endInteraction(interactionRef, {
        type: "reply",
        message: "Ai dreptate, hai sa corectam. Spune-mi exact ce vrei sa rezolvam."
      }, {
        decision: { action: "dissatisfaction", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    if (interrupt === "meta") {
      return endInteraction(interactionRef, {
        type: "reply",
        message: "Întreb pentru a-ți recomanda soluția corectă în funcție de suprafață și context."
      }, {
        decision: { action: "meta_question", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    const metaIntent = detectMetaIntent(userMessage);

    // Load settings once and reuse the full object across the whole flow.
    const settings = getClientSettings(clientId);

    const session = getSessionService(sessionId);
    session.questionCount = session.questionCount || 0;

    // Step 2: Load session context from store
    const sessionActiveProducts = sessionContext.activeProducts || [];
    if (!sessionContext.objective) {
      sessionContext.objective = {
        type: null,
        slots: {},
        needsCompletion: false
      };
    }
    sessionContext.intentFlags = sessionContext.intentFlags || {};
    const isBugIntent =
      userMessage.toLowerCase().includes("insect") ||
      userMessage.toLowerCase().includes("insecte");

    if (isBugIntent) {
      sessionContext.intentFlags.bug = true;
    }

    const hasBugIntent = sessionContext?.intentFlags?.bug === true;
    sessionContext.state = sessionContext.state || "IDLE";
    let previousState = sessionContext.state;
    const pendingClarificationActive = Boolean(sessionContext?.pendingQuestion) || String(previousState || "").startsWith("NEEDS_");
    const isFollowUp =
      isFollowUpMessage(userMessage) ||
      (sessionContext.state && sessionContext.state !== "IDLE") ||
      sessionContext.pendingQuestion;

    if (!pendingClarificationActive && shouldHardResetForNewRootQuery(userMessage, sessionContext)) {
      sessionContext.slots = {};
      sessionContext.pendingQuestion = null;
      sessionContext.lastFlow = null;
      sessionContext.state = "IDLE";
      sessionContext.originalIntent = null;
      sessionContext.intentFlags = {};
      console.log("CONTEXT_RESET", {
        triggered: true,
        reason: "new_root_query"
      });
    }

    const newDomain = detectDomain(userMessage);
    if (newDomain) {
      sessionContext.domain = newDomain;
    }

    sessionContext.questionsAsked = sessionContext.questionsAsked || 0;
    const language = sessionContext.language || detectLanguage(userMessage);
    sessionContext.language = language;

    saveSession(sessionId, sessionContext);

    const control = detectUserControl(userMessage);
    if (control === "disable_recommendations") {
      sessionContext.allowRecommendations = false;
      sessionContext.noRecommendations = true;
      saveSession(sessionId, sessionContext);

      return endInteraction(interactionRef, {
        type: "reply",
        message: "Am înțeles. Nu îți mai recomand produse. Te ajut doar cu explicații."
      }, {
        decision: { action: "no_recommendations", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    if (control === "enable_recommendations") {
      sessionContext.allowRecommendations = true;
      sessionContext.noRecommendations = false;
      saveSession(sessionId, sessionContext);
    }

    if (sessionContext.lastUserMessage === userMessage) {
      return endInteraction(interactionRef, {
        type: "question",
        message: "Hai să clarificăm. Ce vrei exact să faci?"
      }, {
        outputType: "question"
      });
    }

    if (metaIntent === "dissatisfaction") {
      interactionRef.intentType = metaIntent;
      return endInteraction(interactionRef, {
        type: "question",
        message: "Înțeleg. Spune-mi ce nu a fost util și ajustez răspunsul."
      }, {
        decision: { action: "dissatisfaction", flowId: null, missingSlot: null },
        outputType: "question"
      });
    }

    if (metaIntent === "no_recommendations") {
      sessionContext.noRecommendations = true;
      saveSession(sessionId, sessionContext);
      interactionRef.intentType = metaIntent;
      return endInteraction(interactionRef, {
        type: "reply",
        message: "Am înțeles. Nu îți mai recomand produse. Te ajut doar cu explicații."
      }, {
        decision: { action: "no_recommendations", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    if (metaIntent === "meta_question") {
      interactionRef.intentType = metaIntent;
      return endInteraction(interactionRef, {
        type: "reply",
        message: "Întreb pentru a înțelege exact situația ta și să îți ofer cea mai bună soluție."
      }, {
        decision: { action: "meta_question", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    const escalationCheck = isSelectionEscalation(userMessage, {
      previousAction
    });
    selectionEscalation = escalationCheck.escalate === true;
    selectionEscalationTrigger = escalationCheck.matchedTrigger;

    const isPendingSelectionContinuation = sessionContext?.pendingSelection === true;
    let queryType = isPendingSelectionContinuation ? "selection" : detectQueryType(routingMessage);

    // Preserve selection path across clarification turns
    const SELECTION_WAIT_STATES = ["NEEDS_CONTEXT", "NEEDS_OBJECT", "NEEDS_SURFACE"];
    if (
      isPendingSelectionContinuation ||
      (SELECTION_WAIT_STATES.includes(sessionContext?.state) && sessionContext?.originalIntent === "selection")
    ) {
      queryType = "selection";
      logInfo("QUERY_TYPE_OVERRIDE", {
        reason: "selection_continuation",
        state: sessionContext.state,
        pendingSelection: sessionContext.pendingSelection === true,
        pendingSelectionMissingSlot: sessionContext.pendingSelectionMissingSlot || null
      });
    }

    if (pendingClarificationActive) {
      const lockedToSelection = sessionContext?.pendingSelection === true || sessionContext?.originalIntent === "selection";
      queryType = lockedToSelection ? "selection" : "procedural";
      logInfo("PENDING_CLARIFICATION_BYPASS", {
        active: true,
        classifierBypassed: true,
        lockedQueryType: queryType,
        state: sessionContext?.state || null,
        pendingSlot: sessionContext?.pendingQuestion?.slot || null
      });
    }

    if (selectionEscalation && !pendingClarificationActive) {
      queryType = "selection";
    }

    interactionRef.queryType = queryType;
    const isSafetyEnforced = queryType === "safety";
    logInfo("ROUTING", { queryType });

    if (isSafetyEnforced) {
      logInfo("ENFORCED_SAFETY", { message: userMessage });
    }

    const hadPendingQuestionAtStart = Boolean(sessionContext?.pendingQuestion);

    // HANDLE SLOT ANSWER (CRITICAL)
    const pending = sessionContext?.pendingQuestion;

    if (pending && pending.slot) {
      let updated = false;

      sessionContext.slots = sessionContext.slots || {};

      const singleTokenBinding = getSingleTokenBindingForPendingQuestion(userMessage, pending);

      if (singleTokenBinding) {
        sessionContext.slots[singleTokenBinding.slot] = singleTokenBinding.value;
        updated = true;
      }

      if (updated) {
        const previousPending = pending;
        sessionContext.pendingQuestion = null;

        console.log("PENDING_CLEARED", {
          previous: previousPending,
          slots: sessionContext.slots
        });

        logInfo("SLOT_FILLED_FROM_ANSWER", {
          slot: pending.slot,
          value: sessionContext.slots
        });
      } else {
        logInfo("PENDING_SLOT_UNRESOLVED", {
          slot: pending.slot,
          message: userMessage
        });
      }
    }

    let handledPendingQuestionAnswer = false;
    if (sessionContext.pendingQuestion) {
      const pq = sessionContext.pendingQuestion;
      const currentObject = sessionContext.slots?.object;

      if (pq.object && currentObject && pq.object !== currentObject) {
        logInfo("CLARIFICATION_DROPPED", {
          reason: "object_mismatch",
          pendingObject: pq.object,
          currentObject
        });

        sessionContext.pendingQuestion = null;
      }
    }

    if (sessionContext.pendingQuestion) {
      const pq = sessionContext.pendingQuestion;

      if (pq.type === "confirm_context") {
        if (isYes(userMessage)) {
          sessionContext.slots = sessionContext.slots || {};
          sessionContext.slots.context = pq.value;
          sessionContext.pendingQuestion = null;
          sessionContext.state = null;
          handledPendingQuestionAnswer = true;
        } else if (isNo(userMessage)) {
          sessionContext.pendingQuestion = null;
          sessionContext.state = null;
          saveSession(sessionId, sessionContext);
          return endInteraction(interactionRef, {
            type: "question",
            message: getClarificationQuestion("context", sessionContext.slots || {})
          }, {
            intentType: typeof sessionContext.originalIntent === "string"
              ? sessionContext.originalIntent
              : sessionContext.originalIntent?.type || "product_guidance",
            tags: sessionContext.tags || null,
            slots: sessionContext.slots || null,
            decision: { action: "clarification", flowId: null, missingSlot: "context" },
            outputType: "question"
          });
        }
      }

      saveSession(sessionId, sessionContext);

      // --- After resolving pendingQuestion for selection, re-enter slot evaluation loop ---
      const currentIntent = sessionContext.originalIntent || overrideIntent(routingMessage, detectIntent(routingMessage, sessionId));
      const intentType = typeof currentIntent === "string" ? currentIntent : currentIntent?.type;
      if (intentType === "selection") {
        // Re-enter selection slot evaluation immediately
        const slotResult = processSlots(userMessage, "selection", sessionContext, { mergeWithSession: hadPendingQuestionAtStart });
        const reentryPendingBeforeUpdate = sessionContext.pendingQuestion
          ? { ...sessionContext.pendingQuestion }
          : null;
        if (isHardReset(userMessage)) {
          sessionContext.slots = {};
          sessionContext.state = null;
          sessionContext.pendingQuestion = null;
        }
        const reentrySlotMode = hadPendingQuestionAtStart ? "merge" : "replace";
        const reentryBeforeSlots = { ...(sessionContext.slots || {}) };
        console.log("SLOT_MODE", {
          mode: reentrySlotMode
        });
        sessionContext.slots = reentrySlotMode === "merge"
          ? mergeSlots(sessionContext.slots || {}, slotResult.slots || {})
          : (slotResult.slots || {});
        if (isPendingQuestionFulfilled(reentryPendingBeforeUpdate, sessionContext.slots)) {
          sessionContext.pendingQuestion = null;
          console.log("PENDING_CLEARED", {
            previous: reentryPendingBeforeUpdate,
            slots: sessionContext.slots
          });
        }
        console.log("SLOT_UPDATE", {
          mode: reentrySlotMode,
          before: reentryBeforeSlots,
          after: sessionContext.slots
        });
        if (!slotResult.missing) {
          sessionContext.state = null;
          sessionContext.pendingQuestion = null;
        }
        saveSession(sessionId, sessionContext);
        const problemType = sessionContext.problemType || null;
        const reentrySelectionSlots = inferWheelsSurfaceFromObject(sessionContext.slots || slotResult.slots || {});
        if (reentrySelectionSlots !== (sessionContext.slots || slotResult.slots || {})) {
          sessionContext.slots = reentrySelectionSlots;
        }

        const selectionDecision = enforceClarificationContract(resolveAction({
          problemType,
          message: {
            text: userMessage,
            routingDecision: { action: "selection" }
          },
          slots: reentrySelectionSlots,
        }));
        const originalSelectionDecision = JSON.stringify(selectionDecision);
        assertMissingSlotInvariant(selectionDecision, reentrySelectionSlots);
        if (!selectionDecision || !selectionDecision.action) {
          throw new Error("Invalid decision: resolveAction must return action");
        }
        logInfo("DECISION_SOURCE", { source: "resolveAction", decision: selectionDecision });
        interactionRef.decision = selectionDecision;
        logInfo("ROUTER_DECISION", interactionRef.decision);
        if (JSON.stringify(selectionDecision) !== originalSelectionDecision) {
          console.warn("DECISION_MUTATION_DETECTED", {
            before: originalSelectionDecision,
            after: selectionDecision
          });
        }
        if (selectionDecision.action === "clarification") {
          const slotSnapshot = {
            context: slotResult.slots?.context || null,
            object: slotResult.slots?.object || null,
            surface: slotResult.slots?.surface || null
          };
          if (selectionDecision.missingSlot === "context") {
            sessionContext.state = "NEEDS_CONTEXT";
            sessionContext.originalIntent = "selection";
            sessionContext.pendingSelection = true;
            sessionContext.pendingSelectionMissingSlot = "context";
            saveSession(sessionId, sessionContext);
            return endInteraction(interactionRef, {
              type: "question",
              message: getClarificationQuestion("context", slotSnapshot)
            }, {
              intentType: "selection",
              tags: sessionContext.tags || null,
              slots: slotSnapshot,
              decision: selectionDecision,
              outputType: "question"
            });
          }
          if (selectionDecision.missingSlot === "object") {
            sessionContext.state = "NEEDS_OBJECT";
            sessionContext.originalIntent = "selection";
            sessionContext.pendingSelection = true;
            sessionContext.pendingSelectionMissingSlot = "object";
            saveSession(sessionId, sessionContext);
            const allowedObjects = getAllowedObjects(slotResult.slots);
            return endInteraction(interactionRef, {
              type: "question",
              message: `Ce obiect vrei sa cureti? (${allowedObjects.join(", ")})`
            }, {
              intentType: "selection",
              tags: sessionContext.tags || null,
              slots: slotSnapshot,
              decision: selectionDecision,
              outputType: "question"
            });
          }
          if (selectionDecision.missingSlot === "surface") {
            sessionContext.state = "NEEDS_SURFACE";
            sessionContext.originalIntent = "selection";
            sessionContext.pendingSelection = true;
            sessionContext.pendingSelectionMissingSlot = "surface";
            saveSession(sessionId, sessionContext);
            const allowedSurfaces = getAllowedSurfaces(slotResult.slots);
            const labelMap = {
              textile: "textil",
              leather: "piele",
              alcantara: "alcantara",
              plastic: "plastic",
              paint: "vopsea",
              wheels: "jante",
              glass: "geamuri"
            };
            const options = allowedSurfaces.map(surface => labelMap[surface] || surface).join(", ");
            return endInteraction(interactionRef, {
              type: "question",
              message: `Pe ce suprafata? (${options})`
            }, {
              intentType: "selection",
              tags: sessionContext.tags || null,
              slots: slotSnapshot,
              decision: selectionDecision,
              outputType: "question"
            });
          }
        }
        // All slots present, continue with selection logic below (let main handler proceed)
      }
    }

    // Step 3: Detect basic user intent (greeting/product_search)
    const shouldBypassIntentClassifier = pendingClarificationActive || handledPendingQuestionAnswer;
    const rawIntent = shouldBypassIntentClassifier
      ? (sessionContext.originalIntent || "product_guidance")
      : detectIntent(routingMessage, sessionId);
    let intentResult = shouldBypassIntentClassifier
      ? rawIntent
      : overrideIntent(routingMessage, rawIntent);
    const deterministicIntent = shouldBypassIntentClassifier ? null : getDeterministicIntent(userMessage);
    if (deterministicIntent) {
      const deterministicType =
        deterministicIntent === "procedural"
          ? "product_guidance"
          : deterministicIntent === "knowledge"
            ? "product_search"
            : deterministicIntent;

      if (typeof intentResult === "string") {
        intentResult = {
          type: deterministicType,
          confidence: 1.0
        };
      } else {
        intentResult = {
          ...intentResult,
          type: deterministicType,
          confidence: 1.0
        };
      }

      if (deterministicIntent === "procedural") {
        queryType = "procedural";
        interactionRef.queryType = queryType;
      } else if (deterministicIntent === "knowledge") {
        queryType = "informational";
        interactionRef.queryType = queryType;
      }
    }
    const isOrderIntent = ["order_status", "order_update", "order_cancel"].includes(
      typeof intentResult === "string" ? intentResult : intentResult?.type
    );
    const shouldForceProblemGuidance = detectProblemIntent(userMessage) && !isOrderIntent;
    const effectiveIntentResult = shouldForceProblemGuidance
      ? (typeof intentResult === "string"
        ? "product_guidance"
        : { ...intentResult, type: "product_guidance" })
      : intentResult;
    let resolvedEffectiveIntentResult = effectiveIntentResult;
    let intent = typeof effectiveIntentResult === "string" ? effectiveIntentResult : effectiveIntentResult?.type;

    if (
      isLikelySlotFill(userMessage) &&
      sessionContext.state?.startsWith("NEEDS_") &&
      sessionContext.pendingQuestion
    ) {
      logInfo("INTENT_OVERRIDDEN_AS_SLOT_FILL", {
        original: intent
      });

      intent = sessionContext.originalIntent || "product_guidance";
      resolvedEffectiveIntentResult = typeof effectiveIntentResult === "string"
        ? intent
        : { ...(effectiveIntentResult || {}), type: intent, confidence: 1.0 };
    }

    if (
      isSelectionFollowUp(userMessage) &&
      sessionContext.lastIntent === "informational"
    ) {
      logInfo("INTENT_ESCALATION", {
        from: "informational",
        to: "selection"
      });

      intent = "selection";
      queryType = "selection";
      interactionRef.queryType = queryType;
      resolvedEffectiveIntentResult = typeof resolvedEffectiveIntentResult === "string"
        ? intent
        : { ...(resolvedEffectiveIntentResult || {}), type: intent, confidence: 1.0 };
    }

    sessionContext.lastIntent = queryType;
    saveSession(sessionId, sessionContext);

    logInfo("INTENT", {
      detected: intent,
      problemOverrideApplied: shouldForceProblemGuidance
    });
    interactionRef.intentType = intent;

    if (!sessionContext.problemType) {
      const detectedProblemType = detectProblemType(userMessage);

      if (detectedProblemType) {
        sessionContext.problemType = detectedProblemType;
        saveSession(sessionId, sessionContext);
      }
    }

    console.log("PROBLEM_TYPE_ACTIVE", {
      message: userMessage,
      problemType: sessionContext.problemType || null
    });

    if (getIntentConfidenceValue(typeof intentResult === "string" ? null : intentResult?.confidence) < 0.6) {
      return endInteraction(interactionRef, {
        type: "question",
        message: "Poți să-mi dai mai multe detalii ca să înțeleg exact ce ai nevoie?"
      }, {
        decision: { action: "clarification", flowId: null, missingSlot: "context" },
        outputType: "question"
      });
    }

    if (intent === "farewell") {
      return endInteraction(interactionRef, {
        type: "reply",
        message: "Cu plăcere! Dacă mai ai nevoie, sunt aici."
      }, {
        decision: { action: "farewell", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    if (intent === "dissatisfaction") {
      return endInteraction(interactionRef, {
        type: "question",
        message: "Înțeleg. Poți să-mi spui mai exact ce nu a fost util ca să te ajut mai bine?"
      }, {
        decision: { action: "dissatisfaction", flowId: null, missingSlot: null },
        outputType: "question"
      });
    }

    // Detect and enrich tags BEFORE any flow branching (guidance, questioning, search)
    const availableProductTags = [...new Set((products || []).flatMap(p => p.tags || []))];
    const detectedTagsForMessage = await detectUserIntent(userMessage, settings, availableProductTags);

    const sessionTags = Array.isArray(sessionContext.tags) ? sessionContext.tags : [];
    const initialDetectedTags = Array.isArray(detectedTagsForMessage)
      ? detectedTagsForMessage.filter(tag => !OBJECT_SLOT_VALUES.includes(String(tag || "").toLowerCase()))
      : [];
    const coreTags = [...initialDetectedTags];

    const shouldPreserveFollowUpState =
      handledPendingQuestionAnswer ||
      isFollowUp ||
      previousState === "NEEDS_CONTEXT" ||
      previousState === "NEEDS_OBJECT" ||
      previousState === "NEEDS_SURFACE";

    if (!shouldPreserveFollowUpState) {
      sessionContext.slots = {};
      sessionContext.pendingQuestion = null;
      saveSession(sessionId, sessionContext);
    }

    let workingTags = shouldPreserveFollowUpState
      ? [...new Set([...sessionTags, ...coreTags])]
      : [...coreTags];

    workingTags = enrichTagsFromMessage(userMessage, workingTags);

    sessionContext.tags = workingTags;
    saveSession(sessionId, sessionContext);

    workingTags = filterContextTags(userMessage, workingTags);

    const coreContextTags = coreTags.filter(tag => tag === "interior" || tag === "exterior");
    workingTags = [...new Set([
      ...coreContextTags,
      ...workingTags
    ])];

    workingTags = ensureMinimumTags(workingTags);
    workingTags = sanitizeTagsForMessage(userMessage, workingTags, sessionContext.slots || {});

    interactionRef.tags = workingTags;

    if (intent === "greeting") {
      return endInteraction(interactionRef, {
        reply: "Salut! Cu ce te pot ajuta?"
      }, {
        decision: { action: "greeting", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    // ROUTING PURITY: Knowledge questions gate
    // If user message is a knowledge/information question, route to knowledge handler, not procedural slot-filling
    if (queryType === "procedural" && isKnowledgeQuestion(userMessage)) {
      logInfo("KNOWLEDGE_GATE_APPLIED", {
        reason: "knowledge_pattern_matched",
        original_queryType: "procedural",
        new_queryType: "informational"
      });
      queryType = "informational";
      interactionRef.queryType = queryType;
    }

    // ROUTING LAYER (before slots)
    const selectionPreview = queryType === "selection"
      ? processSlots(userMessage, "selection", sessionContext, { mergeWithSession: hadPendingQuestionAtStart })
      : null;
    let routingDecision = routeRequest({
      queryType,
      message: userMessage,
      slots: selectionPreview?.slots || sessionContext?.slots || {}
    });
    sessionContext.activeIntent = routingDecision.action;
    const previewAction = routingDecision.action;
    const normalizedUserMessage = userMessage.toLowerCase();
    const isContinuation =
      userMessage.length < 25 ||
      normalizedUserMessage.includes("mai") ||
      normalizedUserMessage.includes("si") ||
      normalizedUserMessage.includes("altceva");
    sessionContext.objective.type = routingDecision.action;
    saveSession(sessionId, sessionContext);

    if (selectionEscalation && !pendingClarificationActive) {
      const escalationTopic = messageTopicHint || sessionContext.currentTopic || null;
      const escalationContextHint = getContextHintForEscalation(userMessage);

      if (!escalationTopic) {
        sessionContext.pendingQuestion = { slot: "context" };
        sessionContext.state = "NEEDS_CONTEXT";
        saveSession(sessionId, sessionContext);
        logInfo("SELECTION_ESCALATION_ROUTING", {
          previousAction,
          selectionEscalation: true,
          matchedTrigger: selectionEscalationTrigger,
          finalAction: "clarification"
        });

        return endInteraction(interactionRef, {
          type: "question",
          message: "Pentru interior sau exterior?"
        }, {
          decision: { action: "clarification", flowId: null, missingSlot: "context" },
          outputType: "question"
        });
      }

      const escalationTags = [escalationTopic];
      if (escalationContextHint) {
        escalationTags.push(escalationContextHint);
      }

      const escalationCandidates = findRelevantProducts(escalationTags, products, MAX_SELECTION_PRODUCTS);
      const escalationRanked = applyRanking(escalationCandidates, { tags: escalationTags, priceRange: null }, settings);
      const escalationFiltered = filterProducts(
        enrichProducts(escalationRanked, products),
        { context: escalationContextHint || null, object: null, surface: null }
      );
      const escalationBundle = buildProductBundle(escalationFiltered);
      const finalEscalationProducts = enforceProductLimit(escalationBundle, MAX_SELECTION_PRODUCTS);
      const escalationReply = finalEscalationProducts.length > 0
        ? formatSelectionResponse(finalEscalationProducts, { context: escalationContextHint || null })
        : "Nu am gasit produse potrivite pentru aceasta selectie.";

      updateSessionWithProducts(sessionId, finalEscalationProducts, "recommendation");
      emit("products_recommended", { products: finalEscalationProducts, tags: escalationTags });
      emit("ai_response", { response: escalationReply });
      logResponseSummary("selection_escalation", { products: finalEscalationProducts.length });
      logInfo("SELECTION_ESCALATION_ROUTING", {
        previousAction,
        selectionEscalation: true,
        matchedTrigger: selectionEscalationTrigger,
        finalAction: "selection"
      });

      return endInteraction(interactionRef, {
        reply: escalationReply,
        products: finalEscalationProducts
      }, {
        intentType: "selection",
        slots: { context: escalationContextHint || null, object: null, surface: null },
        decision: { action: "selection", flowId: null, missingSlot: null },
        outputType: finalEscalationProducts.length > 0 ? "recommendation" : "reply",
        products: summarizeProductsForLog(finalEscalationProducts)
      });
    }

    // INFORMATIONAL
    if (queryType === "informational" && previewAction === "knowledge") {
      sessionContext = clearProceduralStateForKnowledgeBoundary(sessionContext, sessionId);
      const informationalTags = [...new Set(workingTags.filter(Boolean))];
      const knowledgeResults = findRelevantKnowledge(userMessage, knowledgeBase);

      if (knowledgeResults.length === 0) {
        const reply = "Nu am gasit informatii relevante. Poti reformula intrebarea?";
        updateSessionWithProducts(sessionId, [], "guidance");
        logInfo("DECISION", { type: "knowledge", fallbackReason: "query_type_informational_no_match" });
        emit("ai_response", { response: reply });
        logResponseSummary("knowledge", { products: 0 });
        interactionRef.slots = sessionContext.slots || null;
        return endInteraction(interactionRef, { reply, products: [] }, {
          decision: { action: "knowledge", flowId: null, missingSlot: null },
          outputType: "reply"
        });
      }

      const knowledgeContext = knowledgeResults.map(k => k.content).join("\n");
      const prompt = createOptimizedPrompt(
        userMessage,
        [],
        settings,
        informationalTags,
        "guidance",
        language,
        "general",
        knowledgeContext,
        {},
        "informational"
      );
      const reply = await askLLM(prompt);

      updateSessionWithProducts(sessionId, [], "guidance");
      logInfo("DECISION", { type: "knowledge", fallbackReason: "query_type_informational" });
      emit("ai_response", { response: reply });
      logResponseSummary("knowledge", { products: 0 });
      interactionRef.slots = sessionContext.slots || null;
      return endInteraction(interactionRef, { reply, products: [] }, {
        decision: { action: "knowledge", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    // SELECTION (strict slot logic, no fallback/knowledge)
    if (
      !isSafetyEnforced &&
      queryType === "selection" &&
      previewAction === "selection"
    ) {
      const slotResult = processSlots(userMessage, "selection", sessionContext, { mergeWithSession: hadPendingQuestionAtStart });
      let currentSlots = { ...(slotResult?.slots || {}) };
      currentSlots = inferWheelsSurfaceFromObject(currentSlots);
      slotResult.slots = currentSlots;
      const currentMessageSlots = extractSlotsFromMessage(userMessage);
      const introducesNewObjectOrContext = Boolean(
        (currentMessageSlots.context && currentMessageSlots.context !== (sessionContext.slots || {}).context) ||
        (currentMessageSlots.object && currentMessageSlots.object !== (sessionContext.slots || {}).object)
      );
      const currentObjectNormalized = String(currentSlots.object || "").toLowerCase();
      const isWheelsObject = currentObjectNormalized === "wheels" || currentObjectNormalized === "jante";
      if (introducesNewObjectOrContext && !currentMessageSlots.surface && !isWheelsObject) {
        currentSlots.surface = null;
        slotResult.slots.surface = null;
      }

      const problemType = sessionContext.problemType || null;
      const selectionDecision = enforceClarificationContract(resolveAction({
        problemType,
        message: {
          text: userMessage,
          routingDecision: { action: "selection" }
        },
        slots: currentSlots,
      }));
      const originalSelectionDecision = JSON.stringify(selectionDecision);
      assertMissingSlotInvariant(selectionDecision, currentSlots);
      if (!selectionDecision || !selectionDecision.action) {
        throw new Error("Invalid decision: resolveAction must return action");
      }
      logInfo("DECISION_SOURCE", { source: "resolveAction", decision: selectionDecision });

      if (JSON.stringify(selectionDecision) !== originalSelectionDecision) {
        console.warn("DECISION_MUTATION_DETECTED", {
          before: originalSelectionDecision,
          after: selectionDecision
        });
      }
      if (!hasRequiredSelectionSlots(currentSlots)) {
        const missing = selectionDecision.missingSlot;

        sessionContext.slots = currentSlots;
        sessionContext.state =
          missing === "context" ? "NEEDS_CONTEXT" :
          missing === "object" ? "NEEDS_OBJECT" :
          missing === "surface" ? "NEEDS_SURFACE" :
          sessionContext.state;
        sessionContext.originalIntent = "selection";
        sessionContext.pendingSelection = true;
        sessionContext.pendingSelectionMissingSlot = missing || null;
        saveSession(sessionId, sessionContext);

        return endInteraction(interactionRef, {
          type: "question",
          message:
            getClarificationQuestion(missing, currentSlots)
        }, {
          decision: {
            ...selectionDecision,
            missingSlot: missing
          },
          outputType: "question"
        });
      }

      if (selectionDecision.action === "clarification") {
        interactionRef.decision = selectionDecision;

        logInfo("ENFORCED_CLARIFICATION", {
          queryType,
          missingSlot: selectionDecision.missingSlot
        });

        sessionContext.originalIntent = "selection";
        sessionContext.pendingSelection = true;
        sessionContext.pendingSelectionMissingSlot = selectionDecision.missingSlot || null;
        saveSession(sessionId, sessionContext);

        return endInteraction(interactionRef, {
          type: "question",
          message: getClarificationQuestion(selectionDecision.missingSlot, currentSlots)
        });
      }

      const mergedSlots = {
        ...(sessionContext.slots || {}),
        ...(slotResult.slots || {})
      };
      sessionContext.slots = mergedSlots;
      if (!slotResult.missing) {
        sessionContext.state = null;
        sessionContext.pendingQuestion = null;
        delete sessionContext.pendingSelection;
        delete sessionContext.pendingSelectionMissingSlot;
      }
      saveSession(sessionId, sessionContext);
      interactionRef.decision = selectionDecision;
      logInfo("ROUTER_DECISION", interactionRef.decision);

      // All required slots are present, proceed with selection
      const selectionSlots = sessionContext.slots || slotResult.slots || {};
      const selectionTags = sanitizeTagsForMessage(
        userMessage,
        buildFinalTags(coreTags, workingTags, slotResult.slots),
        slotResult.slots || {}
      );
      const msg = userMessage.toLowerCase();
      let role = null;
      if (msg.includes("sampon")) role = "car_shampoo";
      if (msg.includes("jante")) role = "wheel_cleaner";
      if (msg.includes("geam")) role = "glass_cleaner";
      const roleConfig = role ? productRoles[role] || null : null;

      logInfo("SELECTION_DEBUG", {
        queryType,
        selectionSlots,
        selectionTags,
        role,
        usedRoleConfig: !!roleConfig,
        maxProducts: MAX_SELECTION_PRODUCTS
      });

      const broadCandidates = roleConfig
        ? findProductsByRoleConfig(roleConfig, products)
        : findRelevantProducts(selectionTags, products, MAX_SELECTION_PRODUCTS, {
            strictTagFilter: !(sessionContext.objective?.needsCompletion && isContinuation)
          });

      const hardFilterResult = applyHardFilter(broadCandidates, selectionSlots);
      logInfo("HARD_FILTER", hardFilterResult.meta);
      if (hardFilterResult.meta.applied && hardFilterResult.meta.afterCount > 0) {
        hardFilterResult.products.forEach(product => {
          const productTags = normalizeProductTags(product);
          hardFilterResult.meta.exclude.forEach(excludedTag => {
            if (productTags.includes(String(excludedTag || "").toLowerCase())) {
              logInfo("HARD_FILTER_RED_FLAG", {
                key: hardFilterResult.meta.key,
                productId: product?.id || null,
                productName: product?.name || null,
                excludedTag
              });
            }
          });
        });
      }

      if (hardFilterResult.meta.applied && hardFilterResult.meta.afterCount === 0) {
        return returnSelectionFailSafe(interactionRef, sessionId, selectionDecision, selectionSlots);
      }

      let qualityCandidates = hardFilterResult.products.filter(product => !isGenericProduct(product));
      if (qualityCandidates.length === 0) {
        const bestSolution = hardFilterResult.products.find(product => !isAccessoryProduct(product));
        if (bestSolution) {
          qualityCandidates = [bestSolution];
        }
      }

      if (qualityCandidates.length === 0) {
        return returnSelectionFailSafe(interactionRef, sessionId, selectionDecision, selectionSlots);
      }

      const rankingContext = {
        tags: roleConfig?.matchTags || selectionTags,
        priceRange: null
      };
      const rankedCandidates = applyRanking(qualityCandidates, rankingContext, settings);
      const selectedProducts = enforceProductLimit(
        rankedCandidates,
        Math.min(roleConfig?.maxProducts || MAX_SELECTION_PRODUCTS, MAX_SELECTION_PRODUCTS)
      );
      const enrichedSelectionProducts = enrichProducts(selectedProducts, products);
      const filteredSelectionProducts = filterProducts(enrichedSelectionProducts, selectionSlots);
      const selectionBundle = buildProductBundle(filteredSelectionProducts, {
        hardFilterKey: hardFilterResult?.meta?.key || null
      });
      console.log("PRODUCT_FILTER", {
        slots: selectionSlots,
        before: enrichedSelectionProducts.length,
        after: filteredSelectionProducts.length
      });
      console.log("PRODUCT_BUNDLE", {
        selected: selectionBundle.map(product => product?.name || null).filter(Boolean),
        roles: selectionBundle.map(product => product?.tags || [])
      });
      if (selectionBundle.length === 0) {
        return returnSelectionFailSafe(interactionRef, sessionId, selectionDecision, selectionSlots);
      }
      let finalProducts = selectionBundle.slice(0, MAX_SELECTION_PRODUCTS);
      finalProducts = ensureApcProductIncluded(finalProducts, products, selectionTags).slice(0, MAX_SELECTION_PRODUCTS);

      // Defensive: remove excluded-tag products that may have slipped through
      if (hardFilterResult.meta.applied && hardFilterResult.meta.exclude.length > 0) {
        finalProducts = finalProducts.filter(product => {
          const productTags = normalizeProductTags(product);
          const violatingTags = hardFilterResult.meta.exclude.filter(
            t => productTags.includes(String(t || "").toLowerCase())
          );
          if (violatingTags.length > 0) {
            logInfo("HARD_FILTER_RED_FLAG", {
              stage: "pre_format",
              key: hardFilterResult.meta.key,
              productId: product?.id || null,
              productName: product?.name || null,
              violatingTags
            });
            return false;
          }
          return true;
        });
      }

      if (finalProducts.length === 0) {
        return returnSelectionFailSafe(interactionRef, sessionId, selectionDecision, selectionSlots);
      }

      // Final check: remove any non-accessory product that violates the required gate
      if (
        (hardFilterResult.meta.requiredAny && hardFilterResult.meta.requiredAny.length > 0) ||
        (hardFilterResult.meta.requiredAllCombos && hardFilterResult.meta.requiredAllCombos.length > 0)
      ) {
        finalProducts = finalProducts.filter(product => {
          const matchesRequiredAny =
            Array.isArray(hardFilterResult.meta.requiredAny) &&
            hardFilterResult.meta.requiredAny.length > 0 &&
            matchesAnyProductTag(product, hardFilterResult.meta.requiredAny);
          const matchesRequiredAllCombo =
            Array.isArray(hardFilterResult.meta.requiredAllCombos) &&
            hardFilterResult.meta.requiredAllCombos.length > 0 &&
            hardFilterResult.meta.requiredAllCombos.some(combo => matchesAllProductTags(product, combo));
          const matchesAccessoryGate =
            hardFilterResult.meta.allowsAccessoryBypass === true &&
            isAccessoryProduct(product);
          if (!matchesRequiredAny && !matchesRequiredAllCombo && !matchesAccessoryGate) {
            logInfo("HARD_FILTER_REQUIRED_VIOLATION", {
              key: hardFilterResult.meta.key,
              productName: product?.name || null,
              tags: normalizeProductTags(product),
              requiredAny: hardFilterResult.meta.requiredAny || [],
              requiredAllCombos: hardFilterResult.meta.requiredAllCombos || [],
              allowsAccessoryBypass: hardFilterResult.meta.allowsAccessoryBypass === true
            });
            return false;
          }
          return true;
        });
      }

      if (finalProducts.length === 0) {
        return returnSelectionFailSafe(interactionRef, sessionId, selectionDecision, selectionSlots);
      }

      const solutions = finalProducts.filter(product => !isAccessoryProduct(product));
      if (solutions.length === 0) {
        return returnSelectionFailSafe(interactionRef, sessionId, selectionDecision, selectionSlots);
      }

      logInfo("SELECTION_FINAL_TAGS", {
        name: finalProducts[0]?.name || null,
        tags: normalizeProductTags(finalProducts[0])
      });

      logInfo("SELECTION_DEBUG_COUNTS", {
        broadCount: Array.isArray(broadCandidates) ? broadCandidates.length : null,
        hardApplied: hardFilterResult?.meta?.applied,
        hardKey: hardFilterResult?.meta?.key,
        hardAfterCount: hardFilterResult?.products?.length,
        qualityAfterCount: qualityCandidates.length,
        rankedCount: Array.isArray(rankedCandidates) ? rankedCandidates.length : null,
        finalCount: finalProducts.length,
        finalNames: finalProducts.map(p => p?.name).filter(Boolean)
      });

      const reply = formatSelectionResponse(finalProducts, selectionSlots);
      trackProductImpressions(finalProducts, sessionId);
      updateSessionWithProducts(sessionId, finalProducts, "recommendation");
      emit("products_recommended", { products: finalProducts, tags: roleConfig?.matchTags || selectionTags });
      emit("ai_response", { response: reply });
      logResponseSummary("product_search", { products: finalProducts.length });
      interactionRef.slots = {
        context: slotResult.slots?.context || null,
        object: slotResult.slots?.object || null,
        surface: slotResult.slots?.surface || null
      };
      interactionRef.intentType = "selection";
      return endInteraction(interactionRef, { reply, products: finalProducts }, {
        decision: selectionDecision,
        outputType: "recommendation",
        products: summarizeProductsForLog(finalProducts)
      });
    }

    if (queryType === "procedural" && previewAction === "procedural") {
      const proceduralSlots = applyObjectSlotInference(
        mergeSlots(sessionContext.slots || {}, extractSlotsFromMessage(userMessage))
      );
      const hadNoContextBeforePreviewInference = !proceduralSlots.context;
      applyObjectContextInferenceInPlace(proceduralSlots);
      let previewCorrectionMessage = null;

      // Run deterministic validation before preview disambiguation.
      // This prevents impossible or corrected combinations from bypassing validator logic.
      {
        const _previewVc = validateCombination(
          proceduralSlots.context,
          proceduralSlots.object,
          proceduralSlots.surface
        );
        const previewUserMessage = _previewVc.userMessage || null;

        if (_previewVc.correctedSlots) {
          Object.assign(proceduralSlots, _previewVc.correctedSlots);
        }

        // Re-run once after safe corrections so single-surface objects can settle.
        const _previewVc2 = _previewVc.correctedSlots
          ? validateCombination(
              proceduralSlots.context,
              proceduralSlots.object,
              proceduralSlots.surface
            )
          : _previewVc;

        if (_previewVc2.correctedSlots) {
          Object.assign(proceduralSlots, _previewVc2.correctedSlots);
        }

        const previewValidation = {
          ..._previewVc2,
          userMessage: _previewVc2.userMessage || previewUserMessage || undefined
        };

        if (!previewValidation.userMessage && hadNoContextBeforePreviewInference && proceduralSlots.object === "jante") {
          previewValidation.userMessage = "Jantele sunt la exterior. Te ajut cu curatarea lor.";
        }

        if (previewValidation.userMessage) {
          previewCorrectionMessage = previewValidation.userMessage;
          sessionContext.validationInfoMessage = previewValidation.userMessage;
        }

        logInfo("SLOT_VALIDATION_RESULT_PREVIEW", {
          inputs: {
            context: proceduralSlots.context,
            object: proceduralSlots.object,
            surface: proceduralSlots.surface
          },
          status: previewValidation.status,
          reasonCode: previewValidation.reasonCode,
          correctedSlots: previewValidation.correctedSlots || null,
          askPresent: Boolean(previewValidation.ask || previewValidation.userMessage)
        });

        if (previewValidation.status === "INVALID") {
          sessionContext.slots = proceduralSlots;
          saveSession(sessionId, sessionContext);
          const questionText = previewValidation.ask
            ? previewValidation.ask.question
            : (previewValidation.userMessage || "Nu am putut determina combinatia corecta. Poti reformula?");
          return endInteraction(interactionRef, {
            type: "question",
            message: questionText
          }, {
            slots: sessionContext.slots,
            decision: { action: "clarification", flowId: null, missingSlot: null },
            outputType: "question"
          });
        }

        if (previewValidation.status === "CORRECTABLE") {
          if (previewValidation.ask) {
            sessionContext.slots = proceduralSlots;
            saveSession(sessionId, sessionContext);
            return endInteraction(interactionRef, {
              type: "question",
              message: previewValidation.ask.question
            }, {
              slots: sessionContext.slots,
              decision: { action: "clarification", flowId: null, missingSlot: null },
              outputType: "question"
            });
          }
        }
      }

      const shouldAllowPreviewDisambiguation =
        hasStrongSlots(proceduralSlots) ||
        Boolean(sessionContext.problemType) ||
        isKnownCleaningEntry(userMessage);
      const candidateFlows = resolveFlowCandidates({
        intent,
        message: hasBugIntent ? getFlowResolverMessage(userMessage, sessionContext) : userMessage,
        slots: proceduralSlots
      });

      if (candidateFlows.length > 1 && shouldAllowPreviewDisambiguation && !previewCorrectionMessage) {
        const disambiguation = getFlowDisambiguationQuestion(candidateFlows, proceduralSlots);

        if (disambiguation) {
          sessionContext.state = disambiguation.state;
          sessionContext.originalIntent = sessionContext.originalIntent || intent;
          saveSession(sessionId, sessionContext);
          logInfo("FLOW_DISAMBIGUATION", {
            candidates: candidateFlows.map(flow => flow.flowId).filter(Boolean)
          });
          logResponseSummary("question", { products: 0 });
          return endInteraction(interactionRef, {
            type: "question",
            message: disambiguation.message
          }, {
            slots: proceduralSlots,
            decision: {
              action: "clarification",
              flowId: null,
              missingSlot: getMissingSlot(proceduralSlots) || "context"
            },
            outputType: "question"
          });
        }
      }
    }

    const storedOriginalIntent = sessionContext.originalIntent;

    const slotResult = processSlots(userMessage, intent, sessionContext, { mergeWithSession: hadPendingQuestionAtStart });
    if (queryType === "selection") {
      slotResult.slots = inferWheelsSurfaceFromObject(slotResult.slots || {});
    }
    const wasInClarification = Boolean(previousState && previousState.startsWith("NEEDS"));
    const earlyGuidedRedirectMessage = getGuidedRedirectMessage(userMessage);
    const shouldEarlySafeFallback =
      queryType === "procedural" &&
      !sessionContext.problemType &&
      !hasStrongSlots(slotResult.slots || {}) &&
      !isKnownCleaningEntry(userMessage);

    if (queryType === "procedural" && earlyGuidedRedirectMessage && !sessionContext.problemType && !hasStrongSlots(slotResult.slots || {})) {
      console.log("SAFE_FALLBACK_TRIGGERED", {
        message: userMessage,
        slots: slotResult.slots || {}
      });
      const reply = earlyGuidedRedirectMessage;
      updateSessionWithProducts(sessionId, [], "guidance");
      clearProblemType(sessionContext, sessionId);
      emit("ai_response", { response: reply });
      logResponseSummary("knowledge", { products: 0 });

      return endInteraction(interactionRef, { reply, products: [] }, {
        slots: slotResult.slots || {},
        decision: {
          action: "knowledge",
          flowId: null,
          missingSlot: null,
          safeFallback: true,
          replyOverride: earlyGuidedRedirectMessage
        },
        outputType: "reply"
      });
    }

    if (shouldEarlySafeFallback) {
      console.log("SAFE_FALLBACK_TRIGGERED", {
        message: userMessage,
        slots: slotResult.slots || {}
      });
      const reply = getSafeFallbackReply();
      updateSessionWithProducts(sessionId, [], "guidance");
      clearProblemType(sessionContext, sessionId);
      emit("ai_response", { response: reply });
      logResponseSummary("knowledge", { products: 0 });

      return endInteraction(interactionRef, { reply, products: [] }, {
        slots: slotResult.slots || {},
        decision: {
          action: "knowledge",
          flowId: null,
          missingSlot: null,
          safeFallback: true
        },
        outputType: "reply"
      });
    }

    // ROUTING PURITY: Apply explicit context before any defaulting.
    if (queryType === "procedural" && !slotResult.slots.context) {
      const explicitContext = detectExplicitContext(userMessage);
      
      if (explicitContext !== null) {
        slotResult.slots.context = explicitContext;
        logInfo("SLOT_INFERENCE_EXPLICIT_CONTEXT", {
          context: explicitContext,
          message: userMessage
        });
        logInfo("SLOT_INFERENCE", { 
          context: explicitContext, 
          reason: "explicit_context_keyword"
        });
      } else {
        const strongContextOverride = detectStrongContextOverride(userMessage);

        if (strongContextOverride) {
          slotResult.slots.context = strongContextOverride.context;
          if (!slotResult.slots.object && strongContextOverride.object) {
            slotResult.slots.object = strongContextOverride.object;
          }
          if (!slotResult.slots.surface && strongContextOverride.surface) {
            slotResult.slots.surface = strongContextOverride.surface;
          }
          logInfo("SLOT_INFERENCE", {
            context: strongContextOverride.context,
            reason: strongContextOverride.reason
          });
        } else {
          slotResult.slots.context = null;
          logInfo("SLOT_INFERENCE", { 
            context: null,
            reason: "default_unknown" 
          });
        }
      }
    }

    const explicitContext = queryType === "procedural"
      ? detectExplicitContext(userMessage)
      : null;

    // ROUTING PURITY: Guard rule - explicit interior must never degrade to exterior.
    if (explicitContext === "interior" && slotResult.slots.context === "exterior") {
      console.warn("ROUTING_PURITY_VIOLATION", {
        message: userMessage,
        currentContext: slotResult.slots.context,
        explicitContext,
        fix: "correcting_to_interior"
      });
      slotResult.slots.context = "interior";
      logInfo("ROUTING_PURITY_CORRECTED", {
        violation: "explicit_interior_overridden_to_exterior",
        message: userMessage,
        correctedContext: "interior"
      });
    }
    if (isHardReset(userMessage)) {
      sessionContext.slots = {};
      sessionContext.state = null;
      sessionContext.pendingQuestion = null;
    }
    const pendingBeforeSlotUpdate = sessionContext.pendingQuestion
      ? { ...sessionContext.pendingQuestion }
      : null;
    sessionContext.objective.slots = {
      ...sessionContext.objective.slots,
      ...slotResult.slots
    };
    const slotMode = isSafetyQuery(userMessage) ? "override" : hadPendingQuestionAtStart ? "merge" : "replace";
    const beforeSlots = { ...(sessionContext.slots || {}) };
    console.log("SLOT_MODE", {
      mode: slotMode
    });
    if (slotMode === "override") {
      const freshSlots = extractSlotsForSafetyQuery(userMessage);
      console.log("SAFETY_SLOT_EXTRACTION", {
        message: userMessage,
        extracted: freshSlots
      });
      console.log("SLOT_OVERRIDE_APPLIED", {
        previousSlots: beforeSlots,
        newSlots: freshSlots,
        finalSlots: freshSlots
      });
      sessionContext.slots = freshSlots;
    } else {
      sessionContext.slots = slotMode === "merge"
        ? mergeSlots(sessionContext.slots || {}, slotResult.slots || {})
        : (slotResult.slots || {});
    }
    if (isPendingQuestionFulfilled(pendingBeforeSlotUpdate, sessionContext.slots)) {
      sessionContext.pendingQuestion = null;
      console.log("PENDING_CLEARED", {
        previous: pendingBeforeSlotUpdate,
        slots: sessionContext.slots
      });
      logInfo("PENDING_QUESTION_TRANSITION", {
        reason: "slot_fulfilled",
        pendingQuestion: null,
        slots: sessionContext.slots
      });
    }
    console.log("SLOT_UPDATE", {
      mode: slotMode,
      before: beforeSlots,
      after: sessionContext.slots
    });
    if (
      slotMode !== "override" &&
      sessionContext.slots?.context === "exterior" &&
      !sessionContext.slots?.object &&
      !hasPersistedBugIntent(userMessage, sessionContext)
    ) {
      sessionContext.slots.object = "caroserie";
    }

    applyObjectContextInferenceInPlace(sessionContext.slots);

    // --- Deterministic slot validation ---
    {
      const _vc = validateCombination(
        sessionContext.slots.context,
        sessionContext.slots.object,
        sessionContext.slots.surface
      );
      logInfo("SLOT_VALIDATION_RESULT", {
        inputs: {
          context: sessionContext.slots.context,
          object: sessionContext.slots.object,
          surface: sessionContext.slots.surface
        },
        status: _vc.status,
        reasonCode: _vc.reasonCode,
        correctedSlots: _vc.correctedSlots || null,
        askPresent: Boolean(_vc.ask || _vc.userMessage)
      });

      if (_vc.status !== "VALID") {
        // Apply any safe slot corrections first
        if (_vc.correctedSlots) {
          Object.assign(sessionContext.slots, _vc.correctedSlots);
        }

        if (_vc.status === "INVALID") {
          // Do not proceed to normal routing
          saveSession(sessionId, sessionContext);
          const invalidDecision = createCanonicalRoutingDecision({
            queryType,
            action: "clarification",
            reason: _vc.reasonCode,
            slots: sessionContext.slots,
            flowId: null,
            missingSlot: null,
            pendingSelectionState: null
          });
          logInfo("ROUTING_DECISION", invalidDecision);
          logInfo("EXECUTION_PATH", { action: "clarification", flowId: null });
          const questionText = _vc.ask
            ? _vc.ask.question
            : (_vc.userMessage || "Nu am putut determina combinatia corecta. Poti reformula?");
          return endInteraction(interactionRef, {
            type: "question",
            message: questionText
          }, {
            slots: sessionContext.slots,
            decision: { action: "clarification", flowId: null, missingSlot: null },
            outputType: "question"
          });
        }

        if (_vc.status === "CORRECTABLE") {
          if (_vc.ask) {
            // Partially resolved – still needs one more clarification
            saveSession(sessionId, sessionContext);
            const correctableDecision = createCanonicalRoutingDecision({
              queryType,
              action: "clarification",
              reason: _vc.reasonCode,
              slots: sessionContext.slots,
              flowId: null,
              missingSlot: null,
              pendingSelectionState: null
            });
            logInfo("ROUTING_DECISION", correctableDecision);
            logInfo("EXECUTION_PATH", { action: "clarification", flowId: null });
            return endInteraction(interactionRef, {
              type: "question",
              message: _vc.ask.question
            }, {
              slots: sessionContext.slots,
              decision: { action: "clarification", flowId: null, missingSlot: null },
              outputType: "question"
            });
          }

          if (_vc.userMessage) {
            // Informational correction only. No confirmation. Do not block routing.
            logInfo("SLOT_VALIDATION_INFO_MESSAGE", {
              reasonCode: _vc.reasonCode,
              message: _vc.userMessage
            });
            sessionContext.validationInfoMessage = _vc.userMessage;
            saveSession(sessionId, sessionContext);
          }
          // Fall through to normal routing (correctedSlots already applied above)
        }
      }
    }
    // --- End slot validation ---

    console.log("SLOT_CHECK_SOURCE", sessionContext.slots);
    slotResult.missing = getMissingSlot(sessionContext.slots);

    const completedSlotFollowUp =
      ["NEEDS_CONTEXT", "NEEDS_OBJECT", "NEEDS_SURFACE"].includes(previousState) &&
      slotResult.missing === null;

    if (!slotResult.missing) {
      sessionContext.state = null;
      sessionContext.pendingQuestion = null;
    }
    if (!sessionContext.slots || typeof sessionContext.slots !== "object") {
      throw new Error("Slots not initialized");
    }
    console.log("SLOT_SOURCE_CHECK", {
      slotsUsed: sessionContext.slots
    });
    routingDecision = routeRequest({
      queryType,
      message: userMessage,
      slots: sessionContext.slots
    });
    if (sessionContext.state && sessionContext.state.startsWith("NEEDS_")) {
      logInfo("FORCE_CONTINUATION_MODE", {
        state: sessionContext.state
      });
    }
    sessionContext.activeIntent = routingDecision.action;
    sessionContext.objective.type = routingDecision.action;
    saveSession(sessionId, sessionContext);
    const problemType = sessionContext.problemType || null;
    const resolvedAction = enforceClarificationContract(resolveAction({
      problemType,
      message: {
        text: userMessage,
        routingDecision
      },
      slots: sessionContext.slots || {},
    }));
    const originalResolvedAction = JSON.stringify(resolvedAction);
    assertMissingSlotInvariant(resolvedAction, sessionContext.slots || {});
    if (!resolvedAction || !resolvedAction.action) {
      throw new Error("Invalid decision: resolveAction must return action");
    }

    // ROUTING PURITY: Pending clarification isolation
    // If in a NEEDS_* state (awaiting clarification), only allow:
    // 1. Clarification continuation, or
    // 2. Handling the completed slot (state cleared above)
    // Do not re-route through full flow matching on follow-ups
    if (previousState && previousState.startsWith("NEEDS_")) {
      const pendingSlotFilled = slotResult.missing === null && completedSlotFollowUp;
      if (!pendingSlotFilled && slotResult.missing) {
        logInfo("PENDING_CLARIFICATION_ISOLATION_ENFORCED", {
          previousState,
          action: resolvedAction.action,
          missingSlot: slotResult.missing,
          message: "Clarification remains required because data is still missing"
        });
        resolvedAction.action = "clarification";
        resolvedAction.flowId = null;
        resolvedAction.missingSlot = slotResult.missing;
      } else if (pendingSlotFilled) {
        logInfo("PENDING_CLARIFICATION_SATISFIED", {
          previousState,
          slotFilled: slotResult.missing === null
        });
      }
    }

    // ROUTING PURITY: Correction handling must be driven by recomputed missing data.
    let mutationComputedMissingSlot = null;
    if (previousState && previousState.startsWith("NEEDS_") && isNegationCorrection(userMessage)) {
      const decisionBeforeCorrection = { ...resolvedAction };
      mutationComputedMissingSlot = getMissingSlot(sessionContext.slots || {});
      logInfo("CORRECTION_DETECTED", {
        message: userMessage,
        previousState,
        action: "recompute_missing_slot",
        computedMissingSlot: mutationComputedMissingSlot
      });
      if (resolvedAction.action === "flow" || resolvedAction.action === "selection") {
        const normalizedMissingSlot = mutationComputedMissingSlot;

        if (normalizedMissingSlot) {
          resolvedAction.action = "clarification";
          resolvedAction.flowId = null;
          resolvedAction.missingSlot = normalizedMissingSlot;
        } else {
          resolvedAction.action = decisionBeforeCorrection.action;
          resolvedAction.flowId = decisionBeforeCorrection.flowId || null;
          resolvedAction.missingSlot = decisionBeforeCorrection.missingSlot || null;
        }

        console.warn("DECISION_MUTATION_DETECTED", {
          before: decisionBeforeCorrection,
          after: resolvedAction,
          computedMissingSlot: mutationComputedMissingSlot
        });
      }
    }

    if (resolvedAction.action === "clarification") {
      const computedMissingSlot = getMissingSlot(sessionContext.slots || {});
      let normalizedMissingSlot = computedMissingSlot || null;

      if (normalizedMissingSlot === "surface" && sessionContext?.slots?.surface) {
        logInfo("MISSING_SLOT_SURFACE_GUARD", {
          active: true,
          correctedTo: null,
          slots: sessionContext.slots || {}
        });
        normalizedMissingSlot = null;
      }

      if (normalizedMissingSlot) {
        resolvedAction.flowId = null;
        resolvedAction.missingSlot = normalizedMissingSlot;
      } else if (resolvedAction.flowId) {
        resolvedAction.action = "flow";
        resolvedAction.missingSlot = null;
      } else if (routingDecision.action === "selection") {
        resolvedAction.action = "selection";
        resolvedAction.missingSlot = null;
      } else if (routingDecision.action === "procedural") {
        resolvedAction.action = "procedural";
        resolvedAction.missingSlot = null;
      }
    }

    if (selectionEscalation) {
      resolvedAction.action = "selection";
      resolvedAction.flowId = null;
      resolvedAction.missingSlot = null;
    }

    logInfo("SELECTION_ESCALATION_ROUTING", {
      previousAction,
      selectionEscalation,
      matchedTrigger: selectionEscalationTrigger || null,
      finalAction: resolvedAction.action
    });

    // Create canonical routing decision for logging (fulfills requirement)
    const canonicalRoutingDecision = createCanonicalRoutingDecision({
      queryType,
      action: resolvedAction.action,
      reason: routingDecision.reason,
      slots: sessionContext.slots || {},
      flowId: resolvedAction.flowId || null,
      missingSlot: resolvedAction.missingSlot || null,
      pendingSelectionState: sessionContext.pendingSelection === true ? sessionContext.pendingSelectionMissingSlot : null
    });

    logInfo("ROUTING_DECISION", canonicalRoutingDecision);

    console.log("DECISION_FINAL", resolvedAction);
    logInfo("DECISION_SOURCE", { source: "resolveAction", decision: resolvedAction });
    console.log("STAGE:RESOLVE", resolvedAction);
    if (JSON.stringify(resolvedAction) !== originalResolvedAction) {
      console.warn("DECISION_MUTATION_DETECTED", {
        before: originalResolvedAction,
        after: resolvedAction,
        computedMissingSlot: mutationComputedMissingSlot ?? getMissingSlot(sessionContext.slots || {})
      });
    }
    if (resolvedAction.action === "flow") {
      if (!resolvedAction.flowId || typeof resolvedAction.flowId !== "string") {
        console.error("INVARIANT_FAILURE", {
          decision: resolvedAction,
          slots: sessionContext.slots || {},
          message: userMessage
        });
        throw new Error("INVALID STATE: flow without valid flowId");
      }
    }
    logInfo("FINAL_ACTION", {
      action: resolvedAction.action,
      routing: routingDecision.action,
      slots: sessionContext.slots,
      flowId: resolvedAction.flowId,
      missingSlot: resolvedAction.missingSlot
    });
    logInfo("DECISION_TRACE", {
      canonicalObject: canonicalizeObjectValue(sessionContext.slots?.object),
      context: sessionContext.slots?.context || null,
      selectedFlowId: resolvedAction.flowId || null,
      reason: routingDecision.reason || null
    });
    interactionRef.decision = {
      action: resolvedAction.action,
      flowId: resolvedAction.flowId,
      reason: routingDecision.reason,
      missingSlot: resolvedAction.missingSlot || null
    };

    if (resolvedAction.action === "knowledge" || resolvedAction.action === "safety") {
      sessionContext = clearProceduralStateForKnowledgeBoundary(sessionContext, sessionId);
    }

    logInfo("ROUTER_DECISION", routingDecision);
    logInfo("SLOTS", {
      context: sessionContext.slots?.context || null,
      surface: sessionContext.slots?.surface || null,
      object: sessionContext.slots?.object || null
    });

    interactionRef.slots = {
      context: sessionContext.slots?.context || null,
      object: sessionContext.slots?.object || null,
      surface: sessionContext.slots?.surface || null
    };

    // Log execution path (fulfills requirement for single execution path per request)
    logInfo("EXECUTION_PATH", {
      action: resolvedAction.action,
      flowId: resolvedAction.flowId || null,
      reason: "routing_decision_finalized"
    });

    let shouldHandleClarification = false;
    let shouldAllowSelection = false;
    let shouldAllowProcedural = false;
    let shouldAllowKnowledge = false;
    let shouldForceSafety = false;

    switch (resolvedAction.action) {
      case "clarification":
        shouldHandleClarification = true;
        break;
      case "selection":
        shouldAllowSelection = true;
        break;
      case "procedural":
        shouldAllowProcedural = true;
        break;
      case "knowledge":
        shouldAllowKnowledge = true;
        break;
      case "safety":
        shouldForceSafety = true;
        break;
      default:
        break;
    }

    if (resolvedAction.action === "knowledge" && resolvedAction.safeFallback) {
      console.log("SAFE_FALLBACK_TRIGGERED", {
        message: userMessage,
        slots: sessionContext.slots || {}
      });

      const reply = resolvedAction.replyOverride || getSafeFallbackReply();
      updateSessionWithProducts(sessionId, [], "guidance");
      clearProblemType(sessionContext, sessionId);
      emit("ai_response", { response: reply });
      logResponseSummary("knowledge", { products: 0 });

      return endInteraction(interactionRef, { reply, products: [] }, {
        decision: {
          action: "knowledge",
          flowId: null,
          missingSlot: null,
          safeFallback: true,
          replyOverride: resolvedAction.replyOverride || null
        },
        outputType: "reply"
      });
    }

      if (resolvedAction.action === "clarification" && shouldHandleClarification && resolvedAction.missingSlot === "context") {
      sessionContext.state = "NEEDS_CONTEXT";
      logInfo("FLOW", getFlowLogPayload(intent, slotResult.slots, null, "missing_context"));

      const contextHint = detectContextHint(userMessage);
      if (contextHint === "interior") {
        sessionContext.pendingQuestion = {
          type: "confirm_context",
          value: "interior",
          slot: "context",
          object: sessionContext.slots?.object || null,
          context: sessionContext.slots?.context || null
        };
        logInfo("PENDING_QUESTION_TRANSITION", {
          reason: "ask_context_confirmation",
          pendingQuestion: sessionContext.pendingQuestion
        });
        if (queryType === "selection") {
          sessionContext.originalIntent = "selection";
          sessionContext.pendingSelection = true;
          sessionContext.pendingSelectionMissingSlot = "context";
        }
        saveSession(sessionId, sessionContext);
        logResponseSummary("question", { products: 0 });
        return endInteraction(interactionRef, {
          type: "question",
          message: "Este vorba despre interior (cotiera), corect?"
        }, {
          decision: resolvedAction,
          outputType: "question"
        });
      }

      if (contextHint === "exterior") {
        sessionContext.pendingQuestion = {
          type: "confirm_context",
          value: "exterior",
          slot: "context",
          object: sessionContext.slots?.object || null,
          context: sessionContext.slots?.context || null
        };
        logInfo("PENDING_QUESTION_TRANSITION", {
          reason: "ask_context_confirmation",
          pendingQuestion: sessionContext.pendingQuestion
        });
        if (queryType === "selection") {
          sessionContext.originalIntent = "selection";
          sessionContext.pendingSelection = true;
          sessionContext.pendingSelectionMissingSlot = "context";
        }
        saveSession(sessionId, sessionContext);
        logResponseSummary("question", { products: 0 });
        return endInteraction(interactionRef, {
          type: "question",
          message: "Este vorba despre exterior, corect?"
        }, {
          decision: resolvedAction,
          outputType: "question"
        });
      }

      sessionContext.pendingQuestion = {
        slot: "context",
        object: sessionContext.slots?.object || null,
        context: sessionContext.slots?.context || null
      };
      logInfo("PENDING_QUESTION_TRANSITION", {
        reason: "ask_context",
        pendingQuestion: sessionContext.pendingQuestion
      });
      if (queryType === "selection") {
        sessionContext.originalIntent = "selection";
        sessionContext.pendingSelection = true;
        sessionContext.pendingSelectionMissingSlot = "context";
      }
      saveSession(sessionId, sessionContext);
      logResponseSummary("question", { products: 0 });

      return endInteraction(interactionRef, {
        type: "question",
        message: getClarificationQuestion("context", sessionContext.slots || {})
      }, {
        decision: resolvedAction,
        outputType: "question"
      });
    }

    if (resolvedAction.action === "clarification" && shouldHandleClarification && resolvedAction.missingSlot === "object") {
      sessionContext.state = "NEEDS_OBJECT";
      sessionContext.originalIntent = sessionContext.originalIntent || intent;
      if (queryType === "selection") {
        sessionContext.originalIntent = "selection";
        sessionContext.pendingSelection = true;
        sessionContext.pendingSelectionMissingSlot = "object";
      }
      sessionContext.pendingQuestion = {
        slot: "object",
        object: sessionContext.slots?.object || null,
        context: sessionContext.slots?.context || null
      };
      logInfo("PENDING_QUESTION_TRANSITION", {
        reason: "ask_object",
        pendingQuestion: sessionContext.pendingQuestion
      });
      saveSession(sessionId, sessionContext);
      logInfo("FLOW", getFlowLogPayload(intent, slotResult.slots, null, "missing_object"));

      const allowedObjects = getAllowedObjects(slotResult.slots);
      const options = allowedObjects.join(", ");

      logResponseSummary("question", { products: 0 });
      return endInteraction(interactionRef, {
        type: "question",
        message: `Ce obiect vrei sa cureti? (${options})`
      }, {
        decision: resolvedAction,
        outputType: "question"
      });
    }

    if (resolvedAction.action === "clarification" && shouldHandleClarification && resolvedAction.missingSlot === "surface") {
      sessionContext.state = "NEEDS_SURFACE";
      sessionContext.originalIntent = sessionContext.originalIntent || intent;
      if (queryType === "selection") {
        sessionContext.originalIntent = "selection";
        sessionContext.pendingSelection = true;
        sessionContext.pendingSelectionMissingSlot = "surface";
      }
      sessionContext.pendingQuestion = {
        slot: "surface",
        object: sessionContext.slots?.object || null,
        context: sessionContext.slots?.context || null
      };
      logInfo("PENDING_QUESTION_TRANSITION", {
        reason: "ask_surface",
        pendingQuestion: sessionContext.pendingQuestion
      });
      saveSession(sessionId, sessionContext);
      logInfo("FLOW", getFlowLogPayload(intent, slotResult.slots, null, "missing_surface"));

      const allowedSurfaces = getAllowedSurfaces(slotResult.slots);
      const labelMap = {
        textile: "textil",
        leather: "piele",
        alcantara: "alcantara",
        plastic: "plastic",
        paint: "vopsea",
        wheels: "jante",
        glass: "geamuri"
      };
      const options = allowedSurfaces.map(surface => labelMap[surface] || surface).join(", ");

      logResponseSummary("question", { products: 0 });
      return endInteraction(interactionRef, {
        type: "question",
        message: `Pe ce suprafata? (${options})`
      }, {
        decision: resolvedAction,
        outputType: "question"
      });
    }

    sessionContext.state = "READY";
    sessionContext.context = slotResult.slots.context;
    saveSession(sessionId, sessionContext);

    const finalTags = sanitizeTagsForMessage(
      userMessage,
      buildFinalTags(coreTags, workingTags, slotResult.slots),
      slotResult.slots || {}
    );

    sessionContext.tags = finalTags;
    saveSession(sessionId, sessionContext);

    const decisionContext = normalizeDecision(userMessage, resolvedEffectiveIntentResult, sessionContext, finalTags);
    intent = decisionContext.intent;

    if (completedSlotFollowUp) {
      const restoredIntent = storedOriginalIntent || "product_guidance";
      intent = restoredIntent;
      decisionContext.intent = restoredIntent;
      decisionContext.isFollowUp = true;
      sessionContext.originalIntent = null;
      saveSession(sessionId, sessionContext);
    } else if (decisionContext.isFollowUp && decisionContext.state === "READY") {
      intent = "product_guidance";
      decisionContext.intent = "product_guidance";
    }

    interactionRef.intentType = intent;
    interactionRef.tags = finalTags;

    let strategy = resolveStrategy(
      decisionContext,
      { tags: finalTags, message: userMessage },
      settings,
      sessionId
    );

    if (completedSlotFollowUp) {
      strategy = "guidance";
    } else if (decisionContext.isFollowUp && decisionContext.state === "READY") {
      strategy = "guidance";
    }

    console.log("STAGE:EXECUTE_INPUT", {
      action: resolvedAction.action,
      flowId: resolvedAction.flowId,
      slots: sessionContext.slots || {}
    });

    console.log("EXECUTION_PATH", {
      action: resolvedAction.action
    });

    switch (resolvedAction.action) {
      case "flow": {
        const normalizedFlowId = typeof resolvedAction.flowId === "string"
          ? resolvedAction.flowId.trim()
          : resolvedAction.flowId;

        if (!normalizedFlowId) {
          throw new Error("Invalid decision: flow without flowId");
        }

        const flowRegistry = config?.flows && typeof config.flows === "object"
          ? config.flows
          : {};
        console.log("FLOW_REGISTRY_KEYS", Object.keys(flowRegistry));
        console.log("FLOW_LOOKUP", { requested: normalizedFlowId, type: typeof normalizedFlowId });
        const resolvedPrioritizedFlow = !shouldForceSafety
          ? flowRegistry[normalizedFlowId] || null
          : null;

        console.log("FLOW_SELECTED", {
          flowId: normalizedFlowId,
          exists: !!resolvedPrioritizedFlow
        });

        if (!resolvedPrioritizedFlow) {
          console.log("FLOW_REGISTRY_FULL", flowRegistry);
          throw new Error("Flow not found: " + normalizedFlowId);
        }

        const flowId = resolvedAction.flowId;
        const executedFlowDecision = resolvedAction;

        const flowResult = executeFlow(resolvedPrioritizedFlow, products, sessionContext.slots || {});
        const rawFlowProducts = Array.isArray(flowResult?.products) ? flowResult.products : [];
        const filteredFlowProducts = filterProducts(rawFlowProducts, sessionContext.slots || {});
        const flowBundle = buildProductBundle(filteredFlowProducts);
        const flowReply = buildMinimalFlowReply(resolvedPrioritizedFlow, flowResult);
        console.log("PRODUCT_FILTER", {
          slots: sessionContext.slots || {},
          before: rawFlowProducts.length,
          after: filteredFlowProducts.length
        });
        console.log("PRODUCT_BUNDLE", {
          selected: flowBundle.map(product => product?.name || null).filter(Boolean),
          roles: flowBundle.map(product => product?.tags || [])
        });
        const flowProducts = flowBundle.slice(0, 3);
        interactionRef.decision = executedFlowDecision;
        logInfo("FLOW_EXECUTED", {
          flowId,
          slots: sessionContext.slots || {}
        });
        if (flowId === "bug_removal_quick") {
          sessionContext.intentFlags = sessionContext.intentFlags || {};
          sessionContext.intentFlags.bug = false;
          saveSession(sessionId, sessionContext);
        }
        clearProblemType(sessionContext, sessionId);
        updateSessionWithProducts(sessionId, flowProducts, "guidance");
        const _flowPrefix = consumeValidationInfo(sessionContext, sessionId);
        const prefixedFlowReply = _flowPrefix ? `${_flowPrefix}\n\n${flowReply}` : flowReply;
        emit("ai_response", { response: prefixedFlowReply });
        logResponseSummary("flow", {
          steps: Array.isArray(resolvedPrioritizedFlow.steps) ? resolvedPrioritizedFlow.steps.length : 0,
          products: flowProducts.length
        });
        return endInteraction(interactionRef, {
          type: "flow",
          message: prefixedFlowReply,
          reply: prefixedFlowReply,
          products: flowProducts
        }, {
          decision: executedFlowDecision,
          outputType: "flow",
          products: summarizeProductsForLog(flowProducts)
        });
      }

      case "clarification": {
        const clarificationSlot = resolvedAction.missingSlot || null;
        const clarificationMessage = getClarificationQuestion(clarificationSlot, sessionContext.slots || {});

        return endInteraction(interactionRef, {
          type: "question",
          message: clarificationMessage
        }, {
          decision: {
            action: "clarification",
            flowId: null,
            missingSlot: clarificationSlot
          },
          outputType: "question"
        });
      }

      case "recommend":
      case "knowledge":
      case "safety":
      case "selection":
      case "procedural":
        break;

      default:
        throw new Error("Unknown decision.action: " + resolvedAction.action);
    }

    // PRIORITY OVERRIDE: Safety / guidance strategies bypass product search ranking
    if (
      (resolvedAction.action === "safety" && (shouldForceSafety || decisionContext.isSafety)) ||
      (resolvedAction.action === "knowledge" && shouldAllowKnowledge && strategy === "guidance")
    ) {
      const isSafetyRoute = resolvedAction.action === "safety";
      const isKnowledgeRoute = resolvedAction.action === "knowledge";
      const fallbackReason = isSafetyRoute ? "safety_mode" : "guidance_strategy";
      logInfo("FLOW", getFlowLogPayload(intent, sessionContext.slots || {}, null, fallbackReason));
      logInfo("DECISION", { type: "knowledge", fallbackReason });

      const safeMessage =
        typeof message === "string"
          ? message
          : JSON.stringify(message || "");

      const guidanceType = isSafetyRoute
        ? "safety"
        : detectGuidanceType(safeMessage);

      let knowledgeContext = "";
      if (hasRequiredKnowledgeSlots(safeMessage, sessionContext.slots || {})) {
        const matchedKnowledge = getRelevantKnowledge(safeMessage, knowledgeBase, finalTags, sessionContext.slots || {});
        if (matchedKnowledge.length > 0) {
          knowledgeContext = matchedKnowledge.map(k => k.content).join("\n");
        }
      }

      const isFirstGuidanceAfterClarification =
        strategy === "guidance" &&
        completedSlotFollowUp &&
        sessionContext.state === "READY";
      const explicitProductRequest = isExplicitProductRequest(userMessage);
      const shouldInjectProducts =
        isSafetyRoute ||
        (!isKnowledgeRoute && (!isFirstGuidanceAfterClarification || explicitProductRequest));

      let safetyProducts = [];
      if (shouldInjectProducts) {
        safetyProducts = findRelevantProducts(finalTags, products, settings.max_products || 3);
        safetyProducts = enforceProductLimit(safetyProducts, settings.max_products || 3);
        const filteredSafetyProducts = filterProducts(safetyProducts, sessionContext.slots || {});
        const safetyBundle = buildProductBundle(filteredSafetyProducts);
        console.log("PRODUCT_FILTER", {
          slots: sessionContext.slots || {},
          before: safetyProducts.length,
          after: filteredSafetyProducts.length
        });
        console.log("PRODUCT_BUNDLE", {
          selected: safetyBundle.map(product => product?.name || null).filter(Boolean),
          roles: safetyBundle.map(product => product?.tags || [])
        });
        if (safetyBundle.length < 2) {
          const reply = getSafeFallbackReply();
          updateSessionWithProducts(sessionId, [], "guidance");
          clearProblemType(sessionContext, sessionId);
          emit("ai_response", { response: reply });
          logResponseSummary("knowledge", { products: 0 });
          return endInteraction(interactionRef, { reply, products: [] }, {
            decision: {
              action: "knowledge",
              flowId: null,
              missingSlot: null,
              safeFallback: true
            },
            outputType: "reply"
          });
        }
        safetyProducts = safetyBundle.slice(0, 3);
      }

      const effectiveStrategy = isSafetyRoute ? "safety" : strategy;
      const prompt = createOptimizedPrompt(userMessage, safetyProducts, settings, finalTags, effectiveStrategy, language, guidanceType, knowledgeContext, sessionContext.slots || {});
      const reply = await askLLM(prompt);

      if (safetyProducts.length > 0) {
        trackProductImpressions(safetyProducts, sessionId);
        updateSessionWithProducts(sessionId, safetyProducts, "recommendation");
        emit("products_recommended", { products: safetyProducts, tags: finalTags });
      } else {
        updateSessionWithProducts(sessionId, [], "guidance");
      }
      clearProblemType(sessionContext, sessionId);
      const _safetyPrefix = consumeValidationInfo(sessionContext, sessionId);
      const prefixedSafetyReply = _safetyPrefix ? `${_safetyPrefix}\n\n${reply}` : reply;
      emit("ai_response", { response: prefixedSafetyReply });
      logResponseSummary("knowledge", { products: safetyProducts.length });
      return endInteraction(interactionRef, { reply: prefixedSafetyReply, products: safetyProducts }, {
        decision: {
          action: isSafetyRoute ? "safety" : "knowledge",
          flowId: null,
          missingSlot: null
        },
        outputType: safetyProducts.length > 0 ? "recommendation" : "reply",
        products: summarizeProductsForLog(safetyProducts)
      });
    }

    // Handle support intents before any product/LLM logic
    if (["order_status", "order_update", "order_cancel"].includes(intent)) {
      info(SOURCE, `Routing to support flow: ${intent}`);
      const supportResponse = await supportService.handle(intent, userMessage, session);
      return endInteraction(interactionRef, supportResponse, {
        decision: { action: "support", flowId: null, missingSlot: null },
        outputType: "reply",
        products: []
      });
    }

    const guidanceProducts = Array.isArray(sessionActiveProducts)
      ? sessionActiveProducts
      : [];
    const hasActiveProducts = guidanceProducts.length > 0;
    const isShortFollowUpWithProducts = hasActiveProducts && isShortFollowUpMessage(userMessage);
    const shouldUseGuidance = intent === "product_guidance" || isShortFollowUpWithProducts;

    if (resolvedAction.action === "knowledge" && shouldAllowKnowledge && shouldUseGuidance) {
      const guidanceTags = finalTags;
      let knowledgeContext = "";
      if (hasRequiredKnowledgeSlots(userMessage, sessionContext.slots || {})) {
        const knowledgeResults = getRelevantKnowledge(userMessage, knowledgeBase, guidanceTags, sessionContext.slots || {});
        knowledgeContext = knowledgeResults.map(k => k.content).join("\n");
      }

      logInfo("DECISION", { type: "knowledge", fallbackReason: getFlowLogPayload(intent, sessionContext.slots || {}, null).reason });

      const prompt = createOptimizedPrompt(userMessage, [], settings, guidanceTags, "guidance", language, "general", knowledgeContext, sessionContext.slots || {});
      const reply = await askLLM(prompt);

      updateSessionWithProducts(sessionId, [], "guidance");
      clearProblemType(sessionContext, sessionId);

      const _kgPrefix = consumeValidationInfo(sessionContext, sessionId);
      const prefixedKgReply = _kgPrefix ? `${_kgPrefix}\n\n${reply}` : reply;
      emit("ai_response", { response: prefixedKgReply });
      logResponseSummary("knowledge", { products: 0 });
      return endInteraction(interactionRef, { reply: prefixedKgReply, products: [] }, {
        decision: { action: "knowledge", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }

    // Handle greeting separately
    const greetingRules = settings.conversation_rules?.greeting || {};
    if (intent === "greeting" && greetingRules.enabled) {
      info(SOURCE, "Handling greeting via configured conversation_rules");

      const productsForGreeting = greetingRules.show_products
        ? applyFallbackProducts(products)
        : [];

      // Update session for greeting
      updateSessionWithProducts(sessionId, productsForGreeting, "guidance");

      emit("ai_response", { response: greetingRules.response || "Salut! Cu ce te pot ajuta?" });
      return endInteraction(interactionRef, {
        reply: greetingRules.response || "Salut! Cu ce te pot ajuta?",
        products: productsForGreeting
      }, {
        decision: { action: "greeting", flowId: null, missingSlot: null },
        outputType: productsForGreeting.length > 0 ? "recommendation" : "reply",
        products: summarizeProductsForLog(productsForGreeting)
      });
    }

    // Step 4: Build context for decision making
    if (
      resolvedAction.action !== "selection" &&
      resolvedAction.action !== "safety" &&
      resolvedAction.action !== "clarification"
    ) {
      const context = {
        intent,
        queryType,
        activeProducts: sessionActiveProducts,
        session: sessionContext,
        message: userMessage,
        availableTags: availableProductTags
      };

      if (!shouldPreserveFollowUpState && isNewSearch(userMessage)) {
        sessionContext.activeProducts = [];
        sessionContext.tags = [];
        sessionContext.intent = null;
        sessionContext.state = "IDLE";
        saveSession(sessionId, sessionContext);

        context.activeProducts = sessionContext.activeProducts;
        context.session = sessionContext;
      }

      interactionRef.decision = resolvedAction;

      // BRANCHING LOGIC BASED ON DECISION
      if (resolvedAction.action === "knowledge") {
        logInfo("DECISION", { type: "knowledge", fallbackReason: "decision_service_guide" });

        let knowledgeContext = "";
        if (hasRequiredKnowledgeSlots(userMessage, sessionContext.slots || {})) {
          const knowledgeResults = getRelevantKnowledge(userMessage, knowledgeBase, finalTags, sessionContext.slots || {});
          knowledgeContext = knowledgeResults.map(k => k.content).join("\n");
        }

        const prompt = createOptimizedPrompt(userMessage, [], settings, finalTags, "guidance", language, "general", knowledgeContext, sessionContext.slots || {});
        const reply = await askLLM(prompt);

        updateSessionWithProducts(sessionId, [], "guidance");

        const _kdPrefix = consumeValidationInfo(sessionContext, sessionId);
        const prefixedKdReply = _kdPrefix ? `${_kdPrefix}\n\n${reply}` : reply;
        emit("ai_response", { response: prefixedKdReply });
        logResponseSummary("knowledge", { products: 0 });
        return endInteraction(interactionRef, { reply: prefixedKdReply, products: [] }, {
          decision: resolvedAction,
          outputType: "reply"
        });

      } else {
        logInfo("FLOW", getFlowLogPayload(intent, sessionContext.slots || {}, null));
        logInfo("DECISION", { type: "product_search" });

        // Step 6: Detect intent (tags) from user message
        const detectedTags = finalTags;

        // Check if clarification is needed (no tags detected)
        if (detectedTags.length === 0) {
          logInfo("DECISION", { type: "product_search", fallbackReason: "no_tags" });
          const clarificationResponse = generateFallbackResponse(userMessage, settings, availableProductTags);
          updateSessionWithProducts(sessionId, [], "guidance");
          logResponseSummary("guidance", { products: 0 });
          return endInteraction(interactionRef, clarificationResponse, {
            decision: { action: "knowledge", flowId: null, missingSlot: null },
            outputType: "reply"
          });
        }

        // Step 7: Search for products based on detected tags
        let found = findRelevantProducts(detectedTags, products, settings.max_products || 3);

        // Step 8: Apply fallback if no products found
        found = found.length > 0 ? found : applyFallbackProducts(products);

        // If no products found, retry with broader tags
        if (found.length === 0) {
          const retryTags = ["cleaning", "interior"];
          found = findRelevantProducts(retryTags, products, settings.max_products || 3);
        }

        // If still no products, ask only when intent is unclear AND cleaning is not already known
        if (found.length === 0) {
          if (!detectedTags.includes("cleaning")) {
            logInfo("DECISION", { type: "product_search", fallbackReason: "no_products_non_cleaning" });
            const helpfulQuestion = settings.fallback_message;
            updateSessionWithProducts(sessionId, [], "guidance");
            logResponseSummary("guidance", { products: 0 });
            return endInteraction(interactionRef, { reply: helpfulQuestion, products: [] }, {
              decision: { action: "knowledge", flowId: null, missingSlot: null },
              outputType: "reply"
            });
          }
          // cleaning is known but no products matched — fall through to fallback
          found = applyFallbackProducts(products);
        }

        // Step 9: Apply ranking to maximize conversion
        const rankingContext = { tags: detectedTags, priceRange: null };
        found = applyRanking(found, rankingContext, settings);

        // Step 10: Enforce product limits BEFORE sending to LLM
        found = enforceProductLimit(found, settings.max_products || 3);
        const filteredFound = filterProducts(found, sessionContext.slots || {});
        const searchBundle = buildProductBundle(filteredFound);
        console.log("PRODUCT_FILTER", {
          slots: sessionContext.slots || {},
          before: found.length,
          after: filteredFound.length
        });
        console.log("PRODUCT_BUNDLE", {
          selected: searchBundle.map(product => product?.name || null).filter(Boolean),
          roles: searchBundle.map(product => product?.tags || [])
        });
        if (searchBundle.length < 2) {
          const reply = getSafeFallbackReply();
          updateSessionWithProducts(sessionId, [], "guidance");
          emit("ai_response", { response: reply });
          logResponseSummary("knowledge", { products: 0 });
          return endInteraction(interactionRef, { reply, products: [] }, {
            decision: {
              action: "knowledge",
              flowId: null,
              missingSlot: null,
              safeFallback: true
            },
            outputType: "reply"
          });
        }
        found = searchBundle.slice(0, 3);

        // Step 12: Build prompt with strategy
        const prompt = createOptimizedPrompt(userMessage, found, settings, detectedTags, strategy, language, "general", "", sessionContext.slots || {});

        // Step 13: Query LLM
        const reply = await askLLM(prompt);

        // Step 14: Track impressions for analytics
        trackProductImpressions(found, sessionId);

        // Step 15: Update session with newly recommended products
        const responseType = found.length > 0 ? "recommendation" : "guidance";
        updateSessionWithProducts(sessionId, found, responseType);

        sessionContext.state = "IDLE";
        const _psPrefix = consumeValidationInfo(sessionContext, sessionId);
        const prefixedPsReply = _psPrefix ? `${_psPrefix}\n\n${reply}` : reply;
        saveSession(sessionId, sessionContext);

        emit("products_recommended", { products: found, tags: detectedTags });
        emit("ai_response", { response: prefixedPsReply });
        logResponseSummary("product_search", { products: found.length });
        return endInteraction(interactionRef, { reply: prefixedPsReply, products: found }, {
          decision: resolvedAction,
          outputType: "recommendation",
          products: summarizeProductsForLog(found)
        });
      }
    }

  } catch (err) {
    console.error("EXECUTION_ERROR", {
      message: err.message,
      stack: err.stack,
      stage: "execution"
    });

    throw err;
  }
}


module.exports = { handleChat, detectLanguage };
