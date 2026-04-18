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

function endInteraction(interactionRef, result, patch = {}) {
  if (patch.intentType != null) interactionRef.intentType = patch.intentType;
  if (patch.tags != null) interactionRef.tags = patch.tags;
  if (patch.slots != null) interactionRef.slots = patch.slots;
  if (patch.decision) {
    interactionRef.decision = { ...interactionRef.decision, ...patch.decision };
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
      type: patch.outputType != null ? patch.outputType : inferOutputType(result),
      products: patch.products != null ? patch.products : summarizeProductsForLog(result.products)
    },
    feedback: interactionRef.feedback
  };

  appendInteractionLine(entry);
  return result;
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

function mergeSlots(sessionSlots, newSlots) {
  return {
    context: newSlots.context || sessionSlots.context || null,
    surface: newSlots.surface || sessionSlots.surface || null,
    object: newSlots.object || sessionSlots.object || null
  };
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

function requiresObjectClarification(message, intent, slots, sessionContext) {
  if (intent !== "product_guidance") {
    return false;
  }

  if (slots.object) {
    return false;
  }

  if (resolveFlowCandidate({ intent, slots })) {
    return false;
  }

  if (!isCleaningFlow(message, sessionContext)) {
    return false;
  }

  return slots.context === "interior" && detectProblemIntent(message);
}

function getMissingSlot(message, intent, slots, sessionContext) {
  // --- SELECTION intent: always require all slots, no flowCandidate skipping ---
  if (intent === "selection") {
    if (!slots.context) return "context";
    if (!slots.object) return "object";
    if (!slots.surface) return "surface";
    return null;
  }

  if (!slots.context) return "context";
  if (requiresObjectClarification(message, intent, slots, sessionContext)) return "object";
  if (!slots.surface) {
    const flowCandidate = intent === "product_guidance"
      ? resolveFlowCandidate({ intent, slots })
      : null;

    if (flowCandidate) {
      return null;
    }

    return "surface";
  }

  return null;
}

function processSlots(message, intent, sessionContext) {
  const extracted = extractSlotsFromMessage(message);

  const slots = applyObjectSlotInference(mergeSlots(sessionContext.slots || {}, extracted));

  const missing = getMissingSlot(message, intent, slots, sessionContext);

  return {
    slots,
    missing
  };
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
    return { action: "recommend" }; // Safe fallback
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

    if (tags.length === 0) {
      warn(SOURCE, "No intent detected, no tags matched - will use fallback strategy");
      return [];
    }

    info(SOURCE, `Tags detected: ${tags.join(", ")}`);
    return tags;
  } catch (err) {
    error(SOURCE, "Intent detection failed", { error: err.message });
    return []; // Continue with empty tags
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
    return `User: ${message}\n\nPlease provide a helpful response about car detailing products.`;
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

  const queryType = detectQueryType(userMessage);
  logInfo("ROUTING", { queryType });

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
    interactionRef = {
      timestamp: new Date().toISOString(),
      sessionId,
      message: userMessage,
      queryType,
      intentType: null,
      tags: null,
      slots: null,
      decision: { action: null, flowId: null, missingSlot: null },
      feedback: extractFeedback(typeof message === "object" ? message : null)
    };

    // Load settings once and reuse the full object across the whole flow.
    const settings = getClientSettings(clientId);

    const session = getSessionService(sessionId);
    session.questionCount = session.questionCount || 0;

    // Step 2: Load session context from store
    let sessionContext = getSession(sessionId);
    const sessionActiveProducts = sessionContext.activeProducts || [];
    sessionContext.state = sessionContext.state || "IDLE";
    let previousState = sessionContext.state;
    sessionContext.questionsAsked = sessionContext.questionsAsked || 0;
    const language = sessionContext.language || detectLanguage(userMessage);
    sessionContext.language = language;
    saveSession(sessionId, sessionContext);
    // Reset state on new search before any tag/state logic runs
    if (isNewSearch(userMessage)) {
      sessionContext.state = "IDLE";
      sessionContext.tags = [];
      sessionContext.slots = {};
      sessionContext.originalIntent = null;
      sessionContext.pendingQuestion = null;
      previousState = sessionContext.state;
      saveSession(sessionId, sessionContext);
    }

    let handledPendingQuestionAnswer = false;
    if (sessionContext.pendingQuestion) {
      const pq = sessionContext.pendingQuestion;

      if (pq.type === "confirm_context") {
        if (isYes(userMessage)) {
          sessionContext.slots = sessionContext.slots || {};
          sessionContext.slots.context = pq.value;
          sessionContext.pendingQuestion = null;
          handledPendingQuestionAnswer = true;
        } else if (isNo(userMessage)) {
          sessionContext.pendingQuestion = null;
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
      const currentIntent = sessionContext.originalIntent || detectIntent(userMessage, sessionId);
      const intentType = typeof currentIntent === "string" ? currentIntent : currentIntent?.type;
      if (intentType === "selection") {
        // Re-enter selection slot evaluation immediately
        const slotResult = processSlots(userMessage, "selection", sessionContext);
        sessionContext.slots = slotResult.slots;
        saveSession(sessionId, sessionContext);
        if (slotResult.missing) {
          const slotSnapshot = {
            context: slotResult.slots?.context || null,
            object: slotResult.slots?.object || null,
            surface: slotResult.slots?.surface || null
          };
          if (slotResult.missing === "context") {
            sessionContext.state = "NEEDS_CONTEXT";
            saveSession(sessionId, sessionContext);
            return endInteraction(interactionRef, {
              type: "question",
              message: "Este vorba despre interior sau exterior?"
            }, {
              intentType: "selection",
              tags: sessionContext.tags || null,
              slots: slotSnapshot,
              decision: { action: "clarification", flowId: null, missingSlot: "context" },
              outputType: "question"
            });
          }
          if (slotResult.missing === "object") {
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
              decision: { action: "clarification", flowId: null, missingSlot: "object" },
              outputType: "question"
            });
          }
          if (slotResult.missing === "surface") {
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
              decision: { action: "clarification", flowId: null, missingSlot: "surface" },
              outputType: "question"
            });
          }
        }
        // All slots present, continue with selection logic below (let main handler proceed)
      }
    }

    // Step 3: Detect basic user intent (greeting/product_search)
    const intentResult = handledPendingQuestionAnswer
      ? (sessionContext.originalIntent || "product_guidance")
      : detectIntent(userMessage, sessionId);
    const isOrderIntent = ["order_status", "order_update", "order_cancel"].includes(
      typeof intentResult === "string" ? intentResult : intentResult?.type
    );
    const shouldForceProblemGuidance = detectProblemIntent(userMessage) && !isOrderIntent;
    const effectiveIntentResult = shouldForceProblemGuidance
      ? (typeof intentResult === "string"
        ? "product_guidance"
        : { ...intentResult, type: "product_guidance" })
      : intentResult;
    let intent = typeof effectiveIntentResult === "string" ? effectiveIntentResult : effectiveIntentResult?.type;

    logInfo("INTENT", {
      detected: intent,
      problemOverrideApplied: shouldForceProblemGuidance
    });
    interactionRef.intentType = intent;

    // Detect and enrich tags BEFORE any flow branching (guidance, questioning, search)
    const availableProductTags = [...new Set((products || []).flatMap(p => p.tags || []))];
    const detectedTagsForMessage = await detectUserIntent(userMessage, settings, availableProductTags);

    const sessionTags = Array.isArray(sessionContext.tags) ? sessionContext.tags : [];
    const initialDetectedTags = Array.isArray(detectedTagsForMessage)
      ? detectedTagsForMessage.filter(tag => !OBJECT_SLOT_VALUES.includes(String(tag || "").toLowerCase()))
      : [];
    const coreTags = [...initialDetectedTags];

    const isFollowUp =
      handledPendingQuestionAnswer ||
      previousState === "NEEDS_CONTEXT" ||
      previousState === "NEEDS_OBJECT" ||
      previousState === "NEEDS_SURFACE";

    if (!isFollowUp) {
      sessionContext.slots = {};
      sessionContext.pendingQuestion = null;
      saveSession(sessionId, sessionContext);
    }

    let workingTags = isFollowUp
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

    // INFORMATIONAL
    if (queryType === "informational") {
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
    if (queryType === "selection") {
      const slotResult = processSlots(userMessage, "selection", sessionContext);
      sessionContext.slots = slotResult.slots;
      saveSession(sessionId, sessionContext);

      if (slotResult.missing) {
        const slotSnapshot = {
          context: slotResult.slots?.context || null,
          object: slotResult.slots?.object || null,
          surface: slotResult.slots?.surface || null
        };
        // Ask for missing slot
        if (slotResult.missing === "context") {
          sessionContext.state = "NEEDS_CONTEXT";
          saveSession(sessionId, sessionContext);
          return endInteraction(interactionRef, {
            type: "question",
            message: "Este vorba despre interior sau exterior?"
          }, {
            intentType: "selection",
            slots: slotSnapshot,
            decision: { action: "clarification", flowId: null, missingSlot: "context" },
            outputType: "question"
          });
        }
        if (slotResult.missing === "object") {
          sessionContext.state = "NEEDS_OBJECT";
          saveSession(sessionId, sessionContext);
          const allowedObjects = getAllowedObjects(slotResult.slots);
          return endInteraction(interactionRef, {
            type: "question",
            message: `Ce obiect vrei sa cureti? (${allowedObjects.join(", ")})`
          }, {
            intentType: "selection",
            slots: slotSnapshot,
            decision: { action: "clarification", flowId: null, missingSlot: "object" },
            outputType: "question"
          });
        }
        if (slotResult.missing === "surface") {
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
            slots: slotSnapshot,
            decision: { action: "clarification", flowId: null, missingSlot: "surface" },
            outputType: "question"
          });
        }
      }

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
            strictTagFilter: true
          });
      const rankingContext = {
        tags: roleConfig?.matchTags || selectionTags,
        priceRange: null
      };
      found = applyRanking(found, rankingContext, settings);
      const finalProducts = enforceProductLimit(found, roleConfig?.maxProducts || settings.max_products || 3);
      const reply = formatSelectionResponse(finalProducts);
      trackProductImpressions(finalProducts, sessionId);
      updateSessionWithProducts(sessionId, finalProducts, finalProducts.length > 0 ? "recommendation" : "guidance");
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
        decision: { action: "recommend", flowId: null, missingSlot: null },
        outputType: "recommendation",
        products: summarizeProductsForLog(finalProducts)
      });
    }

    if (queryType === "procedural") {
      const proceduralSlots = applyObjectSlotInference(
        mergeSlots(sessionContext.slots || {}, extractSlotsFromMessage(userMessage))
      );
      const candidateFlows = resolveFlowCandidates({ intent, slots: proceduralSlots });

      if (candidateFlows.length > 1) {
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
            decision: { action: "clarification", flowId: null, missingSlot: null },
            outputType: "question"
          });
        }
      }
    }

    const storedOriginalIntent = sessionContext.originalIntent;
    const slotResult = processSlots(userMessage, intent, sessionContext);

    if (queryType === "procedural" && !slotResult.slots.context) {
      slotResult.slots.context = "exterior";
      slotResult.missing = getMissingSlot(userMessage, intent, slotResult.slots, sessionContext);
      logInfo("SLOT_INFERENCE", { context: "exterior", reason: "default_for_procedural" });
    }

    const completedSlotFollowUp =
      ["NEEDS_CONTEXT", "NEEDS_OBJECT", "NEEDS_SURFACE"].includes(previousState) &&
      slotResult.missing === null;
    sessionContext.slots = slotResult.slots;
    logInfo("SLOTS", {
      context: slotResult.slots.context || null,
      surface: slotResult.slots.surface || null,
      object: slotResult.slots.object || null
    });

    interactionRef.slots = {
      context: slotResult.slots.context || null,
      object: slotResult.slots.object || null,
      surface: slotResult.slots.surface || null
    };

    if (slotResult.missing === "context") {
      sessionContext.state = "NEEDS_CONTEXT";
      logInfo("FLOW", getFlowLogPayload(intent, slotResult.slots, null, "missing_context"));

      const contextHint = detectContextHint(userMessage);
      if (contextHint === "interior") {
        sessionContext.pendingQuestion = {
          type: "confirm_context",
          value: "interior"
        };
        saveSession(sessionId, sessionContext);
        logResponseSummary("question", { products: 0 });
        return endInteraction(interactionRef, {
          type: "question",
          message: "Este vorba despre interior (cotiera), corect?"
        }, {
          decision: { action: "clarification", flowId: null, missingSlot: "context" },
          outputType: "question"
        });
      }

      if (contextHint === "exterior") {
        sessionContext.pendingQuestion = {
          type: "confirm_context",
          value: "exterior"
        };
        saveSession(sessionId, sessionContext);
        logResponseSummary("question", { products: 0 });
        return endInteraction(interactionRef, {
          type: "question",
          message: "Este vorba despre exterior, corect?"
        }, {
          decision: { action: "clarification", flowId: null, missingSlot: "context" },
          outputType: "question"
        });
      }

      sessionContext.pendingQuestion = null;
      saveSession(sessionId, sessionContext);
      logResponseSummary("question", { products: 0 });

      return endInteraction(interactionRef, {
        type: "question",
        message: "Este vorba despre interior sau exterior?"
      }, {
        decision: { action: "clarification", flowId: null, missingSlot: "context" },
        outputType: "question"
      });
    }

    if (slotResult.missing === "object") {
      sessionContext.state = "NEEDS_OBJECT";
      sessionContext.originalIntent = sessionContext.originalIntent || intent;
      saveSession(sessionId, sessionContext);
      logInfo("FLOW", getFlowLogPayload(intent, slotResult.slots, null, "missing_object"));

      const allowedObjects = getAllowedObjects(slotResult.slots);
      const options = allowedObjects.join(", ");

      logResponseSummary("question", { products: 0 });
      return endInteraction(interactionRef, {
        type: "question",
        message: `Ce obiect vrei sa cureti? (${options})`
      }, {
        decision: { action: "clarification", flowId: null, missingSlot: "object" },
        outputType: "question"
      });
    }

    if (slotResult.missing === "surface") {
      sessionContext.state = "NEEDS_SURFACE";
      sessionContext.originalIntent = sessionContext.originalIntent || intent;
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
        decision: { action: "clarification", flowId: null, missingSlot: "surface" },
        outputType: "question"
      });
    }

    sessionContext.state = "READY";
    sessionContext.context = slotResult.slots.context;
    saveSession(sessionId, sessionContext);

    const finalTags = buildFinalTags(coreTags, workingTags, slotResult.slots);

    sessionContext.tags = finalTags;
    saveSession(sessionId, sessionContext);

    const decisionContext = normalizeDecision(userMessage, effectiveIntentResult, sessionContext, finalTags);
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

    const prioritizedFlow = resolveFlow({
      intent,
      slots: sessionContext.slots || {}
    });

    logInfo("FLOW", getFlowLogPayload(intent, sessionContext.slots || {}, prioritizedFlow));

    if (prioritizedFlow) {
      logInfo("FLOW_PRIORITY", { applied: true });
      logInfo("DECISION", { type: "flow" });
      const flowResult = executeFlow(prioritizedFlow, products, sessionContext.slots || {});
      updateSessionWithProducts(sessionId, flowResult.products || [], "guidance");
      emit("ai_response", { response: flowResult.reply });
      logResponseSummary("flow", {
        steps: Array.isArray(prioritizedFlow.steps) ? prioritizedFlow.steps.length : 0,
        products: Array.isArray(flowResult.products) ? flowResult.products.length : 0
      });
      return endInteraction(interactionRef, {
        reply: flowResult.reply,
        products: flowResult.products || []
      }, {
        decision: {
          action: "flow",
          flowId: prioritizedFlow.flowId || null,
          missingSlot: null
        },
        outputType: "reply",
        products: summarizeProductsForLog(flowResult.products || [])
      });
    }

    // PRIORITY OVERRIDE: Safety / guidance strategies bypass product search ranking
    if (decisionContext.isSafety || strategy === "guidance") {
      const fallbackReason = decisionContext.isSafety ? "safety_mode" : "guidance_strategy";
      logInfo("FLOW", getFlowLogPayload(intent, sessionContext.slots || {}, null, fallbackReason));
      logInfo("DECISION", { type: "knowledge", fallbackReason });

      const safeMessage =
        typeof message === "string"
          ? message
          : JSON.stringify(message || "");

      const guidanceType = decisionContext.isSafety
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
        decisionContext.isSafety ||
        !isFirstGuidanceAfterClarification ||
        explicitProductRequest;

      let safetyProducts = [];
      if (shouldInjectProducts) {
        safetyProducts = findRelevantProducts(finalTags, products, settings.max_products || 3);
        safetyProducts = enforceProductLimit(safetyProducts, settings.max_products || 3);
      }

      const effectiveStrategy = decisionContext.isSafety ? "safety" : strategy;
      const prompt = createOptimizedPrompt(userMessage, safetyProducts, settings, finalTags, effectiveStrategy, language, guidanceType, knowledgeContext, sessionContext.slots || {});
      const reply = await askLLM(prompt);

      if (safetyProducts.length > 0) {
        trackProductImpressions(safetyProducts, sessionId);
        updateSessionWithProducts(sessionId, safetyProducts, "recommendation");
        emit("products_recommended", { products: safetyProducts, tags: finalTags });
      } else {
        updateSessionWithProducts(sessionId, [], "guidance");
      }
      emit("ai_response", { response: reply });
      logResponseSummary("knowledge", { products: safetyProducts.length });
      return endInteraction(interactionRef, { reply, products: safetyProducts }, {
        decision: {
          action: decisionContext.isSafety ? "safety" : "knowledge",
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

    if (shouldUseGuidance) {
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
    const context = {
      intent,
      queryType,
      activeProducts: sessionActiveProducts,
      session: sessionContext,
      message: userMessage,
      availableTags: availableProductTags
    };

    if (isNewSearch(userMessage)) {
      sessionContext.activeProducts = [];
      sessionContext.tags = [];
      sessionContext.intent = null;
      sessionContext.state = "IDLE";
      saveSession(sessionId, sessionContext);

      context.activeProducts = sessionContext.activeProducts;
      context.session = sessionContext;
    }

    // Step 5: Make high-level decision about next action
    const decision = decideNextAction(context);
    interactionRef.decision = {
      action: decision.action === "guide" ? "knowledge" : "recommend",
      flowId: null,
      missingSlot: null
    };

    // BRANCHING LOGIC BASED ON DECISION
    if (decision.action === "guide") {
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
        decision: { action: "knowledge", flowId: null, missingSlot: null },
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
          decision: { action: "clarification", flowId: null, missingSlot: null },
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
            decision: { action: "clarification", flowId: null, missingSlot: null },
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
      interactionRef.decision = {
        action: "recommend",
        flowId: null,
        missingSlot: null
      };
      return endInteraction(interactionRef, { reply, products: found }, {
        outputType: "recommendation",
        products: summarizeProductsForLog(found)
      });
    }

  } catch (err) {
    error(SOURCE, "Chat handling failed - using emergency fallback", { error: err.message, stack: err.stack });

    // Emergency fallback - never crash the flow
    const fallbackResponse = generateFallbackResponse(userMessage, config.defaultSettings, []);
    logResponseSummary("guidance", { products: 0 });
    if (interactionRef) {
      return endInteraction(interactionRef, fallbackResponse, {
        decision: { action: "error", flowId: null, missingSlot: null },
        outputType: "reply"
      });
    }
    return fallbackResponse;
  }
}


module.exports = { handleChat, detectLanguage };
