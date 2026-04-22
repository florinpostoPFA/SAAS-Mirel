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
const OBJECT_SLOT_VALUES = ["cotiera", "scaun", "plafon", "bord", "oglinda", "geam", "parbriz", "oglinzi", "volan", "mocheta", "tapiterie"];
const OBJECT_MATCH_TERMS = {
  cotiera: ["cotiera", "armrest"],
  scaun: ["scaun", "seat", "scaune"],
  plafon: ["plafon", "headliner", "ceiling"],
  bord: ["bord", "dashboard"],
  oglinda: ["oglinda", "mirror"],
  geam: ["geam", "geamuri", "glass"],
  parbriz: ["parbriz", "windshield"],
  oglinzi: ["oglinda", "oglinzi", "mirror", "mirrors"],
  volan: ["volan", "steering wheel"],
  mocheta: ["mocheta", "carpet", "floor mat", "floor mats"],
  tapiterie: ["tapiterie", "upholstery"]
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
  oglinzi: ["glass"],
  tapiterie: ["textile", "leather", "alcantara"]
};
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

const flowRequirements = {
  bug_removal_quick: ["context", "target"],
  interior_clean_basic: ["context", "material"],
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
    message
  });
  throw new Error(errorMessage);
}

function assertDecisionInvariantsBeforeExecution(decision, slots, message) {
  const safeDecision = decision && typeof decision === "object" ? decision : {};
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const missingSlot = getMissingSlot(safeSlots);

  if (safeDecision.action === "clarification") {
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

function ensureClarificationDecision(interactionRef, finalResult, finalOutputType, sessionContext) {
  const isQuestion = finalOutputType === "question" || finalResult?.type === "question";

  if (!isQuestion) {
    return;
  }

  const fallbackSlots =
    interactionRef?.slots && typeof interactionRef.slots === "object"
      ? interactionRef.slots
      : sessionContext?.slots && typeof sessionContext.slots === "object"
        ? sessionContext.slots
        : {};
  const effectiveSlots =
    interactionRef?.slots && typeof interactionRef.slots === "object"
      ? interactionRef.slots
      : fallbackSlots;

  if (interactionRef.decision?.missingSlot === "context" && finalResult && typeof finalResult === "object") {
    finalResult.message = getClarificationQuestion("context", effectiveSlots);
    finalResult.reply = finalResult.message;
  }

  if (interactionRef.decision?.missingSlot === "surface" && finalResult && typeof finalResult === "object") {
    finalResult.message = getClarificationQuestion("surface", effectiveSlots);
    finalResult.reply = finalResult.message;
  }

}

function enforceClarificationContract(decision) {
  if (!decision || typeof decision !== "object") {
    return decision;
  }

  if (decision.action !== "clarification") {
    return decision;
  }

  if (!decision.missingSlot) {
    console.error("INVARIANT_FAILURE", {
      decision,
      slots: null,
      message: null
    });
    throw new Error("Invalid clarification: missingSlot is required");
  }

  if (!["context", "object", "surface"].includes(decision.missingSlot)) {
    console.error("INVARIANT_FAILURE", {
      decision,
      slots: null,
      message: null
    });
    throw new Error("Invalid slot type");
  }

  return decision;
}

function normalizeDecisionContract(decision) {
  if (!decision || typeof decision !== "object") {
    return decision;
  }

  const normalizedDecision = { ...decision };

  if (normalizedDecision.flowId && typeof normalizedDecision.flowId === "object") {
    normalizedDecision.flowId = normalizedDecision.flowId.id || normalizedDecision.flowId.flowId || null;
  }

  if (normalizedDecision.flowId != null) {
    normalizedDecision.flowId = String(normalizedDecision.flowId);
  }

  return enforceClarificationContract(normalizedDecision);
}

function getStrictOutputType(decision, fallbackOutputType) {
  switch (decision?.action) {
    case "flow":
      return "flow";
    case "clarification":
      return "question";
    case "recommend":
      return "recommendation";
    default:
      return fallbackOutputType;
  }
}

function assertDecisionExecutionConsistency(decision, outputType) {
  if (decision?.action === "flow" && outputType !== "flow") {
    console.error("INVARIANT_FAILURE", {
      decision,
      slots: null,
      message: null
    });
    throw new Error("Execution mismatch: flow decision but non-flow output");
  }

  if (decision?.action === "clarification" && outputType !== "question") {
    console.error("INVARIANT_FAILURE", {
      decision,
      slots: null,
      message: null
    });
    throw new Error("Execution mismatch: clarification decision but wrong output");
  }

  if (decision?.action === "recommend" && outputType !== "recommendation") {
    console.error("INVARIANT_FAILURE", {
      decision,
      slots: null,
      message: null
    });
    throw new Error("Execution mismatch: recommend decision but wrong output");
  }
}

function endInteraction(interactionRef, result, patch = {}) {
  if (patch.intentType != null) interactionRef.intentType = patch.intentType;
  if (patch.tags != null) interactionRef.tags = patch.tags;
  if (patch.slots != null) interactionRef.slots = patch.slots;
  if (patch.decision) {
    interactionRef.decision = { ...interactionRef.decision, ...patch.decision };
  }
  interactionRef.decision = normalizeDecisionContract(interactionRef.decision);

  let finalResult = result;
  let finalOutputType = getStrictOutputType(
    interactionRef.decision,
    patch.outputType != null ? patch.outputType : inferOutputType(result)
  );
  let finalProducts = patch.products != null ? patch.products : summarizeProductsForLog(result.products);
  const sessionContext = interactionRef?.sessionId ? getSession(interactionRef.sessionId) : null;

  if (
    sessionContext &&
    sessionContext.lastUserMessage === interactionRef.message &&
    sessionContext.lastResponseType === finalOutputType &&
    !["flow", "clarification", "recommend"].includes(interactionRef?.decision?.action)
  ) {
    finalResult = {
      type: "question",
      message: "Hai să o luăm altfel. Ce vrei exact să rezolvi?"
    };
    finalOutputType = "question";
    finalProducts = [];
  }

  ensureClarificationDecision(interactionRef, finalResult, finalOutputType, sessionContext);
  interactionRef.decision = normalizeDecisionContract(interactionRef.decision);
  assertDecisionInvariantsBeforeExecution(
    interactionRef.decision,
    interactionRef.slots,
    interactionRef.message
  );
  finalOutputType = getStrictOutputType(interactionRef.decision, finalOutputType);
  assertDecisionOutputContract(
    interactionRef.decision,
    { type: finalOutputType },
    interactionRef.slots,
    interactionRef.message
  );
  assertDecisionExecutionConsistency(interactionRef.decision, finalOutputType);
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
    saveSession(interactionRef.sessionId, sessionContext);
  }

  const entry = {
    timestamp: interactionRef.timestamp,
    sessionId: interactionRef.sessionId,
    message: interactionRef.message,
    intent: {
      queryType: interactionRef.queryType,
      type: interactionRef.intentType,
      tags: interactionRef.tags
    },
    slots: interactionRef.slots,
    decision: {
      action: interactionRef.decision.action,
      flowId: interactionRef.decision.flowId,
      missingSlot: interactionRef.decision.missingSlot
    },
    output: {
      type: finalOutputType,
      products: finalProducts
    },
    feedback: interactionRef.feedback
  };

  appendInteractionLine(entry);
  return finalResult;
}

function formatSelectionResponse(products = []) {
  const safeProducts = Array.isArray(products) ? products : [];

  if (safeProducts.length === 0) {
    return "Nu am gasit produse potrivite in lista disponibila.";
  }

  const lines = ["Iata produsele potrivite din lista disponibila:"];

  safeProducts.forEach((product, index) => {
    const shortDescription = String(product?.short_description || product?.description || "").trim();
    const reason = shortDescription
      ? shortDescription.split(/[.!?]/)[0].trim()
      : "Se potriveste cu cererea ta.";

    lines.push("");
    lines.push(`${index + 1}. ${product?.name || "Produs"}`);
    lines.push(`Descriere: ${shortDescription || "Fara descriere scurta disponibila."}`);
    lines.push(`Motiv: ${reason || "Se potriveste cu cererea ta."}`);
  });

  return lines.join("\n");
}

function extractSlotsFromMessage(message) {
  const text = String(message || "").toLowerCase();
  const interiorContextTerms = ["mocheta", "scaun", "bord", "cotiera", "interior"];
  const exteriorContextTerms = ["jante", "exterior", "caroserie", "caroseria"];

  const OBJECT_KEYWORDS = {
    cotiera: ["cotiera", "armrest"],
    scaun: ["scaun", "seat"],
    plafon: ["plafon", "headliner", "ceiling"],
    volan: ["volan", "steering wheel"],
    bord: ["bord", "dashboard"],
    oglinda: ["oglinda", "mirror"],
    geam: ["geam", "geamuri", "window"],
    parbriz: ["parbriz", "windshield"],
    oglinzi: ["oglinzi", "oglinda", "mirrors", "mirror"],
    mocheta: ["mocheta", "carpet", "floor mat", "floor mats"],
    tapiterie: ["tapiterie", "upholstery"]
  };

  let object = null;
  for (const [key, keywords] of Object.entries(OBJECT_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) {
      object = key;
      break;
    }
  }

  return {
    context:
      interiorContextTerms.some(term => text.includes(term)) ? "interior" :
      exteriorContextTerms.some(term => text.includes(term)) ? "exterior" :
      null,

    surface:
      text.includes("piele") ? "leather" :
      text.includes("alcantara") ? "alcantara" :
      text.includes("textil") ? "textile" :
      text.includes("plastic") ? "plastic" :
      text.includes("jante") ? "wheels" :
      text.includes("geamuri") || text.includes("geam") ? "glass" :
      text.includes("vopsea") ? "paint" :
      text.includes("sticla") ? "glass" :
      null,

    object
  };
}

function extractSlotsForSafetyQuery(message) {
  const msg = String(message || "").toLowerCase();

  let context = null;
  let object = null;
  let surface = null;

  // CONTEXT
  if (msg.includes("interior")) context = "interior";
  if (msg.includes("exterior")) context = "exterior";

  // OBJECT
  if (msg.includes("scaun")) object = "scaun";
  if (msg.includes("cotiera")) object = "cotiera";
  if (msg.includes("parbriz")) object = "parbriz";
  if (msg.includes("mocheta")) object = "mocheta";
  if (msg.includes("bord")) object = "bord";
  if (msg.includes("volan")) object = "volan";
  if (msg.includes("geam") || msg.includes("geamuri")) object = object || "geam";

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
    if (object === "parbriz" || object === "geam" || surface === "glass" || surface === "paint") {
      context = "exterior";
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

  return `insecte ${rawMessage}`;
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

  if (!slotSource.context) return "context";
  if (!slotSource.object) return "object";
  if (!slotSource.surface) return "surface";
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

  if (normalized.surface === "wheels" && !normalized.object) {
    normalized.object = "wheels";
    normalized.surface = null;
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
    "cotiera", "scaun", "bord", "volan", "tapiterie", "mocheta", "interior"
  ];

  const exteriorObjects = [
    "caroserie", "caroseria", "jante", "roti", "vopsea", "exterior"
  ];

  if (interiorObjects.some(w => text.includes(w))) {
    return "interior";
  }

  if (exteriorObjects.some(w => text.includes(w))) {
    return "exterior";
  }

  return null;
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

function filterProducts(products, slots) {
  if (!products || !Array.isArray(products)) return [];

  const safeSlots = slots && typeof slots === "object" ? slots : {};

  return products.filter(product => {
    const tags = Array.isArray(product?.tags)
      ? product.tags.map(tag => String(tag || "").toLowerCase())
      : [];

    // CONTEXT FILTER
    if (safeSlots.context === "interior" && tags.includes("exterior")) return false;
    if (safeSlots.context === "exterior" && tags.includes("interior")) return false;

    // SURFACE FILTER (STRICT)
    if (safeSlots.surface === "textile" && !tags.includes("textile")) return false;
    if (safeSlots.surface === "leather" && !tags.includes("leather")) return false;
    if (safeSlots.surface === "paint" && !tags.includes("paint")) return false;
    if (safeSlots.surface === "glass" && !tags.includes("glass")) return false;
    if (safeSlots.surface === "wheels" && !tags.includes("wheels")) return false;

    return true;
  });
}

function buildProductBundle(products) {
  const safeProducts = Array.isArray(products) ? products : [];
  const bundle = [];

  const hasRoleTag = (product, role) => {
    const tags = Array.isArray(product?.tags)
      ? product.tags.map(tag => String(tag || "").toLowerCase())
      : [];
    return tags.includes(role);
  };

  const cleaner = safeProducts.find(product => hasRoleTag(product, "cleaner"));
  const tool = safeProducts.find(product => hasRoleTag(product, "tool"));
  const microfiber = safeProducts.find(product => hasRoleTag(product, "microfiber"));

  if (cleaner) bundle.push(cleaner);
  if (tool) bundle.push(tool);
  if (microfiber) bundle.push(microfiber);

  return bundle.slice(0, 3);
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

    if (found.length === 0) {
      warn(SOURCE, "No products matched the detected tags");
      const safeProducts = Array.isArray(products) ? products : [];
      debug(SOURCE, `Available products: ${safeProducts.map(p => p.name).join(", ")}`);
      return [];
    }

    info(SOURCE, `Found ${found.length} product(s):`, {
      products: found.map(p => ({ name: p.name, score: p.score, price: p.price }))
    });

    return found;
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
    "geam", "geamuri", "parbriz",
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
    return ["mocheta", "cotiera", "scaun", "plafon", "parbriz", "jante", "roti", "anvelope", "geam", "vopsea"]
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

function getDeterministicIntent(message) {
  const msg = String(message || "").toLowerCase();

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

function isSafetyQuery(message) {
  const msg = String(message || "").toLowerCase();

  return (
    msg.includes("pot sa") ||
    msg.includes("pot folosi") ||
    msg.includes("este sigur") ||
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

function normalizeMessage(message) {
  let msg = String(message || "").toLowerCase();

  if (msg.includes("vreau sa curat")) {
    msg = msg.replace("vreau sa curat", "cum curat");
  }

  if (msg.includes("vreau sa spal")) {
    msg = msg.replace("vreau sa spal", "cum spal");
  }

  return msg;
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

    interactionRef = {
      timestamp: new Date().toISOString(),
      sessionId,
      message: userMessage,
      queryType: null,
      intentType: null,
      tags: null,
      slots: null,
      decision: { action: null, flowId: null, missingSlot: null },
      feedback: extractFeedback(typeof message === "object" ? message : null)
    };

    const lowSignalIntent = detectIntent(routingMessage, sessionId);
    const lowSignalConfidence = getIntentConfidenceValue(
      typeof lowSignalIntent === "string" ? null : lowSignalIntent?.confidence
    );

    if (isLowSignal(userMessage, lowSignalConfidence)) {
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
          missingSlot: null
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
    const isFollowUp =
      isFollowUpMessage(userMessage) ||
      (sessionContext.state && sessionContext.state !== "IDLE") ||
      sessionContext.pendingQuestion;

    if (shouldHardResetForNewRootQuery(userMessage, sessionContext)) {
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

    let queryType = detectQueryType(routingMessage);
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
      const msg = userMessage.toLowerCase();

      let updated = false;

      sessionContext.slots = sessionContext.slots || {};

      if (pending.slot === "context") {
        if (msg.includes("interior")) {
          sessionContext.slots.context = "interior";
          updated = true;
        }

        if (msg.includes("exterior")) {
          sessionContext.slots.context = "exterior";
          updated = true;
        }
      }

      if (pending.slot === "surface") {
        if (msg.includes("textil")) {
          sessionContext.slots.surface = "textile";
          updated = true;
        }
        if (msg.includes("piele")) {
          sessionContext.slots.surface = "leather";
          updated = true;
        }
      }

      if (pending.slot === "object") {
        if (msg.includes("parbriz")) {
          sessionContext.slots.object = "parbriz";
          updated = true;
        }
        if (msg.includes("vopsea")) {
          sessionContext.slots.surface = "paint";
          updated = true;
        }
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
            message: "Este vorba despre interior sau exterior?"
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
        const selectionDecision = enforceClarificationContract(resolveAction({
          problemType,
          message: {
            text: userMessage,
            routingDecision: { action: "selection" }
          },
          slots: sessionContext.slots || slotResult.slots || {},
        }));
        const originalSelectionDecision = JSON.stringify(selectionDecision);
        assertMissingSlotInvariant(selectionDecision, sessionContext.slots || slotResult.slots || {});
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
            saveSession(sessionId, sessionContext);
            return endInteraction(interactionRef, {
              type: "question",
              message: "Este vorba despre interior sau exterior?"
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
    const rawIntent = handledPendingQuestionAnswer
      ? (sessionContext.originalIntent || "product_guidance")
      : detectIntent(routingMessage, sessionId);
    let intentResult = handledPendingQuestionAnswer
      ? rawIntent
      : overrideIntent(routingMessage, rawIntent);
    const deterministicIntent = getDeterministicIntent(userMessage);
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

    if (isLikelySlotFill(userMessage) && sessionContext.state?.startsWith("NEEDS_")) {
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

    interactionRef.tags = workingTags;

    if (intent === "greeting") {
      return endInteraction(interactionRef, {
        reply: "Salut! Cu ce te pot ajuta?"
      }, {
        decision: { action: "greeting", flowId: null, missingSlot: null },
        outputType: "reply"
      });
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

    // INFORMATIONAL
    if (queryType === "informational" && previewAction === "knowledge") {
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
      const currentSlots = { ...(slotResult?.slots || {}) };
      const currentMessageSlots = extractSlotsFromMessage(userMessage);
      const introducesNewObjectOrContext = Boolean(
        (currentMessageSlots.context && currentMessageSlots.context !== (sessionContext.slots || {}).context) ||
        (currentMessageSlots.object && currentMessageSlots.object !== (sessionContext.slots || {}).object)
      );
      if (introducesNewObjectOrContext && !currentMessageSlots.surface) {
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
      }
      saveSession(sessionId, sessionContext);
      interactionRef.decision = selectionDecision;
      logInfo("ROUTER_DECISION", interactionRef.decision);

      // All required slots are present, proceed with selection
      const selectionTags = buildFinalTags(coreTags, workingTags, slotResult.slots);
      const msg = userMessage.toLowerCase();
      let role = null;
      if (msg.includes("sampon")) role = "car_shampoo";
      if (msg.includes("jante")) role = "wheel_cleaner";
      if (msg.includes("geam")) role = "glass_cleaner";
      const roleConfig = role ? productRoles[role] || null : null;
      let found = roleConfig
        ? findProductsByRoleConfig(roleConfig, products)
        : findRelevantProducts(selectionTags, products, settings.max_products || 3, {
            strictTagFilter: !(sessionContext.objective?.needsCompletion && isContinuation)
          });
      const rankingContext = {
        tags: roleConfig?.matchTags || selectionTags,
        priceRange: null
      };
      found = applyRanking(found, rankingContext, settings);
      const selectedProducts = enforceProductLimit(found, roleConfig?.maxProducts || settings.max_products || 3);
      const enrichedSelectionProducts = enrichProducts(selectedProducts, products);
      const filteredSelectionProducts = filterProducts(enrichedSelectionProducts, sessionContext.slots || slotResult.slots || {});
      const selectionBundle = buildProductBundle(filteredSelectionProducts);
      console.log("PRODUCT_FILTER", {
        slots: sessionContext.slots || slotResult.slots || {},
        before: enrichedSelectionProducts.length,
        after: filteredSelectionProducts.length
      });
      console.log("PRODUCT_BUNDLE", {
        selected: selectionBundle.map(product => product?.name || null).filter(Boolean),
        roles: selectionBundle.map(product => product?.tags || [])
      });
      if (selectionBundle.length < 2) {
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
      const finalProducts = selectionBundle.slice(0, 3);
      const reply = formatSelectionResponse(finalProducts);
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
      const shouldAllowPreviewDisambiguation =
        hasStrongSlots(proceduralSlots) ||
        Boolean(sessionContext.problemType) ||
        isKnownCleaningEntry(userMessage);
      const candidateFlows = resolveFlowCandidates({
        intent,
        message: hasBugIntent ? getFlowResolverMessage(userMessage, sessionContext) : userMessage,
        slots: proceduralSlots
      });

      if (candidateFlows.length > 1 && shouldAllowPreviewDisambiguation) {
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
              missingSlot: disambiguation.state === "NEEDS_SURFACE" ? "surface" : "context"
            },
            outputType: "question"
          });
        }
      }
    }

    const storedOriginalIntent = sessionContext.originalIntent;

    const slotResult = processSlots(userMessage, intent, sessionContext, { mergeWithSession: hadPendingQuestionAtStart });
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

    if (queryType === "procedural" && !slotResult.slots.context) {
      slotResult.slots.context = "exterior";
      logInfo("SLOT_INFERENCE", { context: "exterior", reason: "default_for_procedural" });
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
    console.log("DECISION_FINAL", resolvedAction);
    logInfo("DECISION_SOURCE", { source: "resolveAction", decision: resolvedAction });
    console.log("STAGE:RESOLVE", resolvedAction);
    if (JSON.stringify(resolvedAction) !== originalResolvedAction) {
      console.warn("DECISION_MUTATION_DETECTED", {
        before: originalResolvedAction,
        after: resolvedAction
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
    interactionRef.decision = {
      action: resolvedAction.action,
      flowId: resolvedAction.flowId,
      reason: routingDecision.reason,
      missingSlot: resolvedAction.missingSlot || null
    };
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
      saveSession(sessionId, sessionContext);
      logResponseSummary("question", { products: 0 });

      return endInteraction(interactionRef, {
        type: "question",
        message: "Este vorba despre interior sau exterior?"
      }, {
        decision: resolvedAction,
        outputType: "question"
      });
    }

    if (resolvedAction.action === "clarification" && shouldHandleClarification && resolvedAction.missingSlot === "object") {
      sessionContext.state = "NEEDS_OBJECT";
      sessionContext.originalIntent = sessionContext.originalIntent || intent;
      sessionContext.pendingQuestion = {
        slot: "object",
        object: sessionContext.slots?.object || null,
        context: sessionContext.slots?.context || null
      };
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
      sessionContext.pendingQuestion = {
        slot: "surface",
        object: sessionContext.slots?.object || null,
        context: sessionContext.slots?.context || null
      };
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

    const finalTags = buildFinalTags(coreTags, workingTags, slotResult.slots);

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
        const rawFlowProducts = Array.isArray(flowResult.products) ? flowResult.products : [];
        const filteredFlowProducts = filterProducts(rawFlowProducts, sessionContext.slots || {});
        const flowBundle = buildProductBundle(filteredFlowProducts);
        console.log("PRODUCT_FILTER", {
          slots: sessionContext.slots || {},
          before: rawFlowProducts.length,
          after: filteredFlowProducts.length
        });
        console.log("PRODUCT_BUNDLE", {
          selected: flowBundle.map(product => product?.name || null).filter(Boolean),
          roles: flowBundle.map(product => product?.tags || [])
        });
        if (flowBundle.length < 2) {
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
        emit("ai_response", { response: flowResult.reply });
        logResponseSummary("flow", {
          steps: Array.isArray(resolvedPrioritizedFlow.steps) ? resolvedPrioritizedFlow.steps.length : 0,
          products: flowProducts.length
        });
        return endInteraction(interactionRef, {
          type: "flow",
          message: flowResult.reply,
          reply: flowResult.reply,
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
      emit("ai_response", { response: reply });
      logResponseSummary("knowledge", { products: safetyProducts.length });
      return endInteraction(interactionRef, { reply, products: safetyProducts }, {
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

      emit("ai_response", { response: reply });
      logResponseSummary("knowledge", { products: 0 });
      return endInteraction(interactionRef, { reply, products: [] }, {
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

        emit("ai_response", { response: reply });
        logResponseSummary("knowledge", { products: 0 });
        return endInteraction(interactionRef, { reply, products: [] }, {
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
        saveSession(sessionId, sessionContext);

        emit("products_recommended", { products: found, tags: detectedTags });
        emit("ai_response", { response: reply });
        logResponseSummary("product_search", { products: found.length });
        return endInteraction(interactionRef, { reply, products: found }, {
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
