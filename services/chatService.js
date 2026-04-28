// Chat logic - orchestrate search, prompt building, and LLM
const config = require("../config");
const { selectProducts } = require("./productSelectionService");
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
const {
  resolveFlow,
  resolveFlowCandidate,
  resolveFlowCandidates,
  getFlowRequiredSlotsConfig,
  assertFlowLockInvariant
} = require("./flowResolver");
const { hasExplicitInsectSignal } = require("./insectSignal");
const {
  buildKnowledgeDeadEndRecoveryPatch,
  isKnowledgeDeadEnd,
  normalizeReplyText: normalizeKnowledgeReplyText
} = require("./knowledgeDeadEndService");
const { executeFlow } = require("./flowExecutor");
const { normalizeDecision } = require("./decisionNormalizer");
const { detectQueryType } = require("./queryTypeService");
const {
  analyzeSafetyQuery,
  isSafetyQuery,
  buildSafetyAnswerText,
  CLARIFICATION_BY_FIELD,
  conservativeFollowUpReply,
  logSafetyFields
} = require("./safetyQueryService");
const { routeRequest, areSlotsComplete, getMissingSlot: getRouterMissingSlot } = require("./router");
const { findRelevantKnowledge } = require("./knowledgeService");
const fallbackProductsCatalog = require("../data/products.json");
const productRoles = require("../data/product_roles.json");
const knowledgeBase = require("../data/knowledge.json");
const { resolveSurfaceShortlist } = require("./vehicleSurfaceShortlist");
const { computeSurfaceAssistEnabled, resolveLlmSurfaceAssistFlag } = require("./surfaceAssistFeature");
const {
  userSignalsSurfaceMaterialUncertainty,
  suggestSeatMaterialsAdvisory,
  buildCarLineFromParsed,
  matchPickFromLlmSuggestions,
  buildSuggestionsUserMessage,
  buildSuggestionUiChips,
  canonicalToCtoSurface
} = require("./surfaceAssistLlmAdvisory");
const {
  isLowSignalMessage,
  buildLowSignalClarificationQuestion,
  classifyIntentLevelReply,
  buildLowSignalMenuPrompt,
  matchesInformationalBypass,
  isLegacySelectionFollowupShape,
  isSelectionFollowupMessage,
  normalizeRo: normalizeLowSignalText
} = require("./lowSignalService");
const {
  applyUserCorrection,
  shouldBreakRepeatedAsk,
  recordClarificationAsk,
  resetAskCountForSlot,
  clearClarificationAskTracking,
  hasExplicitCorrectionPattern
} = require("./slotCorrectionService");
const {
  inferContext,
  detectExplicitContext,
  logContextInferenceTrace,
  normalizeForContextInference
} = require("./contextInferenceService");
const { stripGreetingAndFillers, applySlangNormalize } = require("./messagePreprocessService");
const { getNowIso } = require("./runtimeContext");
const loggingV2 = require("./loggingV2");
const { runSessionExclusive } = require("./sessionTurnQueue");
const {
  inferHighLevelIntent,
  isInformationalKnowledgeShape,
  isProceduralHowTo
} = require("./productIntentHeuristics");
const {
  analyzeWheelTireMessage,
  maybeWheelTireCombinedWorkflowReply,
  maybeWheelTireAmbiguousProductClarification,
  applyWheelTireObjectToSlots,
  wheelTireTagBoost,
  selectionRoleFromWheelTire
} = require("./wheelTireSemantics");
const {
  buildPendingQuestionState,
  evaluateClarificationEscalation
} = require("./clarificationEscalationService");

const SOURCE = "ChatService";
const SURFACE_TAGS = ["paint", "textile", "leather", "alcantara", "plastic", "glass", "wheels", "piele"];
const CTO_SURFACE_ENUM = ["textile", "piele", "plastic", "alcantara"];
const CTO_SURFACE_SET = new Set(CTO_SURFACE_ENUM);
function normalizeResponseLocale(locale) {
  const s = String(locale || "ro").toLowerCase().trim();
  if (s.startsWith("en")) return "en";
  return "ro";
}

function getProceduralSurfaceEnumQuestion(responseLocale) {
  return normalizeResponseLocale(responseLocale) === "en"
    ? "What surface is it: textile, piele, plastic, or alcantara?"
    : "Ce suprafata este: textile, piele, plastic sau alcantara?";
}

function getInteriorSurfaceLlmAssistBaseQuestion(responseLocale) {
  const loc = normalizeResponseLocale(responseLocale);
  return loc === "en"
    ? "What material is the surface? (textile, leather, etc.) If you are not sure, tell me your car make, model, and year."
    : "Din ce material este suprafata? (textil, piele, etc.) Daca nu esti sigur, spune-mi marca, modelul si anul masinii.";
}

const SURFACE_ASSIST_STRINGS = {
  en: {
    cta: "Not sure? Tell me your car (make, model, year) and I'll help you pick.",
    vehiclePrompt: "Please send make and model (year optional), e.g. VW Golf 2016.",
    shortlistHead:
      "Most likely upholstery for your car — pick one option (reply with the number or name):"
  },
  ro: {
    cta:
      "Nu esti sigur? Spune-mi masina (producator, model, an de fabricatie) si te pot ajuta sa alegi.",
    vehiclePrompt:
      "Spune-mi marca si modelul (anul e optional), ex: Dacia Logan 2018.",
    shortlistHead:
      "Cele mai probabile tapiterii pentru masina ta — alege o optiune (raspunde cu numar sau nume):"
  }
};

function resolveSurfaceAssistFlag() {
  return computeSurfaceAssistEnabled({
    env: process.env,
    settings: getSettings(),
    config
  });
}

function qualifiesForInteriorSurfaceAssist(slots) {
  const s = slots && typeof slots === "object" ? slots : {};
  if (s.context !== "interior") return false;
  const obj = canonicalizeObjectValue(s.object);
  if (!obj) return false;
  if (obj === "mocheta" || obj === "bord") return false;
  return true;
}

function appendSurfaceAssistFallbackCTA(baseMessage, responseLocale) {
  if (!resolveSurfaceAssistFlag().effective || typeof baseMessage !== "string") {
    return baseMessage;
  }
  const loc = normalizeResponseLocale(responseLocale);
  if (loc === "en") {
    return `${baseMessage}\n\n${SURFACE_ASSIST_STRINGS.en.cta}`;
  }
  return `${baseMessage}\n\n${SURFACE_ASSIST_STRINGS.ro.cta}`;
}

function clearLlmSurfaceAssistSessionState(sessionContext) {
  if (!sessionContext || typeof sessionContext !== "object") return;
  delete sessionContext.llmSurfaceAssistConsumed;
}

function clearSurfaceAssistState(sessionContext) {
  if (!sessionContext || typeof sessionContext !== "object") return;
  sessionContext.surfaceUnknown = false;
  sessionContext.surfaceAssistPhase = null;
  sessionContext.surfaceAssistShortlist = null;
  sessionContext.vehicleFieldsRequested = false;
  clearLlmSurfaceAssistSessionState(sessionContext);
  if (sessionContext.slots && typeof sessionContext.slots === "object") {
    delete sessionContext.slots.vehicleMake;
    delete sessionContext.slots.vehicleModel;
    delete sessionContext.slots.vehicleYear;
  }
}

const SURFACE_ASSIST_MAKE_KEYS = [
  "mercedes benz",
  "mercedes",
  "volkswagen",
  "land rover",
  "bmw",
  "audi",
  "ford",
  "dacia",
  "renault",
  "skoda",
  "toyota",
  "tesla",
  "hyundai",
  "kia",
  "opel",
  "peugeot",
  "citroen",
  "mazda",
  "nissan",
  "honda",
  "jeep",
  "volvo",
  "porsche",
  "vw"
];

function parseVehicleSlotsFromMessage(message, existing = {}) {
  const ex = existing && typeof existing === "object" ? existing : {};
  let vehicleYear =
    ex.vehicleYear != null && String(ex.vehicleYear).trim() !== ""
      ? String(ex.vehicleYear).trim()
      : null;
  let vehicleMake =
    ex.vehicleMake != null && String(ex.vehicleMake).trim() !== ""
      ? String(ex.vehicleMake).trim()
      : null;
  let vehicleModel =
    ex.vehicleModel != null && String(ex.vehicleModel).trim() !== ""
      ? String(ex.vehicleModel).trim()
      : null;

  const raw = String(message || "").trim();
  if (!raw) {
    return { vehicleMake, vehicleModel, vehicleYear };
  }

  const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    vehicleYear = vehicleYear || yearMatch[0];
  }

  const gate = normalizeRomanianTextForGate(raw.replace(/\b(19|20)\d{2}\b/g, " "));
  if (!gate) {
    return { vehicleMake, vehicleModel, vehicleYear };
  }

  let makeKeyFound = null;
  for (const key of SURFACE_ASSIST_MAKE_KEYS) {
    const g = key.replace(/\s+/g, "");
    if (!g) continue;
    if (gate.includes(g)) {
      makeKeyFound = key;
      break;
    }
  }

  if (makeKeyFound) {
    const canon =
      makeKeyFound === "vw"
        ? "volkswagen"
        : makeKeyFound === "mercedes benz"
          ? "mercedes"
          : makeKeyFound;
    vehicleMake = vehicleMake || canon;
    const idx = gate.indexOf(makeKeyFound.replace(/\s+/g, ""));
    const tail =
      idx >= 0
        ? gate.slice(idx + makeKeyFound.replace(/\s+/g, "").length).trim()
        : gate.replace(makeKeyFound.replace(/\s+/g, ""), "").trim();
    const stop = new Set([
      "am",
      "am o",
      "masina",
      "masinii",
      "auto",
      "cu",
      "un",
      "o",
      "vreau",
      "ajutor",
      "help",
      "car",
      "year",
      "an",
      "fabricatie",
      "model"
    ]);
    const words = tail.split(/\s+/).filter(w => w.length > 1 && !stop.has(w));
    if (words.length > 0 && !vehicleModel) {
      vehicleModel = words.join(" ").slice(0, 80);
    }
  }

  return { vehicleMake, vehicleModel, vehicleYear };
}

function userSignalsSurfaceAssistIntent(message) {
  const gate = normalizeRomanianTextForGate(message);
  if (!gate) return false;
  if (/\b(19|20)\d{2}\b/.test(String(message || ""))) return true;
  if (
    gate.includes("nu stiu") ||
    gate.includes("nu sunt sigur") ||
    gate.includes("fara idee") ||
    gate.includes("not sure") ||
    gate.includes("no idea") ||
    (gate.includes("ajut") && gate.includes("aleg")) ||
    (gate.includes("help") && gate.includes("pick"))
  ) {
    return true;
  }
  return SURFACE_ASSIST_MAKE_KEYS.some(k => gate.includes(k.replace(/\s+/g, "")));
}

function tryParseExplicitCtoSurfaceFromText(message) {
  const gate = normalizeRomanianTextForGate(message);
  const fromGate = parseCtoSurfaceFromNormalizedGateText(gate);
  if (fromGate) return fromGate;
  const fromSlots = extractSlotsFromMessage(message);
  return coerceLegacySurfaceToCto(fromSlots?.surface || null);
}

function surfaceShortlistDisplayLabel(surface, responseLocale) {
  const loc = normalizeResponseLocale(responseLocale);
  const mapRo = {
    textile: "textil (textile)",
    piele: "piele",
    plastic: "plastic",
    alcantara: "alcantara"
  };
  if (loc === "en") {
    const mapEn = {
      textile: "textile",
      piele: "leather (piele)",
      plastic: "plastic",
      alcantara: "alcantara"
    };
    return mapEn[surface] || surface;
  }
  return mapRo[surface] || surface;
}

function matchUserPickFromShortlist(message, shortlist) {
  const list = Array.isArray(shortlist) ? shortlist : [];
  if (list.length === 0) return null;
  const trimmed = String(message || "").trim();
  const n = parseInt(trimmed, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= list.length) {
    return list[n - 1];
  }
  const gate = normalizeRomanianTextForGate(message);
  for (const s of list) {
    if (!s) continue;
    if (gate.includes(normKeyForShortlistMatch(s))) return s;
  }
  if (gate.includes("textil") && list.includes("textile")) return "textile";
  if ((gate.includes("piele") || gate.includes("leather")) && list.includes("piele")) return "piele";
  return null;
}

function normKeyForShortlistMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildSurfaceShortlistQuestion(shortlist, responseLocale) {
  const loc = normalizeResponseLocale(responseLocale);
  const lines = (Array.isArray(shortlist) ? shortlist : []).map((s, i) => {
    const label = surfaceShortlistDisplayLabel(s, responseLocale);
    return `${i + 1}) ${label}`;
  });
  const head = loc === "en" ? SURFACE_ASSIST_STRINGS.en.shortlistHead : SURFACE_ASSIST_STRINGS.ro.shortlistHead;
  return `${head}\n${lines.join("\n")}`;
}

async function tryConsumeLlmSurfaceAssistTurn({
  sessionId,
  sessionContext,
  userMessage,
  interactionRef,
  endInteractionFn
}) {
  if (!resolveLlmSurfaceAssistFlag().effective) {
    return null;
  }

  const pending = sessionContext.pendingQuestion;
  if (!pending || pending.slot !== "surface") {
    return null;
  }

  const slots = sessionContext.slots && typeof sessionContext.slots === "object" ? sessionContext.slots : {};
  if (!qualifiesForInteriorSurfaceAssist(slots)) {
    return null;
  }

  const msg = String(userMessage || "").trim();
  const loc = normalizeResponseLocale(sessionContext.responseLocale);
  const phase = pending.surfaceAssistLlmPhase || null;

  const emitLlmAssistLog = (fields) => {
    logInfo("LLM_SURFACE_ASSIST", {
      surfaceAssistMode: fields.surfaceAssistMode != null ? fields.surfaceAssistMode : pending.surfaceAssistMode || null,
      llmSurfaceAssistUsed: Boolean(fields.llmSurfaceAssistUsed),
      llmSurfaceAssistError: fields.llmSurfaceAssistError != null ? fields.llmSurfaceAssistError : null,
      llmSurfaceAssistSuggestions: fields.llmSurfaceAssistSuggestions != null
        ? fields.llmSurfaceAssistSuggestions
        : pending.surfaceAssistLlmSuggestions || null,
      sessionId: sessionId != null ? String(sessionId) : null,
      branch: fields.branch || null
    });
  };

  if (phase === "awaiting_pick" && Array.isArray(pending.surfaceAssistLlmSuggestions) && pending.surfaceAssistLlmSuggestions.length) {
    const pickedCanon = matchPickFromLlmSuggestions(
      userMessage,
      pending.surfaceAssistLlmSuggestions,
      sessionContext.responseLocale
    );
    if (pickedCanon) {
      const cto = canonicalToCtoSurface(pickedCanon);
      if (cto && CTO_SURFACE_SET.has(cto)) {
        sessionContext.slots = { ...sessionContext.slots, surface: cto };
        sessionContext.pendingQuestion = null;
        sessionContext.state = null;
        clearPendingClarificationSlots(sessionContext);
        clearSurfaceAssistState(sessionContext);
        saveSession(sessionId, sessionContext);
        emitLlmAssistLog({
          surfaceAssistMode: "llm_advisory",
          llmSurfaceAssistUsed: false,
          llmSurfaceAssistSuggestions: pending.surfaceAssistLlmSuggestions,
          branch: "user_pick_confirmed"
        });
        logInfo("surface_selected", {
          source: "llm_advisory_pick",
          surface: cto,
          sessionId: sessionId != null ? String(sessionId) : null
        });
        return null;
      }
    }
    emitLlmAssistLog({
      surfaceAssistMode: "llm_advisory",
      llmSurfaceAssistUsed: Boolean(sessionContext.llmSurfaceAssistConsumed),
      branch: "reprompt_pick"
    });
    const reply = buildSuggestionsUserMessage(
      pending.surfaceAssistLlmCarLabel || "",
      pending.surfaceAssistLlmSuggestions,
      loc
    );
    const ui = buildSuggestionUiChips(pending.surfaceAssistLlmSuggestions);
    return endInteractionFn(
      interactionRef,
      { type: "question", message: reply, reply, ui },
      {
        slots: { ...(sessionContext.slots || {}) },
        decision: { action: "clarification", flowId: null, missingSlot: "surface" },
        outputType: "question",
        surfaceAssistMode: "llm_advisory",
        llmSurfaceAssistSuggestions: pending.surfaceAssistLlmSuggestions
      }
    );
  }

  if (phase === "awaiting_vehicle") {
    if (userSignalsSurfaceMaterialUncertainty(msg)) {
      const vehicleMsg = loc === "en" ? SURFACE_ASSIST_STRINGS.en.vehiclePrompt : SURFACE_ASSIST_STRINGS.ro.vehiclePrompt;
      emitLlmAssistLog({
        surfaceAssistMode: "llm_advisory",
        llmSurfaceAssistUsed: false,
        branch: "reask_vehicle_uncertainty"
      });
      return endInteractionFn(
        interactionRef,
        { type: "question", message: vehicleMsg },
        {
          slots: { ...(sessionContext.slots || {}) },
          decision: { action: "clarification", flowId: null, missingSlot: "surface" },
          outputType: "question",
          surfaceAssistMode: "llm_advisory"
        }
      );
    }

    const prevV = {
      vehicleMake: slots.vehicleMake || null,
      vehicleModel: slots.vehicleModel || null,
      vehicleYear: slots.vehicleYear || null
    };
    const parsedV = parseVehicleSlotsFromMessage(userMessage, prevV);
    sessionContext.slots = {
      ...sessionContext.slots,
      vehicleMake: parsedV.vehicleMake || prevV.vehicleMake,
      vehicleModel: parsedV.vehicleModel || prevV.vehicleModel,
      vehicleYear: parsedV.vehicleYear || prevV.vehicleYear
    };
    setPendingClarificationSlots(sessionContext, sessionContext.slots);
    saveSession(sessionId, sessionContext);

    const hasMake = Boolean(sessionContext.slots.vehicleMake && String(sessionContext.slots.vehicleMake).trim());
    const hasModel = Boolean(sessionContext.slots.vehicleModel && String(sessionContext.slots.vehicleModel).trim());
    const hasYear = /\b(19|20)\d{2}\b/.test(msg);
    const carLine = buildCarLineFromParsed(parsedV, userMessage);

    if (!sessionContext.llmSurfaceAssistConsumed && ((hasMake && hasModel) || hasYear)) {
      sessionContext.llmSurfaceAssistConsumed = true;
      saveSession(sessionId, sessionContext);
      try {
        const suggestions = await suggestSeatMaterialsAdvisory(carLine, { timeoutMs: 2500 });
        sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
          slot: "surface",
          surfaceAssistMode: "llm_advisory",
          surfaceAssistLlmPhase: "awaiting_pick",
          surfaceAssistLlmSuggestions: suggestions,
          surfaceAssistLlmCarLabel: carLine
        });
        saveSession(sessionId, sessionContext);
        emitLlmAssistLog({
          surfaceAssistMode: "llm_advisory",
          llmSurfaceAssistUsed: true,
          llmSurfaceAssistError: null,
          llmSurfaceAssistSuggestions: suggestions,
          branch: "llm_suggestions_shown"
        });
        const reply = buildSuggestionsUserMessage(carLine, suggestions, loc);
        const ui = buildSuggestionUiChips(suggestions);
        return endInteractionFn(
          interactionRef,
          { type: "question", message: reply, reply, ui },
          {
            slots: { ...(sessionContext.slots || {}) },
            decision: { action: "clarification", flowId: null, missingSlot: "surface" },
            outputType: "question",
            surfaceAssistMode: "llm_advisory",
            llmSurfaceAssistSuggestions: suggestions
          }
        );
      } catch (e) {
        const errMsg = e && e.message ? String(e.message) : "LLM_ERROR";
        emitLlmAssistLog({
          surfaceAssistMode: null,
          llmSurfaceAssistUsed: true,
          llmSurfaceAssistError: errMsg,
          llmSurfaceAssistSuggestions: null,
          branch: "llm_error_fallback"
        });
        sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
          slot: "surface",
          surfaceAssistMode: null,
          surfaceAssistLlmPhase: null,
          surfaceAssistLlmSuggestions: null,
          surfaceAssistLlmCarLabel: null
        });
        saveSession(sessionId, sessionContext);
        const fallbackMsg = getInteriorSurfaceLlmAssistBaseQuestion(loc);
        return endInteractionFn(
          interactionRef,
          { type: "question", message: fallbackMsg },
          {
            slots: { ...(sessionContext.slots || {}) },
            decision: { action: "clarification", flowId: null, missingSlot: "surface" },
            outputType: "question",
            llmSurfaceAssistError: errMsg
          }
        );
      }
    }

    const vehicleMsg = loc === "en" ? SURFACE_ASSIST_STRINGS.en.vehiclePrompt : SURFACE_ASSIST_STRINGS.ro.vehiclePrompt;
    emitLlmAssistLog({
      surfaceAssistMode: "llm_advisory",
      llmSurfaceAssistUsed: false,
      branch: "awaiting_vehicle_need_info"
    });
    return endInteractionFn(
      interactionRef,
      { type: "question", message: vehicleMsg },
      {
        slots: { ...(sessionContext.slots || {}) },
        decision: { action: "clarification", flowId: null, missingSlot: "surface" },
        outputType: "question",
        surfaceAssistMode: "llm_advisory"
      }
    );
  }

  if (!phase) {
    if (userSignalsSurfaceMaterialUncertainty(msg)) {
      sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
        slot: "surface",
        surfaceAssistMode: "llm_advisory",
        surfaceAssistLlmPhase: "awaiting_vehicle"
      });
      saveSession(sessionId, sessionContext);
      const vehicleMsg = loc === "en" ? SURFACE_ASSIST_STRINGS.en.vehiclePrompt : SURFACE_ASSIST_STRINGS.ro.vehiclePrompt;
      emitLlmAssistLog({
        surfaceAssistMode: "llm_advisory",
        llmSurfaceAssistUsed: false,
        branch: "uncertainty_to_vehicle_prompt"
      });
      return endInteractionFn(
        interactionRef,
        { type: "question", message: vehicleMsg },
        {
          slots: { ...(sessionContext.slots || {}) },
          decision: { action: "clarification", flowId: null, missingSlot: "surface" },
          outputType: "question",
          surfaceAssistMode: "llm_advisory"
        }
      );
    }

    const maybeCar =
      userSignalsSurfaceAssistIntent(msg) && !userSignalsSurfaceMaterialUncertainty(msg);
    if (maybeCar) {
      sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
        slot: "surface",
        surfaceAssistMode: "llm_advisory",
        surfaceAssistLlmPhase: "awaiting_vehicle"
      });
      saveSession(sessionId, sessionContext);
      return tryConsumeLlmSurfaceAssistTurn({
        sessionId,
        sessionContext,
        userMessage,
        interactionRef,
        endInteractionFn
      });
    }
  }

  return null;
}

async function tryConsumeSurfaceAssistTurn({
  sessionId,
  sessionContext,
  userMessage,
  interactionRef,
  queryType,
  endInteractionFn
}) {
  const legacyAssist = resolveSurfaceAssistFlag().effective;
  const llmAssist = resolveLlmSurfaceAssistFlag().effective;
  if (!legacyAssist && !llmAssist) return null;
  if (!(queryType === "procedural" || queryType === "selection")) return null;

  const pendingSurface =
    sessionContext?.pendingQuestion?.slot === "surface" ||
    sessionContext?.pendingClarification?.state === "NEEDS_SURFACE" ||
    sessionContext?.state === "NEEDS_SURFACE";

  if (!pendingSurface) return null;

  const slots = sessionContext.slots && typeof sessionContext.slots === "object" ? sessionContext.slots : {};
  if (!qualifiesForInteriorSurfaceAssist(slots)) return null;

  const explicit = tryParseExplicitCtoSurfaceFromText(userMessage);
  if (explicit && CTO_SURFACE_SET.has(explicit)) {
    sessionContext.slots = { ...slots, surface: explicit };
    sessionContext.pendingQuestion = null;
    sessionContext.state = null;
    clearPendingClarificationSlots(sessionContext);
    clearSurfaceAssistState(sessionContext);
    saveSession(sessionId, sessionContext);
    logInfo("surface_selected", {
      source: "explicit_while_assist_eligible",
      surface: explicit,
      shortlist: sessionContext.surfaceAssistShortlist || null,
      sessionId: sessionId != null ? String(sessionId) : null
    });
    return null;
  }

  if (llmAssist) {
    const llmTurn = await tryConsumeLlmSurfaceAssistTurn({
      sessionId,
      sessionContext,
      userMessage,
      interactionRef,
      endInteractionFn
    });
    if (llmTurn) {
      return llmTurn;
    }
  }

  if (!legacyAssist) {
    return null;
  }

  if (sessionContext.surfaceAssistPhase === "shortlist" && Array.isArray(sessionContext.surfaceAssistShortlist)) {
    const picked = matchUserPickFromShortlist(userMessage, sessionContext.surfaceAssistShortlist);
    if (picked) {
      sessionContext.slots = { ...sessionContext.slots, surface: picked };
      logInfo("surface_selected", {
        source: "shortlist",
        surface: picked,
        shortlist: sessionContext.surfaceAssistShortlist,
        sessionId: sessionId != null ? String(sessionId) : null
      });
      sessionContext.pendingQuestion = null;
      sessionContext.state = null;
      clearPendingClarificationSlots(sessionContext);
      clearSurfaceAssistState(sessionContext);
      saveSession(sessionId, sessionContext);
      return null;
    }
    saveSession(sessionId, sessionContext);
    return endInteractionFn(interactionRef, {
      type: "question",
      message: buildSurfaceShortlistQuestion(sessionContext.surfaceAssistShortlist, sessionContext.responseLocale)
    }, {
      slots: { ...(sessionContext.slots || {}) },
      decision: { action: "clarification", flowId: null, missingSlot: "surface" },
      outputType: "question"
    });
  }

  if (!llmAssist) {
    const wasUnknown = sessionContext.surfaceUnknown === true;
    if (!wasUnknown && userSignalsSurfaceAssistIntent(userMessage)) {
      sessionContext.surfaceUnknown = true;
      logInfo("surface_assist_used", {
        reason: "vehicle_or_unsure_signal",
        sessionId: sessionId != null ? String(sessionId) : null
      });
    }

    if (!sessionContext.surfaceUnknown) {
      return null;
    }

    const prevV = {
      vehicleMake: slots.vehicleMake || null,
      vehicleModel: slots.vehicleModel || null,
      vehicleYear: slots.vehicleYear || null
    };
    const parsedV = parseVehicleSlotsFromMessage(userMessage, prevV);
    sessionContext.slots = {
      ...sessionContext.slots,
      vehicleMake: parsedV.vehicleMake || prevV.vehicleMake,
      vehicleModel: parsedV.vehicleModel || prevV.vehicleModel,
      vehicleYear: parsedV.vehicleYear || prevV.vehicleYear
    };
    setPendingClarificationSlots(sessionContext, sessionContext.slots);
    saveSession(sessionId, sessionContext);

    const v = sessionContext.slots;
    const hasMake = Boolean(v.vehicleMake && String(v.vehicleMake).trim());
    const hasModel = Boolean(v.vehicleModel && String(v.vehicleModel).trim());

    if (!sessionContext.vehicleFieldsRequested && (!hasMake || !hasModel)) {
      sessionContext.vehicleFieldsRequested = true;
      saveSession(sessionId, sessionContext);
      const loc = normalizeResponseLocale(sessionContext.responseLocale);
      const msg = loc === "en" ? SURFACE_ASSIST_STRINGS.en.vehiclePrompt : SURFACE_ASSIST_STRINGS.ro.vehiclePrompt;
      return endInteractionFn(interactionRef, {
        type: "question",
        message: msg
      }, {
        slots: { ...(sessionContext.slots || {}) },
        decision: { action: "clarification", flowId: null, missingSlot: "surface" },
        outputType: "question"
      });
    }

    const shortlist = resolveSurfaceShortlist({
      vehicleMake: v.vehicleMake,
      vehicleModel: v.vehicleModel,
      vehicleYear: v.vehicleYear
    });
    sessionContext.surfaceAssistPhase = "shortlist";
    sessionContext.surfaceAssistShortlist = shortlist.slice(0, 3);
    saveSession(sessionId, sessionContext);

    logInfo("vehicle_provided", {
      hasMake,
      hasModel,
      hasYear: Boolean(v.vehicleYear),
      mkLen: v.vehicleMake ? String(v.vehicleMake).length : 0,
      mdLen: v.vehicleModel ? String(v.vehicleModel).length : 0,
      yr: v.vehicleYear ? String(v.vehicleYear).slice(0, 4) : null,
      shortlist: sessionContext.surfaceAssistShortlist,
      sessionId: sessionId != null ? String(sessionId) : null
    });

    return endInteractionFn(interactionRef, {
      type: "question",
      message: buildSurfaceShortlistQuestion(sessionContext.surfaceAssistShortlist, sessionContext.responseLocale)
    }, {
      slots: { ...(sessionContext.slots || {}) },
      decision: { action: "clarification", flowId: null, missingSlot: "surface" },
      outputType: "question"
    });
  }

  return null;
}

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
  anvelope: ["anvelope", "anvelopa", "anvelopelor", "cauciuc", "cauciucuri"],
  jante: ["jante", "janta", "jantele", "wheels", "felgi", "roti", "rotile"],
  caroserie: ["caroserie", "caroseria", "carrosserie", "body"]
};
const OBJECT_SLOT_INFERENCE = {
  oglinda: { context: "exterior", surface: null },
  oglinzi: { context: "exterior", surface: null },
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
  anvelope: "exterior"
};
const OBJECT_SURFACE_MAP = {
  cotiera: ["textile", "piele", "alcantara", "plastic"],
  scaun: ["textile", "piele", "alcantara"],
  volan: ["piele", "alcantara", "plastic"],
  bord: ["plastic"],
  plafon: ["textile", "alcantara"],
  mocheta: ["textile"],
  oglinda: [],
  geam: [],
  parbriz: [],
  glass: [],
  oglinzi: [],
  tapiterie: ["textile", "piele", "alcantara"]
};
const SLOT_DOMAIN_RULES = {
  scaun:     { context: "interior", allowedSurfaces: ["textile", "piele", "alcantara"] },
  bancheta:  { context: "interior", allowedSurfaces: ["textile", "piele", "alcantara"] },
  bord:      { context: "interior", allowedSurfaces: ["plastic"] },
  consola:   { context: "interior", allowedSurfaces: ["plastic"] },
  mocheta:   { context: "interior", allowedSurfaces: ["textile"] },
  volan:     { context: "interior", allowedSurfaces: ["piele", "alcantara", "plastic"] },
  cotiera:   { context: "interior", allowedSurfaces: ["textile", "piele", "alcantara", "plastic"] },
  tapiterie: { context: "interior", allowedSurfaces: ["textile", "piele", "alcantara"] },
  plafon:    { context: "interior", allowedSurfaces: ["textile", "alcantara"] },
  caroserie: { context: "exterior", allowedSurfaces: ["paint"] },
  jante:     { context: "exterior", allowedSurfaces: ["wheels"] },
  anvelope:  { context: "exterior", allowedSurfaces: ["wheels"] },
  geam:      { context: "exterior", allowedSurfaces: [] },
  parbriz:   { context: "exterior", allowedSurfaces: [] },
  oglinzi:   { context: "exterior", allowedSurfaces: [] },
  oglinda:   { context: "exterior", allowedSurfaces: [] }
};
const GLASS_OBJECT_ALIASES = ["sticla", "geam", "geamuri", "parbriz", "glass", "windshield"];
const PAINT_OBJECT_ALIASES = [
  "vopsea",
  "vopseaua",
  "caroserie",
  "caroseria",
  "lac",
  "clear coat",
  "clearcoat",
  "paint"
];

function canonicalizeObjectValue(object) {
  const normalized = normalizeRomanianTextForGate(object);
  if (!normalized) {
    return null;
  }

  if (GLASS_OBJECT_ALIASES.includes(normalized)) {
    return "glass";
  }

  if (["tires", "tyres", "tire"].includes(normalized)) {
    return "anvelope";
  }

  if (PAINT_OBJECT_ALIASES.includes(normalized)) {
    return "caroserie";
  }

  return normalized;
}

function normalizeRomanianTextForGate(text) {
  let s = String(text || "").toLowerCase();
  s = s.replace(/[ăâ]/g, "a").replace(/î/gi, "i").replace(/[șş]/g, "s").replace(/[țţ]/g, "t");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function logSurfaceNormalized(raw, normalizedSurface) {
  if (normalizedSurface == null) {
    return;
  }
  logInfo("SURFACE_NORMALIZED", {
    raw: String(raw).slice(0, 240),
    normalizedSurface
  });
}

function parseCtoSurfaceFromNormalizedGateText(norm) {
  const t = String(norm || "").trim();
  if (!t) {
    return null;
  }
  if (t.includes("material textil")) {
    return "textile";
  }
  if (t.includes("stofa") || t.includes("textil") || t.includes("textile")) {
    return "textile";
  }
  if (t.includes("piele naturala") || t.includes("leather") || t.includes("piele")) {
    return "piele";
  }
  if (t.includes("plastice") || t.includes("plastic")) {
    return "plastic";
  }
  if (t.includes("alcantara") || t.includes("alcantar")) {
    return "alcantara";
  }
  if (/\b(vopsea|vopseaua|lac|lacul|paint|clear coat|clearcoat)\b/.test(t)) {
    return "paint";
  }
  return null;
}

function coerceLegacySurfaceToCto(surface) {
  const s = String(surface || "").toLowerCase().trim();
  if (!s) {
    return null;
  }
  if (CTO_SURFACE_SET.has(s)) {
    return s;
  }
  if (s === "leather") {
    return "piele";
  }
  if (s === "paint") {
    return "paint";
  }
  if (s === "glass" || s === "wheels") {
    return null;
  }
  return null;
}

function hardFilterSurfaceKeyPart(slots) {
  const safe = slots && typeof slots === "object" ? slots : {};
  const ctx = safe.context || "";
  let surf = String(safe.surface || "").toLowerCase().trim();
  const obj = canonicalizeObjectValue(safe.object);

  if (ctx === "interior") {
    if (surf === "piele") {
      return "leather";
    }
    return surf;
  }
  if (ctx === "exterior") {
    if (!surf) {
      if (obj === "glass") {
        return "glass";
      }
      if (obj === "jante" || obj === "roti" || obj === "wheels" || obj === "anvelope") {
        return "wheels";
      }
      if (obj === "caroserie") {
        return "paint";
      }
    }
    return surf;
  }
  return surf;
}

function hardFilterKeyFromSlots(slots) {
  const safe = slots && typeof slots === "object" ? slots : {};
  const ctx = safe.context || "";
  const surf = hardFilterSurfaceKeyPart(safe);
  return `${ctx}|${surf}`;
}

function slotSurfaceToProductTag(surface) {
  const s = String(surface || "").toLowerCase().trim();
  if (s === "piele") {
    return "leather";
  }
  return surface || null;
}

function hasStrongGlassExteriorSignal(message) {
  return hasExplicitInsectSignal(message) && messageMentionsGlassObjectSynonym(message);
}

function hasStrongGlassInteriorSignal(message) {
  const msg = String(message || "").toLowerCase();
  if (msg.includes("pe interior") || msg.includes("in interior") || msg.includes("din interior")) {
    if (msg.includes("geam") || msg.includes("sticla") || msg.includes("parbriz")) {
      return true;
    }
  }
  return msg.includes("urme") && (msg.includes("geam") || msg.includes("sticla")) && msg.includes("interior");
}

function messageMentionsGlassObjectSynonym(message) {
  const msg = String(message || "").toLowerCase();
  return (
    msg.includes("sticla") ||
    msg.includes("sticlă") ||
    msg.includes("geam") ||
    msg.includes("parbriz") ||
    msg.includes("windshield")
  );
}

function resolveGlassObjectFromPendingAnswer(message) {
  if (!messageMentionsGlassObjectSynonym(message)) {
    return null;
  }
  return "glass";
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

  const injected = {
    ...apcProduct,
    selectionMeta: {
      pipeline: "unified",
      roleMatches: ["injected_apc"],
      reasons: ["apc:policy_include"],
      injected: true
    }
  };
  const merged = [injected, ...safeProducts].slice(0, Math.max(MAX_SELECTION_PRODUCTS, 3));
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

function getFlowClarification(flowId, missingSlot, slots, responseLocale = "ro") {
  const promptSlot = mapFlowMissingSlot(flowId, missingSlot, slots);

  if (missingSlot === "context") {
    return {
      missingSlot,
      promptSlot,
      state: "NEEDS_CONTEXT",
      message: getClarificationQuestion("context", slots, responseLocale)
    };
  }

  if (missingSlot === "material") {
    return {
      missingSlot,
      promptSlot,
      state: "NEEDS_SURFACE",
      message: getClarificationQuestion("surface", slots, responseLocale)
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

function getClarificationQuestion(missingSlot, slots, responseLocale = "ro") {
  const loc = normalizeResponseLocale(responseLocale);
  if (missingSlot === "context") {
    if (canonicalizeObjectValue(slots?.object) === "glass") {
      return loc === "en" ? "Interior or exterior?" : "Interior sau exterior?";
    }
    return loc === "en"
      ? "Is this for interior or exterior?"
      : "E pentru interior sau exterior?";
  }

  if (missingSlot === "surface") {
    return buildSurfaceClarificationQuestionWithAssist(slots, responseLocale, null, null);
  }

  if (missingSlot === "object") {
    return loc === "en" ? "Which part are we talking about?" : "Despre ce element este vorba?";
  }

  if (missingSlot === "intent_level") {
    return buildLowSignalClarificationQuestion("", "");
  }

  return loc === "en" ? "Can you share a bit more detail?" : "Poți sa-mi dai mai multe detalii?";
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

     const isIntentLevelClarification = safeDecision.missingSlot === "intent_level";

     if (!isIntentLevelClarification && !["context", "object", "surface"].includes(safeDecision.missingSlot)) {
       throwInvariantFailure("INVALID STATE: invalid missingSlot type", safeDecision, safeSlots, message);
     }

    if (!isIntentLevelClarification) {
      if (safeDecision.missingSlot !== missingSlot) {
        throwInvariantFailure("INVALID STATE: clarification missingSlot mismatch", safeDecision, safeSlots, message);
      }

      if (safeSlots[safeDecision.missingSlot]) {
        throwInvariantFailure("INVALID STATE: slot exists but marked missing", safeDecision, safeSlots, message);
      }
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

   const isIntentLevel = decision.missingSlot === "intent_level";

   if (!isValidatorTriggered && !isIntentLevel && !["context", "object", "surface"].includes(decision.missingSlot)) {
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
    const flowLocale = sessionContext?.responseLocale || sessionContext?.language || "ro";
    const flowResult = executeFlow(prioritizedFlow, availableProducts, slotSnapshot, {
      responseLocale: flowLocale
    });
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
    const flowReply = buildMinimalFlowReply(prioritizedFlow, flowResult, flowLocale);

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
  loggingV2.flushStagesForEarlyExit(interactionRef);

  if (patch.intentType != null) interactionRef.intentType = patch.intentType;
  if (patch.tags != null) interactionRef.tags = patch.tags;
  if (patch.slots != null) interactionRef.slots = patch.slots;
  if (patch.safetyTelemetry) {
    interactionRef.safetyTelemetry = patch.safetyTelemetry;
  }
  if (patch.knowledgeTelemetry) {
    interactionRef.knowledgeTelemetry = patch.knowledgeTelemetry;
  }
  if (patch.lowSignalTelemetry) {
    interactionRef.lowSignalTelemetry = patch.lowSignalTelemetry;
  }
  if (patch.slotCorrectionTelemetry) {
    interactionRef.slotCorrectionTelemetry = patch.slotCorrectionTelemetry;
  }
  if (patch.clarificationEscalationTelemetry) {
    interactionRef.clarificationEscalationTelemetry = patch.clarificationEscalationTelemetry;
  }
  if (patch.contextInferenceTelemetry) {
    interactionRef.contextInferenceTelemetry = {
      ...(interactionRef.contextInferenceTelemetry || {}),
      ...patch.contextInferenceTelemetry
    };
  }
  if (patch.intentRoutingTelemetry) {
    interactionRef.intentRoutingTelemetry = {
      ...(interactionRef.intentRoutingTelemetry || {}),
      ...patch.intentRoutingTelemetry
    };
  }
  if (patch.decision) {
    interactionRef.decision = { ...interactionRef.decision, ...patch.decision };
  }

  let finalResult = result;
  let finalOutputType = patch.outputType != null ? patch.outputType : inferOutputType(result);
  let finalProducts = patch.products != null ? patch.products : summarizeProductsForLog(result.products);
  const explicitProductsReason = patch.productsReason != null ? String(patch.productsReason) : null;
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

  const recoveryPatch = buildKnowledgeDeadEndRecoveryPatch({
    interactionRef,
    sessionContext,
    finalResult,
    finalOutputType,
    finalProducts,
    getMissingSlot
  });
  if (recoveryPatch) {
    finalResult = recoveryPatch.finalResult;
    finalOutputType = recoveryPatch.finalOutputType;
    finalProducts = recoveryPatch.finalProducts;
    interactionRef.decision = { ...interactionRef.decision, ...recoveryPatch.decision };
    interactionRef.knowledgeTelemetry = {
      ...(interactionRef.knowledgeTelemetry || {}),
      ...recoveryPatch.telemetry
    };
    if (sessionContext) {
      if (recoveryPatch.pendingQuestion) {
        sessionContext.pendingQuestion = recoveryPatch.pendingQuestion;
      } else {
        sessionContext.pendingQuestion = null;
      }
      if (recoveryPatch.sessionFlags) {
        Object.assign(sessionContext, recoveryPatch.sessionFlags);
      }
      saveSession(interactionRef.sessionId, sessionContext);
    }
    if (interactionRef.decision.action === "clarification") {
      interactionRef.decision = enforceClarificationContract(interactionRef.decision);
    }
  } else if (sessionContext && interactionRef?.decision?.action === "knowledge") {
    const stillDead = isKnowledgeDeadEnd({
      decision: interactionRef.decision,
      outputType: finalOutputType,
      finalProducts,
      replyText: normalizeKnowledgeReplyText(finalResult),
      queryType: interactionRef.queryType
    });
    if (!stillDead) {
      sessionContext.knowledgeDeadEndRecoveryCount = 0;
      saveSession(interactionRef.sessionId, sessionContext);
    }
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
  const sessionLocaleForOut = sessionContext?.responseLocale ?? sessionContext?.language ?? null;
  logInfo("RESPONSE_RENDER", {
    outputType: finalOutputType,
    action: interactionRef?.decision?.action ?? null,
    flowId: interactionRef?.decision?.flowId ?? null,
    responseLocaleUsed: sessionLocaleForOut
  });
  const consistentLocale =
    !sessionLocaleForOut ||
    String(sessionLocaleForOut).toLowerCase() ===
      String(sessionContext?.responseLocale ?? sessionContext?.language ?? "").toLowerCase();
  logInfo("LOCALE_OUTPUT_CONSISTENCY", {
    sessionLocale: sessionLocaleForOut,
    responseLocaleUsed: sessionLocaleForOut,
    consistent: consistentLocale
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
    const shouldArmSelectionCarryoverContext =
      interactionRef?.decision?.action === "recommend" ||
      finalOutputType === "recommendation" ||
      interactionRef?.queryType === "selection";
    if (shouldArmSelectionCarryoverContext) {
      const slotsForCarry = sessionContext.slots && typeof sessionContext.slots === "object"
        ? sessionContext.slots
        : {};
      sessionContext.selectionFollowupCarryover = {
        slots: {
          context: slotsForCarry.context || null,
          object: slotsForCarry.object || null,
          surface: slotsForCarry.surface || null
        }
      };
      sessionContext.selectionFollowupCarryoverContext = {
        source: "selection_or_recommendation",
        active: true
      };
    } else if (sessionContext.selectionFollowupCarryoverContext) {
      sessionContext.selectionFollowupCarryoverContext = {
        ...sessionContext.selectionFollowupCarryoverContext,
        active: false
      };
    }
    saveSession(interactionRef.sessionId, sessionContext);
  }

  const assistantReply =
    finalResult && typeof finalResult === "object"
      ? String(finalResult.reply ?? finalResult.message ?? "").trim() || null
      : null;

  const entry = {
    timestamp: interactionRef.timestamp,
    sessionId: interactionRef.sessionId,
    message: interactionRef.message,
    assistantReply,
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
      productsReason:
        explicitProductsReason ??
        (interactionRef.decision.action === "flow" && Array.isArray(finalProducts) && finalProducts.length === 0
          ? "no_matching_products"
          : null)
    },
    pendingQuestion: sessionContext?.pendingQuestion || null,
    clarificationAttemptCount:
      interactionRef.clarificationEscalationTelemetry?.clarificationAttemptCount ??
      sessionContext?.pendingQuestion?.attemptCount ??
      null,
    clarificationEscalated: Boolean(
      interactionRef.clarificationEscalationTelemetry?.clarificationEscalated ??
      sessionContext?.pendingQuestion?.escalated
    ),
    clarificationEscalationType:
      interactionRef.clarificationEscalationTelemetry?.clarificationEscalationType ??
      (sessionContext?.pendingQuestion?.escalated ? "chips" : null),
    clarificationFailureReason:
      interactionRef.clarificationEscalationTelemetry?.clarificationFailureReason ??
      sessionContext?.pendingQuestion?.lastFailureReason ??
      null,
    chipSetId:
      interactionRef.clarificationEscalationTelemetry?.chipSetId ??
      null,
    chipSelection:
      interactionRef.clarificationEscalationTelemetry?.chipSelection ??
      null,
    feedback: interactionRef.feedback,
    safetyGateTriggered: Boolean(interactionRef.safetyTelemetry?.safetyGateTriggered),
    safetyReason: interactionRef.safetyTelemetry?.safetyReason ?? null,
    missingCriticalField: interactionRef.safetyTelemetry?.missingCriticalField ?? null,
    safetyAnswerType: interactionRef.safetyTelemetry?.safetyAnswerType ?? null,
    askedClarification: Boolean(interactionRef.safetyTelemetry?.askedClarification),
    blockedProductRouting: Boolean(interactionRef.safetyTelemetry?.blockedProductRouting),
    knowledgeDeadEndDetected: Boolean(interactionRef.knowledgeTelemetry?.knowledgeDeadEndDetected),
    knowledgeRecoveryApplied: Boolean(interactionRef.knowledgeTelemetry?.knowledgeRecoveryApplied),
    knowledgeRecoveryReason: interactionRef.knowledgeTelemetry?.knowledgeRecoveryReason ?? null,
    knowledgeRecoveryQuestionType: interactionRef.knowledgeTelemetry?.knowledgeRecoveryQuestionType ?? null,
    lowSignalDetected: Boolean(interactionRef.lowSignalTelemetry?.lowSignalDetected),
    lowSignalReason: interactionRef.lowSignalTelemetry?.lowSignalReason ?? null,
    lowSignalRecoveryApplied: Boolean(interactionRef.lowSignalTelemetry?.lowSignalRecoveryApplied),
    lowSignalQuestionType: interactionRef.lowSignalTelemetry?.lowSignalQuestionType ?? null,
    slotCorrectionApplied: Boolean(interactionRef.slotCorrectionTelemetry?.slotCorrectionApplied),
    slotCorrectionReason: interactionRef.slotCorrectionTelemetry?.slotCorrectionReason ?? null,
    slotChanges: interactionRef.slotCorrectionTelemetry?.slotChanges ?? null,
    pendingQuestionBefore: interactionRef.slotCorrectionTelemetry?.pendingQuestionBefore ?? null,
    pendingQuestionAfter: interactionRef.slotCorrectionTelemetry?.pendingQuestionAfter ?? null,
    contextInferenceAttempted: Boolean(interactionRef.contextInferenceTelemetry?.contextInferenceAttempted),
    contextInferenceResult: interactionRef.contextInferenceTelemetry?.contextInferenceResult ?? null,
    contextInferenceReason: interactionRef.contextInferenceTelemetry?.contextInferenceReason ?? null,
    contextWasDefaulted: Boolean(interactionRef.contextInferenceTelemetry?.contextWasDefaulted),
    contextClarificationAsked: Boolean(interactionRef.contextInferenceTelemetry?.contextClarificationAsked),
    intentHeuristicOverrideApplied: Boolean(
      interactionRef.intentRoutingTelemetry?.intentHeuristicOverrideApplied
    ),
    intentHeuristicOverrideFrom: interactionRef.intentRoutingTelemetry?.intentHeuristicOverrideFrom ?? null,
    intentHeuristicOverrideTo: interactionRef.intentRoutingTelemetry?.intentHeuristicOverrideTo ?? null,
    intentHeuristicReason: interactionRef.intentRoutingTelemetry?.intentHeuristicReason ?? null,
    preprocessStrippedGreeting: Boolean(
      interactionRef.intentRoutingTelemetry?.preprocessStrippedGreeting
    )
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

  loggingV2.emitTurnSummary(interactionRef, finalResult, finalOutputType, finalProducts);

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

function buildMinimalFlowReply(flowDefinition, flowResult, responseLocale = "ro") {
  const explicitReply = String(flowResult?.reply || "").trim();

  if (explicitReply) {
    return explicitReply;
  }

  const loc = normalizeResponseLocale(responseLocale);
  const flowTitle = String(flowDefinition?.title || flowDefinition?.flowId || "flow");
  const steps = Array.isArray(flowDefinition?.steps) ? flowDefinition.steps : [];

  if (steps.length === 0) {
    return loc === "en"
      ? `Here is a quick guide for ${flowTitle}.`
      : `Iata un ghid rapid pentru ${flowTitle}.`;
  }

  const lines = loc === "en"
    ? [`Here are the steps for ${flowTitle}:`]
    : [`Iata pasii pentru ${flowTitle}:`];
  steps.forEach((step, index) => {
    const fallbackTitle = loc === "en" ? `Step ${index + 1}` : `Pas ${index + 1}`;
    const stepTitle = String(step?.title || fallbackTitle);
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
    anvelope: ["anvelope", "anvelopa", "cauciuc", "cauciucuri"],
    jante: ["jante", "janta", "jantele", "wheels", "felgi", "roti", "rotile"],
    caroserie: [
      "caroserie",
      "caroseria",
      "carrosserie",
      "body",
      "vopsea",
      "vopseaua",
      "lac",
      "clear coat",
      "clearcoat",
      "paint"
    ]
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
  if (!object && /\btires?\b/i.test(text)) object = "anvelope";
  if (!object && /\btyres?\b/i.test(text)) object = "anvelope";
  object = canonicalizeObjectValue(object);

  const gateNorm = normalizeRomanianTextForGate(message);
  let inferredSurface = parseCtoSurfaceFromNormalizedGateText(gateNorm);
  const hasPaintLexeme = /\b(vopsea|vopseaua|lac|lacul|paint|clear coat|clearcoat)\b/.test(gateNorm);
  const hasGlassLexeme = /\b(geam|geamuri|parbriz|sticla|glass|windshield)\b/.test(gateNorm);
  const tokenCount = gateNorm ? gateNorm.split(/\s+/).filter(Boolean).length : 0;
  const hasExteriorPaintContext = /\b(exterior|exteriorul|exterioara|afara|caroserie|masin[aei]?)\b/.test(gateNorm);
  if (hasPaintLexeme) {
    if (tokenCount <= 2 && !hasExteriorPaintContext) {
      // Keep single-word paint replies object-only; pending clarification logic handles next step.
      inferredSurface = inferredSurface === "paint" ? null : inferredSurface;
    } else if (!hasGlassLexeme) {
      inferredSurface = "paint";
    } else if (object === "caroserie") {
      inferredSurface = "paint";
    } else if (object === "glass") {
      inferredSurface = inferredSurface === "paint" ? null : inferredSurface;
    }
  }
  if (inferredSurface) {
    logSurfaceNormalized(message, inferredSurface);
  }

  let resolvedContext = objectOverride.context || null;
  if (!resolvedContext) {
    const inf = inferContext({
      message,
      normalizedMessage: gateNorm,
      slots: { object, surface: inferredSurface, context: null },
      slotMeta: null,
      pendingQuestion: null
    });
    if (inf.inferredContext && inf.confidence === "strong") {
      resolvedContext = inf.inferredContext;
      logContextInferenceTrace({
        phase: "extract_slots",
        inferredContext: inf.inferredContext,
        reason: inf.reason,
        confidence: inf.confidence
      });
    }
  }

  const baseSlots = {
    context: resolvedContext,
    surface: inferredSurface,
    object
  };
  return applyWheelTireObjectToSlots(message, baseSlots);
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
  if (msg.includes("anvelope") || msg.includes("anvelopa") || msg.includes("cauciuc")) object = object || "anvelope";
  if (/\btires?\b/.test(msg) || /\btyres?\b/.test(msg)) object = object || "anvelope";
  if (msg.includes("jante") || msg.includes("roti") || msg.includes("rotile")) object = object || "jante";
  if (msg.includes("caroserie") || msg.includes("carrosserie")) object = object || "caroserie";
  object = canonicalizeObjectValue(object);

  // SURFACE (CTO enum only; glass/vopsea are object/context, not surface)
  if (msg.includes("piele")) surface = "piele";
  if (msg.includes("alcantara")) surface = "alcantara";
  if (msg.includes("textil")) surface = "textile";
  if (msg.includes("plastic")) surface = "plastic";
  if (msg.includes("vopsea")) surface = "paint";
  if (msg.includes("sticla") || msg.includes("geam") || msg.includes("parbriz")) {
    surface = surface || null;
  }
  if (surface) {
    logSurfaceNormalized(msg, surface);
  }

  // AUTO-INFER CONTEXT from object when not explicit (no surface-only inference for piele/textile)
  if (!context) {
    if (object === "scaun" || object === "cotiera" || object === "mocheta" || object === "bord" || object === "volan") {
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
  const prev = sessionSlots && typeof sessionSlots === "object" ? sessionSlots : {};
  const next = newSlots && typeof newSlots === "object" ? newSlots : {};
  return {
    context: next.context || prev.context || null,
    surface: next.surface || prev.surface || null,
    object: next.object || prev.object || null,
    vehicleMake: next.vehicleMake ?? prev.vehicleMake ?? null,
    vehicleModel: next.vehicleModel ?? prev.vehicleModel ?? null,
    vehicleYear: next.vehicleYear ?? prev.vehicleYear ?? null
  };
}

function mergePendingClarificationSlots(previousSlots, parsedSlots) {
  const previous = previousSlots && typeof previousSlots === "object" ? previousSlots : {};
  const parsed = parsedSlots && typeof parsedSlots === "object" ? parsedSlots : {};

  return {
    context: parsed.context ?? previous.context ?? null,
    surface: parsed.surface ?? previous.surface ?? null,
    object: parsed.object ?? previous.object ?? null,
    vehicleMake: parsed.vehicleMake ?? previous.vehicleMake ?? null,
    vehicleModel: parsed.vehicleModel ?? previous.vehicleModel ?? null,
    vehicleYear: parsed.vehicleYear ?? previous.vehicleYear ?? null
  };
}

function getPendingClarificationSlots(sessionContext) {
  const scoped = sessionContext?.pendingClarification?.pendingSlots;
  if (scoped && typeof scoped === "object") {
    return scoped;
  }
  const legacy = sessionContext?.pendingSlots;
  if (legacy && typeof legacy === "object") {
    return legacy;
  }
  return {};
}

function setPendingClarificationSlots(sessionContext, slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  sessionContext.pendingClarification = sessionContext.pendingClarification || {};
  sessionContext.pendingClarification.pendingSlots = safeSlots;
  // Backward-compatibility with previous field.
  sessionContext.pendingSlots = safeSlots;
}

function clearPendingClarificationSlots(sessionContext) {
  if (sessionContext?.pendingClarification && typeof sessionContext.pendingClarification === "object") {
    sessionContext.pendingClarification.pendingSlots = null;
    sessionContext.pendingClarification.active = false;
    sessionContext.pendingClarification.state = null;
  }
  sessionContext.pendingSlots = null;
}

function createPendingQuestionState(previousPending, nextPending) {
  return buildPendingQuestionState(previousPending, nextPending);
}

function seedPendingClarificationAtEmission(sessionContext, missingSlot) {
  const normalizedMissing = String(missingSlot || "").toLowerCase();
  const state = normalizedMissing
    ? `NEEDS_${normalizedMissing.toUpperCase()}`
    : null;
  const pendingSlots = {
    context: sessionContext?.slots?.context ?? null,
    object: sessionContext?.slots?.object ?? null,
    surface: sessionContext?.slots?.surface ?? null,
    vehicleMake: sessionContext?.slots?.vehicleMake ?? null,
    vehicleModel: sessionContext?.slots?.vehicleModel ?? null,
    vehicleYear: sessionContext?.slots?.vehicleYear ?? null
  };
  const responseLocale =
    sessionContext.responseLocale ||
    sessionContext.language ||
    "ro";

  sessionContext.pendingClarification = {
    active: true,
    state,
    pendingSlots,
    responseLocale
  };
  // Backward compatibility with previous field.
  sessionContext.pendingSlots = pendingSlots;

  logInfo("CLARIFICATION_SEEDED_PENDING_SLOTS", {
    state,
    missingSlot: normalizedMissing || null,
    pendingSlots,
    responseLocale
  });
  logInfo("CLARIFICATION_SEEDED", {
    state,
    missingSlot: normalizedMissing || null,
    responseLocale
  });
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
  const safeSlots = slots && typeof slots === "object" ? { ...slots } : {};
  const obj = canonicalizeObjectValue(safeSlots.object);
  if (obj) {
    safeSlots.object = obj;
  }
  if (obj === "glass") {
    return safeSlots;
  }
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

function applyObjectContextInferenceInPlace(slots, slotMeta) {
  if (!slots || typeof slots !== "object") {
    return slots;
  }

  const meta = slotMeta && typeof slotMeta === "object" ? slotMeta : null;
  if (meta && meta.context === "confirmed") {
    return slots;
  }

  const obj = canonicalizeObjectValue(slots.object);
  if (obj) {
    slots.object = obj;
  }

  if (slots.context) {
    return slots;
  }

  if (obj === "glass" || obj === "oglinda" || obj === "oglinzi") {
    return slots;
  }

  if (obj && OBJECT_CONTEXT_MAP[obj]) {
    slots.context = OBJECT_CONTEXT_MAP[obj];
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
    const s = String(safeSlots.surface || "").toLowerCase().trim();
    return Boolean(s) && CTO_SURFACE_SET.has(s);
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
  return hasExplicitInsectSignal(message) || sessionContext?.intentFlags?.bug === true;
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
  const surfRaw = slotSource.surface !== null && slotSource.surface !== undefined ? String(slotSource.surface).trim() : "";
  const hasCtoSurface = surfRaw !== "" && CTO_SURFACE_SET.has(surfRaw.toLowerCase());

  if (!hasContext) return "context";
  if (!hasObject) return "object";

  const ctx = String(slotSource.context || "").toLowerCase();
  const obj = canonicalizeObjectValue(slotSource.object);

  if (ctx === "interior") {
    if (obj === "glass" || obj === "jante" || obj === "anvelope" || obj === "caroserie") {
      return null;
    }
    if (obj === "mocheta" || obj === "bord") {
      return null;
    }
    if (!hasCtoSurface) return "surface";
    return null;
  }

  if (ctx === "exterior") {
    const glassObjects = new Set(["glass", "geam", "parbriz", "oglinzi", "oglinda"]);
    if (glassObjects.has(obj)) {
      return null;
    }
    if (obj === "caroserie" && !surfRaw) return "surface";
    if ((obj === "jante" || obj === "roti" || obj === "wheels" || obj === "anvelope") && !surfRaw) return "surface";
    return null;
  }

  if (!surfRaw) return "surface";
  return null;
}

function getMissingSlotForRequiredList(slots, requiredList) {
  const req = new Set(
    (Array.isArray(requiredList) ? requiredList : [])
      .map(s => String(s || "").toLowerCase().trim())
      .filter(s => ["context", "object", "surface"].includes(s))
  );
  if (req.size === 0) {
    return null;
  }

  const slotSource = slots && typeof slots === "object" ? slots : {};
  const hasContext =
    slotSource.context !== null &&
    slotSource.context !== undefined &&
    String(slotSource.context).trim() !== "";
  const hasObject =
    slotSource.object !== null &&
    slotSource.object !== undefined &&
    String(slotSource.object).trim() !== "";
  const surfRaw =
    slotSource.surface !== null && slotSource.surface !== undefined
      ? String(slotSource.surface).trim()
      : "";
  const hasCtoSurface = surfRaw !== "" && CTO_SURFACE_SET.has(surfRaw.toLowerCase());
  const ctx = String(slotSource.context || "").toLowerCase();
  const obj = canonicalizeObjectValue(slotSource.object);

  if (req.has("context") && !hasContext) {
    return "context";
  }
  if (req.has("object") && !hasObject) {
    return "object";
  }
  if (req.has("surface")) {
    if (ctx === "interior") {
      if (obj === "glass" || obj === "jante" || obj === "anvelope" || obj === "caroserie") {
        return null;
      }
      if (obj === "mocheta" || obj === "bord") {
        return null;
      }
      if (!hasCtoSurface) {
        return "surface";
      }
      return null;
    }
    if (ctx === "exterior") {
      const glassObjects = new Set(["glass", "geam", "parbriz", "oglinzi", "oglinda"]);
      if (glassObjects.has(obj)) {
        return null;
      }
      if (obj === "caroserie" && !surfRaw) {
        return "surface";
      }
      if ((obj === "jante" || obj === "roti" || obj === "wheels" || obj === "anvelope") && !surfRaw) {
        return "surface";
      }
      return null;
    }
    if (!surfRaw) {
      return "surface";
    }
    return null;
  }
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
    normalized.object = "jante";
    normalized.surface = null;
  }

  if (normalized.object === "mocheta" && !normalized.surface) {
    normalized.surface = "textile";
    logSurfaceNormalized("(infer mocheta)", "textile");
  }
  if (normalized.object === "bord" && !normalized.surface) {
    normalized.surface = "plastic";
    logSurfaceNormalized("(infer bord)", "plastic");
  }

  if (normalized.object === "glass") {
    normalized.surface = null;
  }

  const beforeCoerce = normalized.surface;
  const coerced = coerceLegacySurfaceToCto(normalized.surface);
  if (coerced !== beforeCoerce && coerced != null) {
    logSurfaceNormalized(String(beforeCoerce), coerced);
  }
  normalized.surface = coerced;

  return normalized;
}

function getAllowedSurfaces(slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};

  if (safeSlots.object && OBJECT_SURFACE_MAP[safeSlots.object]) {
    const mapped = OBJECT_SURFACE_MAP[safeSlots.object];
    if (Array.isArray(mapped) && mapped.length > 0) {
      return mapped;
    }
  }

  if (safeSlots.context === "interior") {
    return [...CTO_SURFACE_ENUM];
  }

  if (safeSlots.context === "exterior") {
    return ["paint", "wheels", "glass"];
  }

  return [...CTO_SURFACE_ENUM, "paint", "wheels", "glass"];
}

function buildSurfaceClarificationQuestionWithAssist(slots, responseLocale, sessionId, sessionState = null) {
  const loc = normalizeResponseLocale(responseLocale);
  const raw = slots && typeof slots === "object" ? slots : {};
  const inferred = { ...raw };
  applyObjectContextInferenceInPlace(inferred, null);
  const s = inferred;
  let base;
  const llmAssistInterior = resolveLlmSurfaceAssistFlag().effective && qualifiesForInteriorSurfaceAssist(s);
  if (s.context === "interior") {
    base = llmAssistInterior ? getInteriorSurfaceLlmAssistBaseQuestion(loc) : getProceduralSurfaceEnumQuestion(loc);
  } else if (s.context === "exterior") {
    base =
      loc === "en"
        ? "What do you want to clean outside: paint, wheels, or glass?"
        : "Ce vrei sa cureti la exterior: vopsea, jante sau geamuri?";
  } else {
    base = getProceduralSurfaceEnumQuestion(loc);
  }
  const flag = resolveSurfaceAssistFlag();
  const assistEligible = flag.effective && qualifiesForInteriorSurfaceAssist(s);
  const message =
    assistEligible && !llmAssistInterior ? appendSurfaceAssistFallbackCTA(base, loc) : base;
  logInfo("SURFACE_ASSIST_CTA_ATTACHED", {
    enabledEffective: Boolean(assistEligible && !llmAssistInterior),
    llmAssistInteriorCopy: Boolean(llmAssistInterior),
    enabledSources: flag.enabledSources,
    rawEnvValue: flag.rawEnvValue,
    missingSlot: "surface",
    state: sessionState != null ? sessionState : null,
    responseLocale: loc,
    sessionId: sessionId != null ? String(sessionId) : null
  });
  return message;
}

function detectContextHint(message) {
  const inf = inferContext({
    message,
    slotMeta: null,
    pendingQuestion: null
  });
  if (inf.inferredContext && inf.confidence === "strong") {
    return inf.inferredContext;
  }
  return null;
}

function inferWheelsSurfaceFromObject(slots) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const object = String(safeSlots.object || "").toLowerCase();

  if (!safeSlots.surface && (object === "wheels" || object === "jante" || object === "anvelope")) {
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
    requiredAny: ["leather_cleaner", "leather_conditioner", "interior_cleaner"],
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
  const key = hardFilterKeyFromSlots(safeSlots);
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

  if (filtered.length === 0 && safeCandidates.length > 0) {
    logInfo("HARD_FILTER_ZERO_MATCH", {
      key,
      requiredAny,
      requiredAllCombos,
      allow,
      sampleProductTags: safeCandidates.slice(0, 5).map(p => ({
        name: p?.name || null,
        tags: normalizeProductTags(p)
      }))
    });
  }

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

  if ((slots?.surface === "leather" || slots?.surface === "piele") && tags.includes("leather")) {
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

function returnSelectionFailSafe(
  interactionRef,
  sessionId,
  selectionDecision,
  selectionSlots = null,
  options = {}
) {
  const reply =
    options.reply ||
    "Nu sunt sigur ce produs se potrivește perfect aici, dar te pot ghida pas cu pas dacă vrei.";
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
    productsReason: options.productsReason || "none",
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
      (safeSlots.surface === "leather" || safeSlots.surface === "piele") &&
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
  const slotTagKeys = new Set(["interior", "exterior", "leather", "textile", "alcantara", "plastic", "paint", "glass", "wheels", "piele"]);
  const surfaceTag = slotSurfaceToProductTag(slots.surface);
  const slotTags = [
    slots.context,
    surfaceTag
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
  const requiredTags = Array.isArray(safeRoleConfig.requiredTags)
    ? safeRoleConfig.requiredTags.map(tag => String(tag).toLowerCase())
    : [];
  const optionalTags = Array.isArray(safeRoleConfig.optionalTags)
    ? safeRoleConfig.optionalTags.map(tag => String(tag).toLowerCase())
    : [];
  const excludeTags = Array.isArray(safeRoleConfig.excludeTags)
    ? safeRoleConfig.excludeTags.map(tag => String(tag).toLowerCase())
    : [];
  const safeProducts = Array.isArray(products) ? products : [];
  const normalizeTags = (product) => Array.isArray(product?.tags)
    ? product.tags.map(tag => String(tag).toLowerCase())
    : [];
  const passesTagRules = (product) => {
    const tags = normalizeTags(product);
    if (requiredTags.length > 0 && !requiredTags.every(tag => tags.includes(tag))) {
      return false;
    }
    if (excludeTags.length > 0 && excludeTags.some(tag => tags.includes(tag))) {
      return false;
    }
    return true;
  };

  const strongMatches = safeProducts.filter((product) => {
    if (!passesTagRules(product)) return false;
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
    if (!passesTagRules(product)) return false;
    const productTags = normalizeTags(product);
    if (matchTags.some(tag => productTags.includes(tag))) return true;
    if (requiredTags.length > 0) return requiredTags.every(tag => productTags.includes(tag));
    if (optionalTags.length > 0) return optionalTags.some(tag => productTags.includes(tag));
    return false;
  });

  return weakMatches;
}

const COVERAGE_ROLE_SET = new Set([
  "leather_cleaner",
  "leather_protectant",
  "tire_dressing",
  "glass_cleaner",
  "glass_rain_repellent",
  "rubber_seal_protectant"
]);

function roleCoverageFallbackQuestion(role) {
  if (role === "leather_cleaner" || role === "leather_protectant") {
    return "Vrei sa cureti pielea sau sa o protejezi/hidratezi?";
  }
  if (role === "tire_dressing") {
    return "Vrei luciu umed sau aspect satinat/mat pentru anvelope?";
  }
  if (role === "glass_cleaner" || role === "glass_rain_repellent") {
    return "E pentru interior sau exterior? (ca sa evitam dungi)";
  }
  if (role === "rubber_seal_protectant") {
    return "Vrei sa opresti scartaitul sau doar intretinere/protectie pentru chedere?";
  }
  return "Spune-mi ce rezultat urmaresti ca sa aleg produsul potrivit.";
}

function detectCoverageGapRole(message, slots = {}) {
  const msg = String(message || "").toLowerCase();
  const norm = msg
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t");
  const object = String(slots?.object || "").toLowerCase();
  const surface = String(slots?.surface || "").toLowerCase();

  const leatherCue = /piele|leather/.test(norm) || surface === "piele" || object === "scaun";
  const leatherClean = /curat|spal|murdar|pete/.test(norm);
  const leatherProtect = /protej|hidrat|intretin|condition/.test(norm);
  if (leatherCue && leatherClean) return { role: "leather_cleaner", ask: null };
  if (leatherCue && leatherProtect) return { role: "leather_protectant", ask: null };
  if (leatherCue && !leatherClean && !leatherProtect) {
    return { role: null, ask: "Vrei sa o cureti sau sa o protejezi/hidratezi?" };
  }

  const tireDress = /anvelope|cauciuc|tire|tyre/.test(norm) && /luciu|shine|dressing|gel|blackener|innegr|negre/.test(norm);
  if (tireDress) return { role: "tire_dressing", ask: null };

  const glassCue = /geam|parbriz|sticla|glass/.test(norm) || object === "glass" || surface === "glass";
  const glassHydrophobic = /hidrofob|rain repellent|ploaie/.test(norm);
  if (glassCue && glassHydrophobic && productRoles.glass_rain_repellent) {
    return { role: "glass_rain_repellent", ask: null };
  }
  if (glassCue) return { role: "glass_cleaner", ask: null };

  const sealCue = /chedere|garnituri|cauciuc usi|scartai/.test(norm);
  if (sealCue) return { role: "rubber_seal_protectant", ask: null };

  return { role: null, ask: null };
}

function tryCoverageRoleRelaxedRetry(role, roleConfig, products, settings) {
  if (!COVERAGE_ROLE_SET.has(role) || !roleConfig) return [];
  const roleCandidates = findProductsByRoleConfig(roleConfig, products);
  if (!Array.isArray(roleCandidates) || roleCandidates.length === 0) return [];
  const ranked = applyRanking(roleCandidates, { tags: roleConfig.matchTags || [], priceRange: null }, settings);
  const limited = enforceProductLimit(ranked, Math.min(roleConfig?.maxProducts || MAX_SELECTION_PRODUCTS, MAX_SELECTION_PRODUCTS));
  return buildProductBundle(limited).slice(0, MAX_SELECTION_PRODUCTS);
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

function getFlowDisambiguationQuestion(candidateFlows, slots, responseLocale = "ro") {
  const safeFlows = Array.isArray(candidateFlows) ? candidateFlows : [];
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const loc = normalizeResponseLocale(responseLocale);

  const missing = getMissingSlot(safeSlots);
  if (missing === "context") {
    return {
      state: "NEEDS_CONTEXT",
      message: loc === "en"
        ? "Do you want to clean the interior or the exterior?"
        : "Vrei să cureți interiorul sau exteriorul mașinii?"
    };
  }

  if (missing === "object") {
    return {
      state: "NEEDS_OBJECT",
      message: getClarificationQuestion("object", safeSlots, responseLocale)
    };
  }

  if (missing === "surface") {
    const surfaceOptions = [...new Set(
      safeFlows.flatMap((flow) => Array.isArray(flow?.triggers?.surfaces) ? flow.triggers.surfaces : [])
    )].filter(Boolean);

    if (safeSlots.context === "interior") {
      return {
        state: "NEEDS_SURFACE",
        message: buildSurfaceClarificationQuestionWithAssist(safeSlots, responseLocale, null, "NEEDS_SURFACE")
      };
    }

    const labelMap = {
      textile: "textil",
      piele: "piele",
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
      message: loc === "en"
        ? `Which surface are you working on? (${options})`
        : `Pe ce suprafata vrei să lucrezi? (${options})`
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

  for (const t of wheelTireTagBoost(message)) {
    if (t) tags.add(t);
  }

  if (!Array.isArray(detectedTags) || normalizedTags.length === 0) {
    if (text.includes("parbriz")) {
      tags.add("glass");
      tags.add("exterior");
      fallbackUsed = true;
    }

    if (text.includes("jante")) {
      const wt = analyzeWheelTireMessage(message);
      if (wt.wheelTireIntent !== "tire_dressing") {
        tags.add("wheels");
        tags.add("exterior");
        fallbackUsed = true;
      }
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

    info(SOURCE, `Selecting products (unified pipeline) with tags: ${tags.join(", ")}`);

    const selection = selectProducts({
      tags,
      catalog: products,
      limit: maxProducts,
      message: options.message || tags.join(" "),
      slots: options.slots || {},
      session: options.session || null,
      intent: options.intent || null,
      settings: options.settings || {},
      constraints: {
        strictTagFilter,
        poolSize: options.poolSize || 40,
        fallbackStrategy: options.fallbackStrategy || "relaxed_roles",
        ranking: options.ranking !== false,
        priceRange: options.priceRange || null,
        applyInteriorExteriorFilter: options.applyInteriorExteriorFilter !== false,
        applySlotObjectFilter: options.applySlotObjectFilter !== false
      }
    });

    const found = selection.chosen || [];
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

    if (products.every(p => p?.selectionMeta?.pipeline === "unified")) {
      info(SOURCE, "Skipping secondary ranking (unified product selection pipeline)");
      return products;
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
    return ["mocheta", "cotiera", "scaun", "plafon", "parbriz", "jante", "roti", "anvelope", "geam", "geamuri", "sticla", "vopsea"]
      .some(token => msg.includes(token));
  }

  if (pending.slot === "intent_level" && pending.source === "low_signal") {
    if (classifyIntentLevelReply(message).kind !== "none") {
      return true;
    }
    return isShortSlotValueMessage(message);
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

/**
 * Whether routing slots/tags from the prior turn should carry into this turn.
 * Intentionally does NOT treat generic "short messages" as continuations — that caused
 * cross-intent slot leakage (e.g. jante slots affecting a later "ce este apc?" turn).
 */
function shouldPreserveSlotsForContinuation({
  userMessage,
  sessionContext,
  handledPendingQuestionAnswer,
  handledPendingQuestionAnswerEarly,
  previousState
}) {
  const msgTrim = String(userMessage || "").toLowerCase().trim();
  const shortAffirmation =
    isYes(userMessage) ||
    isNo(userMessage) ||
    msgTrim === "da" ||
    msgTrim === "nu";

  return (
    Boolean(handledPendingQuestionAnswer) ||
    Boolean(handledPendingQuestionAnswerEarly) ||
    Boolean(sessionContext.state && sessionContext.state !== "IDLE") ||
    Boolean(sessionContext.pendingQuestion) ||
    (shortAffirmation &&
      sessionContext.previousAction &&
      String(sessionContext.previousAction).toLowerCase() !== "greeting") ||
    previousState === "NEEDS_CONTEXT" ||
    previousState === "NEEDS_OBJECT" ||
    previousState === "NEEDS_SURFACE" ||
    (isSelectionFollowupMessage(userMessage) && hasCarryoverSelectionContext(sessionContext))
  );
}

/**
 * Strong prior topic for knowledge → selection follow-ups (slots, carry-over blob, pending selection, wheel/tire tags).
 * @param {Record<string, unknown>} sessionContext
 * @returns {boolean}
 */
function hasCarryoverSelectionContext(sessionContext) {
  const sc = sessionContext && typeof sessionContext === "object" ? sessionContext : {};
  const carry = sc.selectionFollowupCarryover;
  if (carry && typeof carry === "object" && carry.slots && typeof carry.slots === "object") {
    const { object, context, surface } = carry.slots;
    if (object || context || surface) {
      return true;
    }
  }
  const slots = sc.slots && typeof sc.slots === "object" ? sc.slots : {};
  if (slots.object || slots.context || slots.surface) {
    return true;
  }
  if (sc.pendingSelection === true) {
    return true;
  }
  if (sc.pendingSelectionMissingSlot) {
    return true;
  }
  const tags = Array.isArray(sc.tags) ? sc.tags : [];
  const tagJoin = tags.map(t => String(t || "").toLowerCase()).join(" ");
  if (/\b(anvelope|jante|roti|cauciuc|wheels|tires|tire|tyre)\b/.test(tagJoin)) {
    return true;
  }
  return false;
}

function getSelectionCarryoverActivationState(sessionContext) {
  const sc = sessionContext && typeof sessionContext === "object" ? sessionContext : {};
  const prevAction = String(sc.previousAction || "").toLowerCase().trim();
  const hasPendingQuestion = Boolean(sc?.pendingQuestion?.active === true);
  const hasPendingSelection = Boolean(sc?.pendingSelection === true);
  const hasExplicitCarryoverContext = Boolean(sc?.selectionFollowupCarryoverContext?.active === true);
  const prevWasRecommendationExperience =
    prevAction === "recommend" ||
    prevAction === "product_search" ||
    String(sc?.lastResponseType || "").toLowerCase() === "recommendation";
  const allowExplicitCarryover = hasExplicitCarryoverContext && prevWasRecommendationExperience;

  return {
    hasPendingQuestion,
    hasPendingSelection,
    hasExplicitCarryoverContext,
    prevAction,
    allowExplicitCarryover,
    carryoverAllowed: hasPendingQuestion || hasPendingSelection || allowExplicitCarryover
  };
}

function selectionFollowupBypassesLowSignalIntentLevel(userMessage, sessionContext) {
  const isSelectionFollowup = isSelectionFollowupMessage(userMessage);
  const isLegacyShape = isLegacySelectionFollowupShape(userMessage);
  const hasCarryover = hasCarryoverSelectionContext(sessionContext);
  const hasPendingSelection = Boolean(sessionContext?.pendingSelection === true);
  const activationState = getSelectionCarryoverActivationState(sessionContext);

  // Tightened: bypass is only allowed when the follow-up truly has session anchor context
  // (carry-over slots / pendingSelection / tags). Legacy shapes are not exempt from this.
  if ((isSelectionFollowup || isLegacyShape) && (!hasCarryover || !activationState.carryoverAllowed)) {
    if (hasCarryover && !activationState.carryoverAllowed) {
      logInfo("FOLLOWUP_CONTEXT_CARRYOVER_SKIPPED", {
        reason: "no_pending_state",
        hasPendingQuestion: activationState.hasPendingQuestion,
        hasPendingSelection: activationState.hasPendingSelection,
        hasExplicitCarryoverContext: activationState.hasExplicitCarryoverContext,
        prevAction: activationState.prevAction || null
      });
    }
    logInfo("LOW_SIGNAL_FOLLOWUP_BYPASS_BLOCKED", {
      reason: !hasCarryover
        ? (isLegacyShape ? "legacy_shape_without_carryover" : "no_carryover_context")
        : "no_pending_state",
      hasCarryover,
      hasPendingSelection,
      hasPendingQuestion: activationState.hasPendingQuestion,
      hasExplicitCarryoverContext: activationState.hasExplicitCarryoverContext,
      prevAction: activationState.prevAction || null,
      messagePreview: String(userMessage || "").slice(0, 120)
    });
    return false;
  }

  if (isLegacyShape) {
    return true;
  }

  return isSelectionFollowup && hasCarryover;
}

function captureInformationalSelectionCarryover(sessionContext, userMessage, queryType, sessionId) {
  if (queryType !== "informational") {
    return;
  }
  const extracted = normalizeSlots(
    applyObjectSlotInference(extractSlotsFromMessage(userMessage))
  );
  if (!(extracted.object || extracted.context || extracted.surface)) {
    return;
  }
  sessionContext.selectionFollowupCarryover = {
    slots: {
      context: extracted.context || null,
      object: extracted.object || null,
      surface: extracted.surface || null
    }
  };
  saveSession(sessionId, sessionContext);
}

function ensureExteriorContextForWheelObjects(slots) {
  const s = slots && typeof slots === "object" ? slots : {};
  const o = String(s.object || "").toLowerCase();
  const wheelLike =
    o === "anvelope" || o === "jante" || o === "roti" || o === "wheels";
  if (!wheelLike || s.context) {
    return s;
  }
  return { ...s, context: "exterior" };
}

function rememberLastNonNullSlots(sessionContext, candidateSlots) {
  const candidate = candidateSlots && typeof candidateSlots === "object" ? candidateSlots : {};
  const hasSignal = Boolean(candidate.context || candidate.object || candidate.surface);
  if (!hasSignal) {
    return false;
  }
  const previous = sessionContext?.lastNonNullSlots && typeof sessionContext.lastNonNullSlots === "object"
    ? sessionContext.lastNonNullSlots
    : {};
  sessionContext.lastNonNullSlots = {
    context: candidate.context ?? previous.context ?? null,
    object: candidate.object ?? previous.object ?? null,
    surface: candidate.surface ?? previous.surface ?? null
  };
  return true;
}

function hasStrongWheelTireSignal(slots) {
  const s = slots && typeof slots === "object" ? slots : {};
  const objectNorm = String(s.object || "").toLowerCase();
  const surfaceNorm = String(s.surface || "").toLowerCase();
  return (
    objectNorm === "anvelope" ||
    objectNorm === "jante" ||
    objectNorm === "roti" ||
    objectNorm === "wheels" ||
    surfaceNorm === "wheels"
  );
}

function seedSelectionSlotsFromRecentMemory(sessionContext) {
  const fromCarryover = sessionContext?.selectionFollowupCarryover?.slots;
  const fromMemory = sessionContext?.lastNonNullSlots;
  const fromProcedural = sessionContext?.lastProceduralSlots;
  const sources = [
    { name: "selection_followup_carryover", slots: fromCarryover },
    { name: "last_non_null_slots", slots: fromMemory },
    { name: "last_procedural_slots", slots: fromProcedural }
  ];

  for (const source of sources) {
    const candidate = source?.slots && typeof source.slots === "object" ? source.slots : null;
    if (!candidate || !hasStrongWheelTireSignal(candidate)) {
      continue;
    }
    const merged = normalizeSlots(
      applyObjectSlotInference(
        mergeSlots(sessionContext?.slots || {}, candidate)
      )
    );
    const inferred = ensureExteriorContextForWheelObjects(inferWheelsSurfaceFromObject(merged));
    if (inferred.context || inferred.object || inferred.surface) {
      sessionContext.slots = inferred;
      return { applied: true, source: source.name, slots: inferred };
    }
  }

  const tagList = Array.isArray(sessionContext?.tags)
    ? sessionContext.tags.map(tag => String(tag || "").toLowerCase())
    : [];
  const hasWheelTireTags = tagList.some(tag =>
    ["anvelope", "jante", "roti", "wheels", "tires", "tire", "tyre", "cauciuc"].includes(tag)
  );
  if (hasWheelTireTags) {
    const inferredFromTags = ensureExteriorContextForWheelObjects(
      inferWheelsSurfaceFromObject(
        mergeSlots(sessionContext?.slots || {}, { context: "exterior", object: "anvelope" })
      )
    );
    sessionContext.slots = inferredFromTags;
    return { applied: true, source: "session_tags_wheel_tire", slots: inferredFromTags };
  }

  return { applied: false, source: null, slots: sessionContext?.slots || {} };
}

function applySelectionFollowupCarryoverHydration(userMessage, sessionContext, sessionId) {
  if (!isSelectionFollowupMessage(userMessage) || !hasCarryoverSelectionContext(sessionContext)) {
    return;
  }
  const activationState = getSelectionCarryoverActivationState(sessionContext);
  if (!activationState.carryoverAllowed) {
    logInfo("FOLLOWUP_CONTEXT_CARRYOVER_SKIPPED", {
      reason: "no_pending_state",
      hasPendingQuestion: activationState.hasPendingQuestion,
      hasPendingSelection: activationState.hasPendingSelection,
      hasExplicitCarryoverContext: activationState.hasExplicitCarryoverContext,
      prevAction: activationState.prevAction || null
    });
    return;
  }
  const carry = sessionContext.selectionFollowupCarryover;
  if (!carry?.slots || typeof carry.slots !== "object") {
    return;
  }
  const fromMsg = normalizeSlots(applyObjectSlotInference(extractSlotsFromMessage(userMessage)));
  const msgHasAnchor = Boolean(fromMsg.object || fromMsg.context || fromMsg.surface);
  if (msgHasAnchor) {
    return;
  }
  const preferConfirmed = (key, prev, incoming) => {
    const meta = sessionContext.slotMeta && typeof sessionContext.slotMeta === "object"
      ? sessionContext.slotMeta
      : null;
    if (meta && meta[key] === "confirmed" && prev) {
      return prev;
    }
    return incoming || prev || null;
  };
  const cur = sessionContext.slots && typeof sessionContext.slots === "object" ? sessionContext.slots : {};
  let merged = {
    context: preferConfirmed("context", cur.context, carry.slots.context),
    object: preferConfirmed("object", cur.object, carry.slots.object),
    surface: preferConfirmed("surface", cur.surface, carry.slots.surface),
    vehicleMake: cur.vehicleMake ?? null,
    vehicleModel: cur.vehicleModel ?? null,
    vehicleYear: cur.vehicleYear ?? null
  };
  merged = normalizeSlots(applyObjectSlotInference(merged));
  merged = inferWheelsSurfaceFromObject(merged);
  merged = ensureExteriorContextForWheelObjects(merged);
  sessionContext.slots = merged;
  if (activationState.allowExplicitCarryover && sessionContext?.selectionFollowupCarryoverContext) {
    sessionContext.selectionFollowupCarryoverContext = {
      ...sessionContext.selectionFollowupCarryoverContext,
      active: false
    };
  }
  saveSession(sessionId, sessionContext);
  logInfo("FOLLOWUP_CONTEXT_CARRYOVER_APPLIED", {
    slots: merged,
    source: "selectionFollowupCarryover"
  });
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

  // "De ce am nevoie de X?" is domain knowledge, not "why are you asking me".
  if (isInformationalKnowledgeShape(message)) {
    return null;
  }

  if (
    msg.includes("de ce intrebi") ||
    msg.includes("de ce ma intrebi") ||
    msg.includes("de ce mă întrebi") ||
    msg.includes("de ce imi pui") ||
    msg.includes("de ce îmi pui")
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

  if (isInformationalKnowledgeShape(message)) {
    return null;
  }

  if (
    msg.includes("de ce intrebi") ||
    msg.includes("de ce ma intrebi") ||
    msg.includes("de ce mă întrebi") ||
    msg.includes("ce vrei sa stii") ||
    msg.includes("ce vrei să știi")
  ) {
    return "meta";
  }

  return null;
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

// Deterministic how-to action detector (procedural).
// Matches: cum curat/curăț, cum spal, cum scot, cum îndepărtez/indepartez, cum aplic
function matchesHowToAction(message) {
  const msg = normalizeRomanianTextForGate(message);
  const howToPatterns = [
    "cum curat",
    "cum spal",
    "cum scot",
    "cum indepartez",
    "cum indepar",
    "cum aplic"
  ];
  return howToPatterns.some(p => msg.includes(p));
}

// Deterministic informational exception detector.
// Matches: cum funcționează, ce este, ce înseamnă
// These must remain informational and must NOT produce steps.
function matchesInformationalException(message) {
  const msg = normalizeRomanianTextForGate(message);
  const informationalPatterns = [
    "cum functioneaza",
    "ce este",
    "ce inseamna"
  ];
  return informationalPatterns.some(p => msg.includes(p));
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
  safeContext.glassFlowContextLocked = false;
  clearPendingClarificationSlots(safeContext);
  safeContext.state = "IDLE";
  clearSurfaceAssistState(safeContext);
  clearClarificationAskTracking(safeContext);

  saveSession(sessionId, safeContext);

  return safeContext;
}

function resetSessionAfterAbuse(sessionContext, sessionId) {
  const safeContext = sessionContext && typeof sessionContext === "object"
    ? sessionContext
    : {};

  safeContext.slots = {};
  safeContext.pendingQuestion = null;
  clearPendingClarificationSlots(safeContext);
  clearSurfaceAssistState(safeContext);
  safeContext.pendingSelection = false;
  safeContext.pendingSelectionMissingSlot = null;
  safeContext.state = "IDLE";
  safeContext.originalIntent = null;
  safeContext.lastFlow = null;
  safeContext.intentFlags = {};
  safeContext.glassFlowContextLocked = false;
  clearClarificationAskTracking(safeContext);
  safeContext.slotMeta = { context: "unknown", surface: "unknown", object: "unknown" };

  saveSession(sessionId, safeContext);
  logInfo("PENDING_QUESTION_TRANSITION", {
    reason: "abuse_reset",
    pendingQuestion: null,
    slots: safeContext.slots,
    abuseResetTriggered: true,
    slotCorrectionReason: "abuse_reset"
  });

  return safeContext;
}

function tryClarificationLoopBreaker(sessionContext, interactionRef, sessionId, slotKey) {
  if (!sessionContext || !["context", "object", "surface"].includes(slotKey)) {
    return null;
  }
  if (!shouldBreakRepeatedAsk(sessionContext, slotKey)) {
    return null;
  }
  sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
    slot: "intent_level",
    source: "loop_breaker",
    type: "intent_level"
  });
  saveSession(sessionId, sessionContext);
  const q = buildLowSignalClarificationQuestion("", "");
  return endInteraction(
    interactionRef,
    { type: "question", message: q },
    {
      decision: {
        action: "clarification",
        flowId: null,
        missingSlot: "intent_level",
        loopBreaker: true
      },
      outputType: "question",
      slotCorrectionTelemetry: {
        slotCorrectionApplied: true,
        slotCorrectionReason: "loop_breaker",
        slotChanges: [],
        pendingQuestionBefore: null,
        pendingQuestionAfter: { ...sessionContext.pendingQuestion }
      },
      slots: sessionContext.slots || {}
    }
  );
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

function shouldResetForNonCleaningMessage(message, intentCore) {
  const text = normalizeMessageText(message);

  if (!text) {
    return false;
  }

  const core = intentCore != null ? String(intentCore).trim() : "";
  const hl = core ? inferHighLevelIntent(core) : "unknown";
  if (hl === "product_search" || hl === "product_guidance") {
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
    return "Cauti cod/campanie sau discount la un produs anume? Daca vrei recomandari de detailing, spune-mi interior sau exterior si ce zona vrei sa tratezi.";
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
    interiorul: "interior",
    interioara: "interior",
    exterior: "exterior",
    exteriorul: "exterior"
  },
  surface: {
    vopsea: "paint",
    textil: "textile",
    textile: "textile",
    piele: "piele",
    leather: "piele",
    alcantara: "alcantara",
    plastic: "plastic",
    plastice: "plastic"
  },
  object: {
    parbriz: "glass",
    geam: "glass",
    geamuri: "glass",
    sticla: "glass",
    bancheta: "scaun",
    vopsea: "caroserie",
    vopseaua: "caroserie",
    caroserie: "caroserie",
    caroseria: "caroserie",
    lac: "caroserie",
    paint: "caroserie",
    clearcoat: "caroserie"
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
  const mapForSlot = SINGLE_TOKEN_SLOT_VALUES[pending.slot] || null;

  if (pending.slot === "surface") {
    if (!token || !mapForSlot || !Object.prototype.hasOwnProperty.call(mapForSlot, token)) {
      return null;
    }
    const surfaceVal = mapForSlot[token];
    logSurfaceNormalized(token, surfaceVal);
    return { slot: "surface", value: surfaceVal };
  }

  if (pending.slot === "object") {
    if (token && mapForSlot && Object.prototype.hasOwnProperty.call(mapForSlot, token)) {
      return { slot: "object", value: mapForSlot[token] };
    }
    const glassObj = resolveGlassObjectFromPendingAnswer(message);
    if (glassObj) {
      return { slot: "object", value: glassObj };
    }
    return null;
  }

  if (pending.slot === "context") {
    if (!token || !mapForSlot || !Object.prototype.hasOwnProperty.call(mapForSlot, token)) {
      return null;
    }
    return { slot: "context", value: mapForSlot[token] };
  }

  return null;
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
    "textil",
    "polish",
    "prosop",
    "spuma activa",
    "spumă activă",
    "taler",
    "carbuni",
    "cărbuni",
    "microfibra",
    "microfibră",
    "sampon",
    "șampon",
    "extractor"
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
      action: "safety",
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

    const preemptFlow = resolveFlow({
      intent: "product_guidance",
      message: resolvedMessage,
      slots: safeSlots,
      problemType
    });
    const reqCfg = getFlowRequiredSlotsConfig(preemptFlow);
    if (
      preemptFlow &&
      preemptFlow.flowId &&
      preemptFlow.type !== "knowledge_override" &&
      !reqCfg.legacy
    ) {
      const flowMissing = getMissingSlotForRequiredList(safeSlots, reqCfg.requiredSlots);
      if (flowMissing) {
        console.log("FLOW_DECISION", {
          flowCandidate: preemptFlow.flowId,
          missingSlot: flowMissing,
          flowRequirement: "explicit_slots_incomplete"
        });
        return {
          action: "clarification",
          flowId: null,
          missingSlot: flowMissing
        };
      }
      const lockedDecision = {
        action: "flow",
        flowId: preemptFlow.flowId,
        missingSlot: null
      };
      logInfo("FLOW_LOCKED", {
        flowId: preemptFlow.flowId,
        requiredSlots: reqCfg.requiredSlots
      });
      assertFlowLockInvariant(true, lockedDecision);
      console.log("FLOW_DECISION", {
        flowCandidate: preemptFlow.flowId,
        missingSlot: null,
        flowLocked: true
      });
      return lockedDecision;
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

function shouldSkipProductIntentOverride(sessionContext) {
  const p = sessionContext?.pendingQuestion;
  if (!p || !p.slot) return false;
  return ["context", "surface", "object"].includes(String(p.slot));
}

function applyIntentHeuristicToQueryType(interactionRef, queryType, intentCore, sessionContext) {
  if (queryType === "safety") return queryType;
  if (shouldSkipProductIntentOverride(sessionContext)) return queryType;
  if (isInformationalKnowledgeShape(intentCore)) return queryType;

  const hl = inferHighLevelIntent(intentCore);
  if (hl !== "product_search" && hl !== "product_guidance") return queryType;

  let next = queryType;
  let reason = null;
  if (queryType === "informational") {
    if (hl === "product_search") {
      next = "selection";
      reason = "verb_noun_or_noun_only";
    } else if (hl === "product_guidance") {
      next = "procedural";
      reason = "procedural_how_to_shape";
    }
  }

  if (next !== queryType) {
    const prevTelem = interactionRef.intentRoutingTelemetry || {};
    interactionRef.intentRoutingTelemetry = {
      ...prevTelem,
      intentHeuristicOverrideApplied: true,
      intentHeuristicOverrideFrom: queryType,
      intentHeuristicOverrideTo: next,
      intentHeuristicReason: reason
    };
    logInfo("INTENT_HEURISTIC_OVERRIDE", interactionRef.intentRoutingTelemetry);
  }
  return next;
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

function isSafetyViolation(message) {
  const text = String(message || "").toLowerCase().trim();
  if (PROFANITY_INSULT_LIST.some(term => text.includes(term))) {
    return true;
  }

  return /(\b(fut|pula|pizda|muie|cacat|dracu|naiba)\b)/i.test(text);
}

function getSafetyViolationReply() {
  return "Te pot ajuta cu intrebari legate de curatarea masinii sau produse.";
}

/**
 * ROUTING PURITY: Detect knowledge-style questions that should NOT enter procedural slot-filling
 * Examples: "cat dureaza...", "cum...", "ce este...", "de ce...", etc.
 * Uses greeting-stripped intent core so "Salut! Vreau polish" is not treated as knowledge.
 */
function isKnowledgeQuestion(message, intentCore) {
  const slang = applySlangNormalize(normalizeMessage(message));
  const { text: stripped } = stripGreetingAndFillers(slang);
  const core = intentCore != null && String(intentCore).trim() !== ""
    ? String(intentCore).toLowerCase().trim()
    : (stripped || slang).toLowerCase().trim();

  if (isProceduralHowTo(core)) {
    return false;
  }
  if (!isInformationalKnowledgeShape(core) && inferHighLevelIntent(core) === "product_search") {
    return false;
  }

  const text = core;
  const knowledgePatterns = [
    /^cat\s+(dureaza|cost|e|este)/, // cat dureaza? cat e?
    /^cum\s+/, // cum se curata? cum...?
    /^ce\s+(este|e)\s+/, // ce este acesta? ce e...?
    /^de\s+ce/, // de ce?
    /^care\s+(e|este)/, // care e diferenta?
    /^care\s+sunt\s+/, // care sunt avantajele?
    /^ce\s+diferenta/, // ce diferenta?
    /^ce\s+se\s+intampla/, // ce se intampla?
    /^cum\s+se\s+curata/, // cum se curata?
    /^care\s+(sunt|e|este)\s+diferentele/ // care sunt diferentele?
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
  if (!effectiveSurface && rule.allowedSurfaces.length === 1 && object !== "caroserie") {
    correctedSlots.surface = rule.allowedSurfaces[0];
    if (!reasonCode) reasonCode = "OBJ_INFERRED_SURFACE";
  }

  // 4. Surface provided but not in allowed list → INVALID with targeted clarification
  if (
    effectiveSurface &&
    rule.allowedSurfaces.length > 0 &&
    !rule.allowedSurfaces.includes(effectiveSurface)
  ) {
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
 * Option A safety trust: answer-first deterministic path, max one clarification, no product push.
 */
function buildSafetyTelemetry(payload) {
  return {
    safetyGateTriggered: payload.safetyGateTriggered,
    safetyReason: payload.safetyReason,
    missingCriticalField: payload.missingCriticalField ?? null,
    safetyAnswerType: payload.safetyAnswerType ?? null,
    askedClarification: payload.askedClarification,
    blockedProductRouting: payload.blockedProductRouting
  };
}

function handleSafetyTrustTurn({
  userMessage,
  routingMessage,
  sessionContext,
  sessionId
}) {
  const trust = sessionContext.safetyTrust && typeof sessionContext.safetyTrust === "object"
    ? sessionContext.safetyTrust
    : {};
  const awaitingClarification = Boolean(trust.active && trust.clarificationAsked);

  let analysis = analyzeSafetyQuery(routingMessage);
  let answerContextMessage = routingMessage;

  if (awaitingClarification && trust.anchorRouting) {
    const merged = `${trust.anchorRouting} ${routingMessage}`.trim();
    const mergedAnalysis = analyzeSafetyQuery(merged);
    if (mergedAnalysis.triggered) {
      analysis = mergedAnalysis;
      answerContextMessage = merged;
    }
  }

  if (!analysis.triggered && !awaitingClarification) {
    return null;
  }

  if (!analysis.triggered && awaitingClarification) {
    sessionContext.safetyTrust = { active: false, clarificationAsked: false, missingField: null, anchorRouting: null };
    saveSession(sessionId, sessionContext);
    const text = conservativeFollowUpReply();
    const telem = {
      safetyGateTriggered: true,
      safetyReason: "safety_thread_conservative_followup",
      missingCriticalField: null,
      safetyAnswerType: "depends",
      askedClarification: false,
      blockedProductRouting: true
    };
    logSafetyFields(telem);
    return {
      result: { type: "reply", reply: text, message: text, products: [] },
      patch: {
        intentType: "product_guidance",
        decision: { action: "safety", flowId: null, missingSlot: null },
        outputType: "reply",
        products: [],
        safetyTelemetry: buildSafetyTelemetry(telem)
      }
    };
  }

  sessionContext.slots = {};
  sessionContext.pendingQuestion = null;
  clearPendingClarificationSlots(sessionContext);
  sessionContext.state = "IDLE";
  delete sessionContext.pendingSelection;
  delete sessionContext.pendingSelectionMissingSlot;
  sessionContext.originalIntent = null;
  sessionContext.tags = [];

  if (analysis.missingCriticalField && !trust.clarificationAsked) {
    const q =
      CLARIFICATION_BY_FIELD[analysis.missingCriticalField] ||
      CLARIFICATION_BY_FIELD.surface_material;
    sessionContext.safetyTrust = {
      active: true,
      clarificationAsked: true,
      missingField: analysis.missingCriticalField,
      anchorRouting: routingMessage
    };
    saveSession(sessionId, sessionContext);
    const telemAsk = {
      safetyGateTriggered: true,
      safetyReason: analysis.reason,
      missingCriticalField: analysis.missingCriticalField,
      safetyAnswerType: null,
      askedClarification: true,
      blockedProductRouting: true
    };
    logSafetyFields(telemAsk);
    return {
      result: { type: "reply", reply: q, message: q, products: [] },
      patch: {
        intentType: "product_guidance",
        decision: { action: "safety", flowId: null, missingSlot: null },
        outputType: "reply",
        products: [],
        safetyTelemetry: buildSafetyTelemetry(telemAsk)
      }
    };
  }

  if (analysis.missingCriticalField && trust.clarificationAsked) {
    const text = conservativeFollowUpReply();
    sessionContext.safetyTrust = { active: false, clarificationAsked: false, missingField: null, anchorRouting: null };
    saveSession(sessionId, sessionContext);
    const telemSecond = {
      safetyGateTriggered: true,
      safetyReason: "safety_second_turn_conservative",
      missingCriticalField: analysis.missingCriticalField,
      safetyAnswerType: "depends",
      askedClarification: false,
      blockedProductRouting: true
    };
    logSafetyFields(telemSecond);
    return {
      result: { type: "reply", reply: text, message: text, products: [] },
      patch: {
        intentType: "product_guidance",
        decision: { action: "safety", flowId: null, missingSlot: null },
        outputType: "reply",
        products: [],
        safetyTelemetry: buildSafetyTelemetry(telemSecond)
      }
    };
  }

  const text = buildSafetyAnswerText(answerContextMessage, analysis);
  sessionContext.safetyTrust = { active: false, clarificationAsked: false, missingField: null, anchorRouting: null };
  saveSession(sessionId, sessionContext);
  const telemAns = {
    safetyGateTriggered: true,
    safetyReason: analysis.reason,
    missingCriticalField: null,
    safetyAnswerType: analysis.safetyAnswerType || "depends",
    askedClarification: false,
    blockedProductRouting: true
  };
  logSafetyFields(telemAns);
  return {
    result: { type: "reply", reply: text, message: text, products: [] },
    patch: {
      intentType: "product_guidance",
      decision: { action: "safety", flowId: null, missingSlot: null },
      outputType: "reply",
      products: [],
      safetyTelemetry: buildSafetyTelemetry(telemAns)
    }
  };
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
  const chipSelectionValue =
    typeof message === "object" && message != null
      ? message.chipSelection ?? message.chipValue ?? message.value ?? message.uiSelection ?? null
      : null;

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

  const slangRouting = applySlangNormalize(routingMessage);
  const stripIntentResult = stripGreetingAndFillers(slangRouting);
  const intentCore =
    stripIntentResult.text.length > 0 ? stripIntentResult.text : slangRouting;
  const preprocessStrippedGreeting = stripIntentResult.strippedGreeting;

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

  const traceId = loggingV2.createTraceId({ sessionId });
  const requestId =
    typeof message === "object" && message != null && message.requestId != null
      ? String(message.requestId)
      : null;

  return runSessionExclusive(sessionId, async () => {
  return loggingV2.runWithTraceContext(
    {
      traceId,
      sessionId,
      clientId: String(clientId ?? ""),
      requestId,
      service: "chatService"
    },
    async () => {
  try {
    let sessionContext = getSession(sessionId);
    const clarificationPendingAtEntry =
      Boolean(sessionContext?.pendingQuestion) ||
      (String(sessionContext?.state || "").startsWith("NEEDS_") &&
        sessionContext?.pendingClarification?.active === true);
    logInfo("PENDING_SELECTION_LOADED", {
      sessionId,
      pendingSelection: sessionContext?.pendingSelection,
      missing: sessionContext?.pendingSelectionMissingSlot
    });

    interactionRef = {
      timestamp: getNowIso(),
      traceId,
      sessionId,
      message: userMessage,
      queryType: null,
      intentType: null,
      tags: null,
      slots: null,
      decision: { action: null, flowId: null, missingSlot: null },
      feedback: extractFeedback(typeof message === "object" ? message : null),
      productsCatalog: products,
      safetyTelemetry: null,
      knowledgeTelemetry: null,
      lowSignalTelemetry: null,
      slotCorrectionTelemetry: null,
      clarificationEscalationTelemetry: null,
      contextInferenceTelemetry: null,
      intentRoutingTelemetry: {
        preprocessStrippedGreeting,
        intentHeuristicOverrideApplied: false,
        intentHeuristicOverrideFrom: null,
        intentHeuristicOverrideTo: null,
        intentHeuristicReason: null
      }
    };

    loggingV2.emitTurnStart({
      messageLen: userMessage.length,
      ...(loggingV2.DEBUG_V2 ? { messagePreview: userMessage } : {})
    });
    loggingV2.startRoutingStage();

    let handledPendingQuestionAnswerEarly = false;

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
      const pendingBeforeAbuse = sessionContext?.pendingQuestion
        ? { ...sessionContext.pendingQuestion }
        : null;
      logInfo("SAFETY_VIOLATION_DETECTED", {
        message: userMessage,
        normalizedMessage: routingMessage,
        abuseResetTriggered: true,
        hadPendingQuestion: Boolean(sessionContext?.pendingQuestion)
      });
      sessionContext = resetSessionAfterAbuse(sessionContext, sessionId);

      return endInteraction(interactionRef, {
        type: "reply",
        message: getSafetyViolationReply()
      }, {
        slots: {},
        decision: { action: "safety", flowId: null, missingSlot: null, safetyViolation: true, abuseReset: true },
        outputType: "reply",
        slotCorrectionTelemetry: {
          slotCorrectionApplied: true,
          slotCorrectionReason: "abuse_reset",
          slotChanges: [],
          pendingQuestionBefore: pendingBeforeAbuse,
          pendingQuestionAfter: null
        }
      });
    }

    // Non-cleaning interrupts (discount, greetings, etc.) clear procedural/clarification state
    // even mid–slot collection so users can escape clarification loops.
    if (shouldResetForNonCleaningMessage(userMessage, intentCore)) {
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

    if (
      sessionContext?.pendingQuestion?.slot === "intent_level" &&
      sessionContext?.pendingQuestion?.source === "low_signal"
    ) {
      const earlySlots = extractSlotsFromMessage(userMessage);
      if (
        hasStrongSlots(earlySlots) ||
        isKnownCleaningEntry(userMessage) ||
        detectExplicitContext(userMessage)
      ) {
        sessionContext.pendingQuestion = null;
        sessionContext.state = "IDLE";
        clearPendingClarificationSlots(sessionContext);
        saveSession(sessionId, sessionContext);
        logInfo("LOW_SIGNAL_TRACE", {
          branch: "intent_level_cleared_strong_followup",
          message: userMessage
        });
      }
    }

    const lowSignalIntent = clarificationPendingAtEntry ? null : detectIntent(intentCore, sessionId);
    const lowSignalSlots = extractSlotsFromMessage(userMessage);
    rememberLastNonNullSlots(sessionContext, lowSignalSlots);

    const lowSignalNormalized = normalizeLowSignalText(intentCore);
    let lowSignalCheck = !clarificationPendingAtEntry
      ? isLowSignalMessage(
          userMessage,
          lowSignalNormalized,
          lowSignalIntent,
          lowSignalSlots,
          Array.isArray(sessionContext?.tags) ? sessionContext.tags : []
        )
      : { lowSignal: false, reason: "pending_session" };

    const lowSignalTelemetryFirst = {
      lowSignalDetected: Boolean(lowSignalCheck.lowSignal),
      lowSignalReason: lowSignalCheck.reason,
      lowSignalRecoveryApplied: Boolean(lowSignalCheck.lowSignal),
      lowSignalQuestionType: "intent_level"
    };

    const safetyAwaitingFollowUp = Boolean(
      sessionContext?.safetyTrust?.active &&
        sessionContext?.safetyTrust?.clarificationAsked
    );

    const selectionFollowupLowSignalBypass = selectionFollowupBypassesLowSignalIntentLevel(
      userMessage,
      sessionContext
    );
    if (
      selectionFollowupLowSignalBypass &&
      lowSignalCheck.lowSignal &&
      isSelectionFollowupMessage(userMessage) &&
      hasCarryoverSelectionContext(sessionContext)
    ) {
      logInfo("LOW_SIGNAL_BYPASSED_FOLLOWUP", {
        reason: lowSignalCheck.reason,
        legacyShape: Boolean(isLegacySelectionFollowupShape(userMessage)),
        messagePreview: String(userMessage || "").slice(0, 120)
      });
    }

    // If bypass is satisfied, do not let the "low-signal" early-exit fire.
    // We want normal routing to compute a real decision, with selection context hydration applied later.
    if (selectionFollowupLowSignalBypass && lowSignalCheck.lowSignal) {
      lowSignalCheck = { lowSignal: false, reason: "selection_followup_bypass" };
      lowSignalTelemetryFirst.lowSignalDetected = false;
      lowSignalTelemetryFirst.lowSignalReason = "selection_followup_bypass";
      lowSignalTelemetryFirst.lowSignalRecoveryApplied = true;
      logInfo("LOW_SIGNAL_TRACE", {
        branch: "bypass_disables_low_signal",
        messagePreview: String(userMessage || "").slice(0, 120)
      });
    }

    if (
      !clarificationPendingAtEntry &&
      !safetyAwaitingFollowUp &&
      !selectionFollowupLowSignalBypass &&
      lowSignalCheck.lowSignal &&
      !hasStrongSlots(lowSignalSlots)
    ) {
      sessionContext.slots = {};
      sessionContext.state = "IDLE";
      sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
        slot: "intent_level",
        source: "low_signal",
        type: "intent_level"
      });
      sessionContext.originalIntent = null;
      sessionContext.pendingSelection = false;
      clearPendingClarificationSlots(sessionContext);
      saveSession(sessionId, sessionContext);
      interactionRef.lowSignalTelemetry = lowSignalTelemetryFirst;
      logInfo("LOW_SIGNAL_INPUT", {
        message: userMessage,
        reason: lowSignalCheck.reason,
        lowSignalDetected: true,
        lowSignalQuestionType: "intent_level"
      });
      logInfo("LOW_SIGNAL_TRACE", {
        branch: "emit_intent_level",
        ...lowSignalTelemetryFirst
      });

      const lowSignalQuestion = buildLowSignalClarificationQuestion(
        userMessage,
        lowSignalNormalized
      );

      // Invariant: low-signal early-exit must never return a null/undefined decision.action.
      const lowSignalDecision = {
        action: "clarification",
        flowId: null,
        missingSlot: "intent_level"
      };
      if (!lowSignalDecision.action) {
        logInfo("LOW_SIGNAL_EARLYEXIT_DECISION_FIXED", {
          originalDecision: lowSignalDecision,
          forcedMissingSlot: "intent_level"
        });
        lowSignalDecision.action = "clarification";
        lowSignalDecision.missingSlot = "intent_level";
      }

      return endInteraction(
        interactionRef,
        {
          type: "question",
          message: lowSignalQuestion
        },
        {
          decision: lowSignalDecision,
          outputType: "question",
          lowSignalTelemetry: interactionRef.lowSignalTelemetry,
          slots: sessionContext.slots || {}
        }
      );
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
    const isBugIntent = hasExplicitInsectSignal(userMessage);

    if (isBugIntent) {
      sessionContext.intentFlags.bug = true;
    }

    const hasBugIntent = sessionContext?.intentFlags?.bug === true;
    sessionContext.state = sessionContext.state || "IDLE";
    let previousState = sessionContext.state;
    const needsStateContinuation =
      String(previousState || "").startsWith("NEEDS_") &&
      sessionContext?.pendingClarification?.active === true;
    let pendingClarificationActive =
      Boolean(sessionContext?.pendingQuestion) || needsStateContinuation;
    const pendingIntentLevelLowSignal =
      sessionContext?.pendingQuestion?.slot === "intent_level" &&
      sessionContext?.pendingQuestion?.source === "low_signal";
    let pendingSlotClarificationActive =
      pendingClarificationActive && !pendingIntentLevelLowSignal;
    const hadPendingSlotClarificationAtStart = pendingSlotClarificationActive;

    let didContextResetForLocale = false;
    if (
      !pendingSlotClarificationActive &&
      shouldHardResetForNewRootQuery(userMessage, sessionContext)
    ) {
      didContextResetForLocale = true;
      sessionContext.slots = {};
      sessionContext.pendingQuestion = null;
      clearPendingClarificationSlots(sessionContext);
      clearSurfaceAssistState(sessionContext);
      sessionContext.lastFlow = null;
      sessionContext.state = "IDLE";
      sessionContext.originalIntent = null;
      sessionContext.intentFlags = {};
      delete sessionContext.selectionFollowupCarryover;
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
    const detectedLocale = detectLanguage(userMessage);
    let responseLocaleUsed;
    let localeSource;
    if (didContextResetForLocale) {
      responseLocaleUsed = normalizeResponseLocale(detectedLocale);
      localeSource = "detector";
    } else if (pendingClarificationActive) {
      responseLocaleUsed = normalizeResponseLocale(
        sessionContext.pendingClarification?.responseLocale ??
          sessionContext.responseLocale ??
          sessionContext.language ??
          detectedLocale
      );
      localeSource = sessionContext.pendingClarification?.responseLocale
        ? "pendingClarification"
        : (sessionContext.responseLocale || sessionContext.language)
          ? "session"
          : "detector";
    } else {
      responseLocaleUsed = normalizeResponseLocale(
        sessionContext.responseLocale ?? sessionContext.language ?? detectedLocale
      );
      localeSource = (sessionContext.responseLocale || sessionContext.language) ? "session" : "detector";
    }
    sessionContext.responseLocale = responseLocaleUsed;
    sessionContext.language = responseLocaleUsed;
    const language = responseLocaleUsed;

    logInfo("LOCALE_SET", {
      responseLocale: responseLocaleUsed,
      source: localeSource,
      didContextReset: didContextResetForLocale
    });

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
        decision: { action: "clarification", flowId: null, missingSlot: "intent_level" },
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

    const safetyRoutingSnapshot = analyzeSafetyQuery(routingMessage);
    const safetyAwaitingClarification = Boolean(
      sessionContext.safetyTrust?.active && sessionContext.safetyTrust?.clarificationAsked
    );
    const safetyForcesRouting =
      safetyRoutingSnapshot.triggered || safetyAwaitingClarification;

    if (pendingIntentLevelLowSignal && !safetyForcesRouting) {
      const norm = normalizeLowSignalText(intentCore);
      const followUpIntent = detectIntent(intentCore, sessionId);
      const followUpSlots = extractSlotsFromMessage(userMessage);
      const lsAgain = isLowSignalMessage(
        userMessage,
        norm,
        followUpIntent,
        followUpSlots,
        Array.isArray(sessionContext?.tags) ? sessionContext.tags : []
      );
      if (matchesInformationalBypass(userMessage, norm)) {
        sessionContext.pendingQuestion = null;
        saveSession(sessionId, sessionContext);
        pendingClarificationActive =
          Boolean(sessionContext?.pendingQuestion) || needsStateContinuation;
        pendingSlotClarificationActive =
          pendingClarificationActive &&
          !(
            sessionContext?.pendingQuestion?.slot === "intent_level" &&
            sessionContext?.pendingQuestion?.source === "low_signal"
          );
        handledPendingQuestionAnswerEarly = true;
        interactionRef.lowSignalTelemetry = {
          lowSignalDetected: false,
          lowSignalReason: "informational_bypass_after_intent_level",
          lowSignalRecoveryApplied: true,
          lowSignalQuestionType: "intent_level"
        };
        logInfo("LOW_SIGNAL_TRACE", {
          branch: "informational_bypass_pending_cleared",
          ...interactionRef.lowSignalTelemetry
        });
      } else {
        const route = classifyIntentLevelReply(userMessage, norm);
        const parsedSlots = normalizeSlots(
          applyObjectSlotInference(extractSlotsFromMessage(userMessage))
        );
        const hasSlotSignal = Boolean(
          parsedSlots.object || parsedSlots.context || parsedSlots.surface
        );
        let resolvedIntentLevel = false;
        if (route.kind === "procedural") {
          sessionContext.pendingQuestion = null;
          sessionContext.originalIntent = "product_guidance";
          sessionContext.pendingSelection = false;
          resolvedIntentLevel = true;
        } else if (route.kind === "selection") {
          sessionContext.pendingQuestion = null;
          sessionContext.originalIntent = "selection";
          sessionContext.pendingSelection = true;
          if (!hasSlotSignal) {
            const seeded = seedSelectionSlotsFromRecentMemory(sessionContext);
            if (seeded.applied) {
              logInfo("INTENT_LEVEL_SELECTION_CONTEXT_SEEDED", {
                source: seeded.source,
                slots: seeded.slots
              });
            }
          }
          resolvedIntentLevel = true;
        } else if (hasSlotSignal) {
          sessionContext.pendingQuestion = null;
          sessionContext.slots = mergeSlots(sessionContext.slots || {}, parsedSlots);
          resolvedIntentLevel = true;
        }
        if (resolvedIntentLevel) {
          handledPendingQuestionAnswerEarly = true;
          saveSession(sessionId, sessionContext);
          pendingClarificationActive =
            Boolean(sessionContext?.pendingQuestion) || needsStateContinuation;
          pendingSlotClarificationActive =
            pendingClarificationActive &&
            !(
              sessionContext?.pendingQuestion?.slot === "intent_level" &&
              sessionContext?.pendingQuestion?.source === "low_signal"
            );
          interactionRef.lowSignalTelemetry = {
            lowSignalDetected: false,
            lowSignalReason: "intent_level_resolved",
            lowSignalRecoveryApplied: true,
            lowSignalQuestionType: "intent_level"
          };
          logInfo("LOW_SIGNAL_TRACE", {
            branch: "intent_level_resolved",
            ...interactionRef.lowSignalTelemetry
          });
        } else if (lsAgain.lowSignal) {
          sessionContext.pendingQuestion = null;
          clearPendingClarificationSlots(sessionContext);
          saveSession(sessionId, sessionContext);
          pendingClarificationActive =
            Boolean(sessionContext?.pendingQuestion) || needsStateContinuation;
          pendingSlotClarificationActive =
            pendingClarificationActive &&
            !(
              sessionContext?.pendingQuestion?.slot === "intent_level" &&
              sessionContext?.pendingQuestion?.source === "low_signal"
            );
          interactionRef.lowSignalTelemetry = {
            lowSignalDetected: true,
            lowSignalReason: lsAgain.reason,
            lowSignalRecoveryApplied: true,
            lowSignalQuestionType: "object_menu"
          };
          logInfo("LOW_SIGNAL_TRACE", {
            branch: "object_menu",
            ...interactionRef.lowSignalTelemetry
          });
          return endInteraction(
            interactionRef,
            { type: "question", message: buildLowSignalMenuPrompt() },
            {
              decision: {
                action: "clarification",
                flowId: null,
                missingSlot: "intent_level"
              },
              outputType: "question",
              lowSignalTelemetry: interactionRef.lowSignalTelemetry,
              slots: sessionContext.slots || {}
            }
          );
        } else if (pendingIntentLevelLowSignal) {
          const replayQ = buildLowSignalClarificationQuestion(userMessage, norm);
          saveSession(sessionId, sessionContext);
          interactionRef.lowSignalTelemetry = {
            lowSignalDetected: false,
            lowSignalReason: "intent_level_repeat_prompt",
            lowSignalRecoveryApplied: true,
            lowSignalQuestionType: "intent_level"
          };
          logInfo("LOW_SIGNAL_TRACE", {
            branch: "intent_level_repeat_prompt",
            ...interactionRef.lowSignalTelemetry
          });
          return endInteraction(
            interactionRef,
            { type: "question", message: replayQ },
            {
              decision: {
                action: "clarification",
                flowId: null,
                missingSlot: "intent_level"
              },
              outputType: "question",
              lowSignalTelemetry: interactionRef.lowSignalTelemetry,
              slots: sessionContext.slots || {}
            }
          );
        }
      }
    }

    const isPendingSelectionContinuation = sessionContext?.pendingSelection === true;
    let queryType = isPendingSelectionContinuation ? "selection" : detectQueryType(routingMessage, intentCore);

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

    // Follow-up bypass: treat as selection so routing computes a proper decision (no low-signal early-exit).
    if (selectionFollowupLowSignalBypass && !pendingSlotClarificationActive) {
      queryType = "selection";
      logInfo("QUERY_TYPE_OVERRIDE", {
        reason: "low_signal_followup_bypass",
        pendingSelection: sessionContext?.pendingSelection === true,
        hasCarryover: hasCarryoverSelectionContext(sessionContext),
        messagePreview: String(userMessage || "").slice(0, 120)
      });
    }

    if (pendingSlotClarificationActive) {
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

    if (selectionEscalation && !pendingSlotClarificationActive) {
      queryType = "selection";
    }

    if (safetyRoutingSnapshot.triggered || safetyAwaitingClarification) {
      queryType = "safety";
      selectionEscalation = false;
    } else if (!isPendingSelectionContinuation && !pendingSlotClarificationActive) {
      queryType = applyIntentHeuristicToQueryType(interactionRef, queryType, intentCore, sessionContext);
    }

    interactionRef.queryType = queryType;
    loggingV2.endRoutingStage({ queryType });
    loggingV2.startClarificationStage();

    const isSafetyEnforced = queryType === "safety";
    logInfo("ROUTING", {
      queryType,
      safetyGateTriggered: isSafetyEnforced,
      blockedProductRouting: isSafetyEnforced,
      safetyReason: isSafetyEnforced ? safetyRoutingSnapshot.reason || "safety_followup_thread" : null
    });

    if (isSafetyEnforced) {
      logInfo("ENFORCED_SAFETY", { message: userMessage });
      interactionRef.slots = {};
      interactionRef.tags = [];
      saveSession(sessionId, sessionContext);
      const safetyTurn = handleSafetyTrustTurn({
        userMessage,
        routingMessage,
        sessionContext,
        sessionId
      });
      if (safetyTurn) {
        return endInteraction(interactionRef, safetyTurn.result, safetyTurn.patch);
      }
    }

    const wtLocale = normalizeResponseLocale(sessionContext.responseLocale || sessionContext.language || "ro");
    const wheelTireAnalysis = analyzeWheelTireMessage(userMessage);
    if (
      wheelTireAnalysis.wheelTireIntent ||
      wheelTireAnalysis.mixedCleanAndDress ||
      wheelTireAnalysis.ambiguousWheelTarget
    ) {
      logInfo("WHEEL_TIRE_ROUTING", {
        query: userMessage,
        detectedKeywords: wheelTireAnalysis.detectedKeywords,
        chosenIntent: wheelTireAnalysis.wheelTireIntent || null,
        chosenSlots: {
          object: wheelTireAnalysis.objectSlot || null,
          context: "exterior",
          surface: wheelTireAnalysis.objectSlot === "anvelope" ? "tires" : "wheels"
        },
        clarificationTriggered: false,
        clarificationReason: null
      });
    }
    const comboWheelTire = maybeWheelTireCombinedWorkflowReply(
      userMessage,
      wtLocale === "en" ? "en" : "ro"
    );
    if (comboWheelTire && !isSafetyEnforced) {
      const wt = analyzeWheelTireMessage(userMessage);
      interactionRef.intentRoutingTelemetry = {
        ...(interactionRef.intentRoutingTelemetry || {}),
        wheelTireTelemetry: { mode: "combo_workflow", ...wt }
      };
      return endInteraction(
        interactionRef,
        { type: "reply", reply: comboWheelTire, message: comboWheelTire },
        {
          decision: { action: "knowledge", flowId: null, missingSlot: null },
          outputType: "reply",
          intentRoutingTelemetry: { wheelTireComboWorkflow: true }
        }
      );
    }

    const wheelTireAmbiguous = maybeWheelTireAmbiguousProductClarification(userMessage);
    if (wheelTireAmbiguous && !isSafetyEnforced) {
      const hlAmb = inferHighLevelIntent(intentCore);
      if (hlAmb === "product_search") {
        const wtA = analyzeWheelTireMessage(userMessage);
        logInfo("WHEEL_TIRE_ROUTING", {
          query: userMessage,
          detectedKeywords: wtA.detectedKeywords,
          chosenIntent: wtA.wheelTireIntent || null,
          chosenSlots: {
            object: wtA.objectSlot || null,
            context: "exterior",
            surface: wtA.objectSlot === "anvelope" ? "tires" : "wheels"
          },
          clarificationTriggered: true,
          clarificationReason: wtA.ambiguousWheelTarget ? "generic_roti_ambiguous" : "mixed_targets"
        });
        interactionRef.intentRoutingTelemetry = {
          ...(interactionRef.intentRoutingTelemetry || {}),
          wheelTireTelemetry: { mode: "ambiguous_product", ...wtA }
        };
        return endInteraction(
          interactionRef,
          { type: "question", message: wheelTireAmbiguous },
          {
            decision: { action: "clarification", flowId: null, missingSlot: "object" },
            outputType: "question"
          }
        );
      }
    }

    const hadPendingQuestionAtStart = Boolean(sessionContext?.pendingQuestion);

    if (pendingSlotClarificationActive) {
      const pendingSnap = getPendingClarificationSlots(sessionContext);
      const prevSlots = {
        context: pendingSnap.context ?? sessionContext.slots?.context ?? null,
        surface: pendingSnap.surface ?? sessionContext.slots?.surface ?? null,
        object: pendingSnap.object ?? sessionContext.slots?.object ?? null,
        vehicleMake: pendingSnap.vehicleMake ?? sessionContext.slots?.vehicleMake ?? null,
        vehicleModel: pendingSnap.vehicleModel ?? sessionContext.slots?.vehicleModel ?? null,
        vehicleYear: pendingSnap.vehicleYear ?? sessionContext.slots?.vehicleYear ?? null
      };
      const parsedSlots = normalizeSlots(applyObjectSlotInference(extractSlotsFromMessage(userMessage)));
      sessionContext.slotMeta = sessionContext.slotMeta || {
        context: "unknown",
        surface: "unknown",
        object: "unknown"
      };
      const pendingQBefore = sessionContext.pendingQuestion
        ? { ...sessionContext.pendingQuestion }
        : null;

      const corr = applyUserCorrection({
        prevSlots,
        newExtraction: parsedSlots,
        pendingQuestion: sessionContext.pendingQuestion,
        message: userMessage,
        slotMeta: sessionContext.slotMeta
      });

      sessionContext.slotMeta = { ...sessionContext.slotMeta, ...corr.slotMeta };
      const mergedSlots = corr.nextSlots;
      const nextMissingSlot = getMissingSlot(mergedSlots);

      setPendingClarificationSlots(sessionContext, mergedSlots);
      sessionContext.slots = mergeSlots(sessionContext.slots || {}, mergedSlots);

      if (corr.pendingCleared) {
        sessionContext.pendingQuestion = null;
      }

      for (const u of corr.updates) {
        if (u.stateTo === "confirmed") {
          resetAskCountForSlot(sessionContext, u.slot);
        }
      }

      if (corr.reason) {
        interactionRef.slotCorrectionTelemetry = {
          slotCorrectionApplied: true,
          slotCorrectionReason: corr.reason,
          slotChanges: corr.updates,
          pendingQuestionBefore: pendingQBefore,
          pendingQuestionAfter: sessionContext.pendingQuestion
            ? { ...sessionContext.pendingQuestion }
            : null
        };
        logInfo("SLOT_CORRECTION_APPLIED", interactionRef.slotCorrectionTelemetry);
      }

      logInfo("CLARIFICATION_SLOT_PROGRESS", {
        prevSlots,
        parsedSlots,
        mergedSlots,
        nextMissingSlot
      });
      if (hadPendingSlotClarificationAtStart && nextMissingSlot == null) {
        logInfo("CLARIFICATION_SATISFIED", {
          mergedSlots,
          responseLocale: sessionContext.responseLocale || sessionContext.language || null
        });
      }

      const surfaceAssistEarly = await tryConsumeSurfaceAssistTurn({
        sessionId,
        sessionContext,
        userMessage,
        interactionRef,
        queryType,
        endInteractionFn: endInteraction
      });
      if (surfaceAssistEarly) {
        return surfaceAssistEarly;
      }
    }

    // HANDLE SLOT ANSWER (CRITICAL)
    const pending = sessionContext?.pendingQuestion;

    if (pending && pending.slot) {
      let updated = false;

      sessionContext.slots = sessionContext.slots || {};

      const singleTokenBinding = getSingleTokenBindingForPendingQuestion(userMessage, pending);

      if (singleTokenBinding) {
        sessionContext.slots[singleTokenBinding.slot] = singleTokenBinding.value;
        updated = true;
        sessionContext.slotMeta = sessionContext.slotMeta || {
          context: "unknown",
          surface: "unknown",
          object: "unknown"
        };
        sessionContext.slotMeta[singleTokenBinding.slot] = "confirmed";
        resetAskCountForSlot(sessionContext, singleTokenBinding.slot);
        if (
          singleTokenBinding.slot === "context" &&
          canonicalizeObjectValue(sessionContext.slots?.object) === "glass"
        ) {
          sessionContext.glassFlowContextLocked = true;
        }
      }

      if (updated) {
        const previousPending = pending;
        sessionContext.pendingQuestion = null;

        console.log("PENDING_CLEARED", {
          previous: previousPending,
          slots: sessionContext.slots
        });

        interactionRef.slotCorrectionTelemetry = {
          slotCorrectionApplied: true,
          slotCorrectionReason: "pending_answer",
          slotChanges: [
            {
              slot: singleTokenBinding.slot,
              to: singleTokenBinding.value,
              stateTo: "confirmed"
            }
          ],
          pendingQuestionBefore: previousPending,
          pendingQuestionAfter: null
        };

        logInfo("SLOT_FILLED_FROM_ANSWER", {
          slot: pending.slot,
          value: sessionContext.slots,
          canonicalObject: canonicalizeObjectValue(sessionContext.slots?.object),
          context: sessionContext.slots?.context || null,
          bugSignalDetected: hasExplicitInsectSignal(userMessage)
        });
      } else {
        if (["context", "object", "surface"].includes(String(pending.slot || "").toLowerCase())) {
          const loopBrPending = tryClarificationLoopBreaker(
            sessionContext,
            interactionRef,
            sessionId,
            pending.slot
          );
          if (loopBrPending) {
            return loopBrPending;
          }

          const escalation = evaluateClarificationEscalation({
            pendingQuestion: pending,
            userMessage,
            isNewRootRequest: shouldHardResetForNewRootQuery(userMessage, sessionContext),
            chipSelection: chipSelectionValue,
            contextHint: sessionContext?.slots?.context || null,
            slotFilled: false
          });

          sessionContext.pendingQuestion = escalation.pendingQuestion;
          interactionRef.clarificationEscalationTelemetry = escalation.telemetry || null;
          const missingNow = getMissingSlot(sessionContext.slots || {});
          if (!missingNow && escalation.kind !== "exit_unknown") {
            sessionContext.pendingQuestion = null;
            updated = true;
          }

          if (escalation.kind === "success" && escalation.slotValue) {
            sessionContext.slots[pending.slot] = escalation.slotValue;
            sessionContext.pendingQuestion = null;
            updated = true;
          } else if (!updated && (escalation.kind === "chips" || escalation.kind === "chips_narrow")) {
            saveSession(sessionId, sessionContext);
            const chipsReply = escalation.reply || getClarificationQuestion(pending.slot, sessionContext.slots || {}, sessionContext.responseLocale);
            return endInteraction(
              interactionRef,
              {
                type: "question",
                message: chipsReply,
                reply: chipsReply,
                ui: escalation.ui
              },
              {
                decision: { action: "clarification", flowId: null, missingSlot: missingNow || pending.slot },
                outputType: "question",
                slots: sessionContext.slots || {},
                clarificationEscalationTelemetry: escalation.telemetry
              }
            );
          } else if (!updated && escalation.kind === "exit_unknown") {
            sessionContext.pendingQuestion = null;
            sessionContext.state = "IDLE";
            saveSession(sessionId, sessionContext);
            return endInteraction(
              interactionRef,
              {
                type: "reply",
                message: escalation.reply,
                reply: escalation.reply
              },
              {
                decision: { action: "knowledge", flowId: null, missingSlot: null },
                outputType: "reply",
                clarificationEscalationTelemetry: escalation.telemetry
              }
            );
          } else if (!updated && escalation.kind === "other_prompt") {
            saveSession(sessionId, sessionContext);
            return endInteraction(
              interactionRef,
              {
                type: "question",
                message: escalation.reply,
                reply: escalation.reply
              },
              {
                decision: { action: "clarification", flowId: null, missingSlot: missingNow || pending.slot },
                outputType: "question",
                slots: sessionContext.slots || {},
                clarificationEscalationTelemetry: escalation.telemetry
              }
            );
          } else if (!updated) {
            saveSession(sessionId, sessionContext);
            const normalQuestion = getClarificationQuestion(missingNow || pending.slot, sessionContext.slots || {}, sessionContext.responseLocale);
            return endInteraction(
              interactionRef,
              {
                type: "question",
                message: normalQuestion,
                reply: normalQuestion
              },
              {
                decision: { action: "clarification", flowId: null, missingSlot: missingNow || pending.slot },
                outputType: "question",
                slots: sessionContext.slots || {},
                clarificationEscalationTelemetry: escalation.telemetry
              }
            );
          }
        }
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
          sessionContext.slotMeta = sessionContext.slotMeta || {
            context: "unknown",
            surface: "unknown",
            object: "unknown"
          };
          sessionContext.slotMeta.context = "confirmed";
          resetAskCountForSlot(sessionContext, "context");
          if (canonicalizeObjectValue(sessionContext.slots?.object) === "glass") {
            sessionContext.glassFlowContextLocked = true;
          }
          sessionContext.pendingQuestion = null;
          sessionContext.state = null;
          handledPendingQuestionAnswer = true;
        } else if (isNo(userMessage)) {
          sessionContext.pendingQuestion = null;
          sessionContext.state = null;
          saveSession(sessionId, sessionContext);
          return endInteraction(interactionRef, {
            type: "question",
            message: getClarificationQuestion("context", sessionContext.slots || {}, sessionContext.responseLocale)
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
      const currentIntent = sessionContext.originalIntent || overrideIntent(intentCore, detectIntent(intentCore, sessionId));
      const intentType = typeof currentIntent === "string" ? currentIntent : currentIntent?.type;
      if (intentType === "selection") {
        // Re-enter selection slot evaluation immediately
        const slotResult = processSlots(userMessage, "selection", sessionContext, { mergeWithSession: hadPendingSlotClarificationAtStart });
        const reentryPendingBeforeUpdate = sessionContext.pendingQuestion
          ? { ...sessionContext.pendingQuestion }
          : null;
        if (isHardReset(userMessage)) {
          sessionContext.slots = {};
          sessionContext.state = null;
          sessionContext.pendingQuestion = null;
        }
        const reentrySlotMode = hadPendingSlotClarificationAtStart ? "merge" : "replace";
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
              message: getClarificationQuestion("context", slotSnapshot, sessionContext.responseLocale)
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
            seedPendingClarificationAtEmission(sessionContext, "surface");
            saveSession(sessionId, sessionContext);
            const selQuestion = buildSurfaceClarificationQuestionWithAssist(
              slotResult.slots,
              sessionContext.responseLocale,
              sessionId,
              sessionContext.state
            );
            return endInteraction(interactionRef, {
              type: "question",
              message: selQuestion
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
    const shouldBypassIntentClassifier =
      pendingClarificationActive ||
      handledPendingQuestionAnswer ||
      handledPendingQuestionAnswerEarly;
    const rawIntent = shouldBypassIntentClassifier
      ? (sessionContext.originalIntent || "product_guidance")
      : detectIntent(intentCore, sessionId);
    let intentResult = shouldBypassIntentClassifier
      ? rawIntent
      : overrideIntent(intentCore, rawIntent);
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
      isSelectionFollowupMessage(userMessage) &&
      (sessionContext.lastIntent === "informational" ||
        Boolean(sessionContext.selectionFollowupCarryover))
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

    const routingConfidence =
      intent === "selection" && queryType === "selection"
        ? (typeof resolvedEffectiveIntentResult === "string"
          ? null
          : resolvedEffectiveIntentResult?.confidence)
        : (typeof intentResult === "string" ? null : intentResult?.confidence);
    if (getIntentConfidenceValue(routingConfidence) < 0.6) {
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

    captureInformationalSelectionCarryover(sessionContext, userMessage, queryType, sessionId);

    const shouldPreserveFollowUpState = shouldPreserveSlotsForContinuation({
      userMessage,
      sessionContext,
      handledPendingQuestionAnswer,
      handledPendingQuestionAnswerEarly,
      previousState
    });

    if (!shouldPreserveFollowUpState) {
      const prevSlots = { ...(sessionContext.slots || {}) };
      sessionContext.slots = {};
      sessionContext.pendingQuestion = null;
      sessionContext.pendingSelection = false;
      sessionContext.pendingSelectionMissingSlot = null;
      sessionContext.lastFlow = null;
      sessionContext.glassFlowContextLocked = false;
      sessionContext.originalIntent = null;
      clearPendingClarificationSlots(sessionContext);
      clearSurfaceAssistState(sessionContext);
      sessionContext.slotMeta = {
        context: "unknown",
        surface: "unknown",
        object: "unknown"
      };
      if (process.env.SESSION_DEBUG_LOG === "1") {
        logInfo("SESSION_SLOT_SCOPE_RESET", {
          sessionId,
          reason: "new_turn_not_continuation",
          clearedSlots: prevSlots,
          messagePreview: String(userMessage || "").slice(0, 120)
        });
      }
      saveSession(sessionId, sessionContext);
    }

    let workingTags = shouldPreserveFollowUpState
      ? [...new Set([...sessionTags, ...coreTags])]
      : [...coreTags];

    workingTags = enrichTagsFromMessage(userMessage, workingTags);

    sessionContext.tags = workingTags;
    saveSession(sessionId, sessionContext);

    applySelectionFollowupCarryoverHydration(userMessage, sessionContext, sessionId);

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
    // If user message is a knowledge/information question, route to knowledge handler, not procedural slot-filling.
    // EXCEPTION: Procedural how-to actions ("cum curat/spal/scot/aplic/folosesc") are protected from being
    // downgraded to informational, unless an explicit informational exception ("cum functioneaza", "ce este") applies.
    {
      const knowledgeGateTriggered = isKnowledgeQuestion(userMessage, intentCore);
      const isHowToActionMsg = matchesHowToAction(userMessage) || isProceduralHowTo(intentCore);
      const isInformationalExceptionMsg = matchesInformationalException(userMessage);
      // Protect procedural how-to only when NOT a conceptual/informational exception
      const protectProcedural = queryType === "procedural" && isHowToActionMsg && !isInformationalExceptionMsg;

      if (knowledgeGateTriggered && !protectProcedural) {
        logInfo("KNOWLEDGE_GATE_APPLIED", {
          originalQueryType: queryType,
          knowledgePatternMatched: true,
          isHowToAction: isHowToActionMsg,
          isInformationalException: isInformationalExceptionMsg,
          protectProcedural: false,
          finalQueryType: "informational"
        });
        queryType = "informational";
        interactionRef.queryType = queryType;
      } else if (knowledgeGateTriggered && protectProcedural) {
        logInfo("KNOWLEDGE_GATE_SKIPPED", {
          originalQueryType: queryType,
          knowledgePatternMatched: true,
          isHowToAction: isHowToActionMsg,
          isInformationalException: isInformationalExceptionMsg,
          protectProcedural: true,
          finalQueryType: queryType
        });
      }

      // PROCEDURAL HOW-TO: Surface clarification gate.
      // If a how-to action is detected and no surface is known, ask for it before proceeding.
      // PROCEDURAL HOW-TO: Surface clarification gate.
      // Only fires when context AND object are already resolved (so getMissingSlot returns "surface").
      // Objects with a single deterministic surface are excluded (glass, jante, caroserie, mocheta).
      const DETERMINISTIC_SURFACE_OBJECTS = new Set(["glass", "jante", "caroserie", "mocheta"]);
      if (queryType === "procedural" && isHowToActionMsg) {
        const currentMsgSlots = extractSlotsFromMessage(userMessage);
        const clarificationSlots = {
          context: currentMsgSlots.context || sessionContext.slots?.context || null,
          object: currentMsgSlots.object || sessionContext.slots?.object || null,
          surface: currentMsgSlots.surface || sessionContext.slots?.surface || null
        };
        applyObjectContextInferenceInPlace(clarificationSlots, sessionContext.slotMeta);
        const mergedContext = clarificationSlots.context;
        const mergedObject = clarificationSlots.object;
        const mergedSurface = clarificationSlots.surface;

        if (mergedContext && mergedObject && !mergedSurface && !DETERMINISTIC_SURFACE_OBJECTS.has(mergedObject)) {
          logInfo("PROCEDURAL_SURFACE_CLARIFICATION", {
            queryType,
            isHowToAction: isHowToActionMsg,
            object: mergedObject,
            message: userMessage
          });

          // Merge resolved slots into session and interactionRef so that
          // getMissingSlot(slots) === "surface" and the decision invariant passes.
          const mergedClarificationSlots = { context: mergedContext, object: mergedObject, surface: null };
          sessionContext.slots = { ...(sessionContext.slots || {}), ...mergedClarificationSlots };
          sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, { slot: "surface" });
          sessionContext.state = "NEEDS_SURFACE";
          const loopBrProc = tryClarificationLoopBreaker(
            sessionContext,
            interactionRef,
            sessionId,
            "surface"
          );
          if (loopBrProc) return loopBrProc;

          seedPendingClarificationAtEmission(sessionContext, "surface");
          recordClarificationAsk(sessionContext, "surface");
          saveSession(sessionId, sessionContext);
          interactionRef.slots = { ...mergedClarificationSlots };

          return endInteraction(interactionRef, {
            type: "question",
            message: buildSurfaceClarificationQuestionWithAssist(
              sessionContext.slots,
              sessionContext.responseLocale,
              sessionId,
              sessionContext.state
            )
          }, {
            decision: { action: "clarification", flowId: null, missingSlot: "surface" },
            outputType: "question"
          });
        }
      }
    }

    // ROUTING LAYER (before slots)
    const selectionPreviewMergeSession =
      hadPendingSlotClarificationAtStart ||
      sessionContext?.pendingSelection === true ||
      (isSelectionFollowupMessage(userMessage) && hasCarryoverSelectionContext(sessionContext));
    const selectionPreview = queryType === "selection"
      ? processSlots(userMessage, "selection", sessionContext, {
        mergeWithSession: selectionPreviewMergeSession
      })
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

    if (selectionEscalation && !pendingSlotClarificationActive) {
      const escalationTopic = messageTopicHint || sessionContext.currentTopic || null;
      const escalationContextHint = getContextHintForEscalation(userMessage);

      if (!escalationTopic) {
        sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, { slot: "context" });
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

      const escalationCandidates = loggingV2.withSearchPhaseSync(
        () =>
          findRelevantProducts(escalationTags, products, MAX_SELECTION_PRODUCTS, {
            message: userMessage,
            slots: { context: escalationContextHint || null, object: null, surface: null },
            settings
          }),
        (c) => ({ productCount: Array.isArray(c) ? c.length : 0, path: "selection_escalation" })
      );
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
      const knowledgeResults = loggingV2.withSearchPhaseSync(
        () => findRelevantKnowledge(userMessage, knowledgeBase),
        (r) => ({ knowledgeHits: Array.isArray(r) ? r.length : 0 })
      );

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
      const slotResult = processSlots(userMessage, "selection", sessionContext, {
        mergeWithSession: hadPendingSlotClarificationAtStart || sessionContext?.pendingSelection === true
      });
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
            getClarificationQuestion(missing, currentSlots, sessionContext.responseLocale)
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
          message: getClarificationQuestion(selectionDecision.missingSlot, currentSlots, sessionContext.responseLocale)
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
      let role = selectionRoleFromWheelTire(userMessage);
      if (!role && msg.includes("sampon")) role = "car_shampoo";
      if (!role && msg.includes("jante")) role = "wheel_cleaner";
      if (!role && msg.includes("geam")) role = "glass_cleaner";
      const coverageRoleDecision = !role
        ? detectCoverageGapRole(userMessage, selectionSlots)
        : { role: null, ask: null };
      if (!role && coverageRoleDecision.ask) {
        const coverageAsk = coverageRoleDecision.ask;
        return endInteraction(
          interactionRef,
          { type: "question", message: coverageAsk, reply: coverageAsk, products: [] },
          {
            decision: { action: "clarification", flowId: null, missingSlot: "intent_level" },
            outputType: "question",
            productsReason: "none"
          }
        );
      }
      if (!role && coverageRoleDecision.role) role = coverageRoleDecision.role;
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
        : loggingV2.withSearchPhaseSync(
            () =>
              findRelevantProducts(selectionTags, products, MAX_SELECTION_PRODUCTS, {
                strictTagFilter: !(sessionContext.objective?.needsCompletion && isContinuation),
                message: userMessage,
                slots: selectionSlots,
                settings
              }),
            (c) => ({ productCount: Array.isArray(c) ? c.length : 0, path: "selection" })
          );

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
      let productsReason = "strict";

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

      if (finalProducts.length === 0 && role && COVERAGE_ROLE_SET.has(role)) {
        const relaxedProducts = tryCoverageRoleRelaxedRetry(role, roleConfig, products, settings);
        if (relaxedProducts.length > 0) {
          finalProducts = relaxedProducts;
          productsReason = "relaxed_drop_context";
        }
      }

      if (finalProducts.length === 0) {
        const fallbackReply = role && COVERAGE_ROLE_SET.has(role)
          ? roleCoverageFallbackQuestion(role)
          : null;
        return returnSelectionFailSafe(interactionRef, sessionId, selectionDecision, selectionSlots, {
          reply: fallbackReply || undefined,
          productsReason: "none"
        });
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
        productsReason,
        products: summarizeProductsForLog(finalProducts)
      });
    }

    if (queryType === "procedural" && previewAction === "procedural") {
      let proceduralSlots = applyObjectSlotInference(
        mergeSlots(sessionContext.slots || {}, extractSlotsFromMessage(userMessage))
      );
      const hadNoContextBeforePreviewInference = !proceduralSlots.context;
      applyObjectContextInferenceInPlace(proceduralSlots, sessionContext.slotMeta);

      const previewBeforeCtx = sessionContext.slots?.context || null;
      if (
        sessionContext.slotMeta &&
        sessionContext.slotMeta.context === "confirmed" &&
        previewBeforeCtx &&
        proceduralSlots.context &&
        proceduralSlots.context !== previewBeforeCtx
      ) {
        const pendingCtx =
          sessionContext.pendingQuestion &&
          (sessionContext.pendingQuestion.slot === "context" ||
            sessionContext.pendingQuestion.type === "confirm_context");
        const allowContextFlip =
          hasExplicitCorrectionPattern(userMessage) ||
          Boolean(pendingCtx) ||
          detectExplicitContext(userMessage) === proceduralSlots.context;
        if (!allowContextFlip) {
          const blocked = proceduralSlots.context;
          proceduralSlots = { ...proceduralSlots, context: previewBeforeCtx };
          logInfo("CONTEXT_CONFIRMED_LOCK", {
            reason: "preserve_confirmed_context_preview",
            preserved: previewBeforeCtx,
            blocked
          });
        }
      }

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
        const disambiguation = getFlowDisambiguationQuestion(
          candidateFlows,
          proceduralSlots,
          sessionContext.responseLocale
        );

        if (disambiguation) {
          sessionContext.state = disambiguation.state;
          sessionContext.originalIntent = sessionContext.originalIntent || intent;
          sessionContext.slots = {
            ...(sessionContext.slots || {}),
            ...proceduralSlots
          };
          const disambigPendingSlot =
            disambiguation.state === "NEEDS_SURFACE"
              ? "surface"
              : disambiguation.state === "NEEDS_OBJECT"
                ? "object"
                : "context";
          const loopBrDis = tryClarificationLoopBreaker(
            sessionContext,
            interactionRef,
            sessionId,
            disambigPendingSlot
          );
          if (loopBrDis) return loopBrDis;

          sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
            slot: disambigPendingSlot,
            object: sessionContext.slots?.object || null,
            context: sessionContext.slots?.context || null
          });
          seedPendingClarificationAtEmission(sessionContext, disambigPendingSlot);
          recordClarificationAsk(sessionContext, disambigPendingSlot);
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
              missingSlot: disambigPendingSlot
            },
            outputType: "question"
          });
        }
      }
    }

    const storedOriginalIntent = sessionContext.originalIntent;

    const mainSlotMergeSession =
      hadPendingSlotClarificationAtStart ||
      (isSelectionFollowupMessage(userMessage) &&
        hasCarryoverSelectionContext(sessionContext) &&
        (queryType === "selection" || intent === "selection"));
    const slotResult = processSlots(userMessage, intent, sessionContext, {
      mergeWithSession: mainSlotMergeSession
    });
    if (queryType === "selection") {
      slotResult.slots = inferWheelsSurfaceFromObject(slotResult.slots || {});
    }
    const wasInClarification = Boolean(previousState && previousState.startsWith("NEEDS"));
    const earlyGuidedRedirectMessage = getGuidedRedirectMessage(userMessage);
    const heuristicHl = inferHighLevelIntent(intentCore);
    const productHeuristicBlocksEarlyFallback =
      heuristicHl === "product_search" || heuristicHl === "product_guidance";

    const shouldEarlySafeFallback =
      queryType === "procedural" &&
      !sessionContext.problemType &&
      !hasStrongSlots(slotResult.slots || {}) &&
      !isKnownCleaningEntry(userMessage) &&
      !productHeuristicBlocksEarlyFallback;

    if (
      queryType === "procedural" &&
      earlyGuidedRedirectMessage &&
      !sessionContext.problemType &&
      !hasStrongSlots(slotResult.slots || {}) &&
      !productHeuristicBlocksEarlyFallback
    ) {
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

    // ROUTING PURITY: Strong-signal context only (centralized inferContext).
    if (queryType === "procedural" && !slotResult.slots.context) {
      const inf = inferContext({
        message: userMessage,
        normalizedMessage: normalizeForContextInference(userMessage),
        slots: slotResult.slots,
        slotMeta: sessionContext.slotMeta,
        pendingQuestion: sessionContext.pendingQuestion
      });
      if (inf.inferredContext && inf.confidence === "strong") {
        slotResult.slots.context = inf.inferredContext;
        logInfo("SLOT_INFERENCE_EXPLICIT_CONTEXT", {
          context: inf.inferredContext,
          message: userMessage,
          reason: inf.reason
        });
        logInfo("SLOT_INFERENCE", {
          context: inf.inferredContext,
          reason: inf.reason
        });
      } else {
        slotResult.slots.context = null;
        logInfo("SLOT_INFERENCE", {
          context: null,
          reason: inf.reason || "default_unknown"
        });
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
      clearPendingClarificationSlots(sessionContext);
      clearSurfaceAssistState(sessionContext);
    }
    const pendingBeforeSlotUpdate = sessionContext.pendingQuestion
      ? { ...sessionContext.pendingQuestion }
      : null;
    sessionContext.objective.slots = {
      ...sessionContext.objective.slots,
      ...slotResult.slots
    };
    const selectionFollowupSlotMerge =
      isSelectionFollowupMessage(userMessage) &&
      hasCarryoverSelectionContext(sessionContext) &&
      (queryType === "selection" || intent === "selection");
    const slotMode = isSafetyQuery(userMessage)
      ? "override"
      : hadPendingSlotClarificationAtStart || selectionFollowupSlotMerge || sessionContext?.pendingSelection === true
        ? "merge"
        : "replace";
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

    if (
      slotMode !== "override" &&
      sessionContext.slotMeta &&
      sessionContext.slotMeta.context === "confirmed" &&
      beforeSlots.context &&
      sessionContext.slots.context &&
      sessionContext.slots.context !== beforeSlots.context
    ) {
      const pendingCtx =
        pendingBeforeSlotUpdate &&
        (pendingBeforeSlotUpdate.slot === "context" ||
          pendingBeforeSlotUpdate.type === "confirm_context");
      const explicitCtx = detectExplicitContext(userMessage);
      const allowContextFlip =
        hasExplicitCorrectionPattern(userMessage) ||
        Boolean(pendingCtx) ||
        explicitCtx === sessionContext.slots.context;
      if (!allowContextFlip) {
        const blocked = sessionContext.slots.context;
        sessionContext.slots = {
          ...sessionContext.slots,
          context: beforeSlots.context
        };
        slotResult.slots = {
          ...(slotResult.slots || {}),
          context: beforeSlots.context
        };
        logInfo("CONTEXT_CONFIRMED_LOCK", {
          reason: "preserve_confirmed_context",
          preserved: beforeSlots.context,
          blocked
        });
      }
    }

    if (sessionContext.glassFlowContextLocked && beforeSlots.context) {
      const nextCtx = sessionContext.slots?.context;
      if (nextCtx && nextCtx !== beforeSlots.context) {
        const explicitCtx = detectExplicitContext(userMessage);
        if (explicitCtx !== nextCtx) {
          sessionContext.slots.context = beforeSlots.context;
          slotResult.slots = { ...(slotResult.slots || {}), context: beforeSlots.context };
          logInfo("GLASS_CONTEXT_LOCK", { preserved: beforeSlots.context, blocked: nextCtx });
        }
      }
    }

    if (
      pendingBeforeSlotUpdate &&
      pendingBeforeSlotUpdate.slot === "context" &&
      canonicalizeObjectValue(sessionContext.slots?.object) === "glass" &&
      sessionContext.slots?.context
    ) {
      sessionContext.glassFlowContextLocked = true;
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

    applyObjectContextInferenceInPlace(sessionContext.slots, sessionContext.slotMeta);
    slotResult.slots = mergeSlots(slotResult.slots || {}, {
      context: sessionContext.slots.context,
      object: sessionContext.slots.object,
      surface: sessionContext.slots.surface
    });

    {
      const _ctxTel = inferContext({
        message: userMessage,
        normalizedMessage: normalizeForContextInference(userMessage),
        slots: sessionContext.slots,
        slotMeta: sessionContext.slotMeta,
        pendingQuestion: sessionContext.pendingQuestion
      });
      interactionRef.contextInferenceTelemetry = {
        contextInferenceAttempted: true,
        contextInferenceResult: _ctxTel.inferredContext,
        contextInferenceReason: _ctxTel.reason,
        contextWasDefaulted: false,
        contextClarificationAsked: false
      };
    }

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
      clearPendingClarificationSlots(sessionContext);
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

      const loopBrCtx = tryClarificationLoopBreaker(sessionContext, interactionRef, sessionId, "context");
      if (loopBrCtx) return loopBrCtx;

      const contextHint = detectContextHint(userMessage);
      if (contextHint === "interior") {
        sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
          type: "confirm_context",
          value: "interior",
          slot: "context",
          object: sessionContext.slots?.object || null,
          context: sessionContext.slots?.context || null
        });
        logInfo("PENDING_QUESTION_TRANSITION", {
          reason: "ask_context_confirmation",
          pendingQuestion: sessionContext.pendingQuestion
        });
        if (queryType === "selection") {
          sessionContext.originalIntent = "selection";
          sessionContext.pendingSelection = true;
          sessionContext.pendingSelectionMissingSlot = "context";
        }
        recordClarificationAsk(sessionContext, "context");
        saveSession(sessionId, sessionContext);
        logResponseSummary("question", { products: 0 });
        logInfo("CONTEXT_CLARIFICATION_TRACE", { branch: "confirm_interior_hint", contextHint });
        return endInteraction(interactionRef, {
          type: "question",
          message: "Este vorba despre interior (cotiera), corect?"
        }, {
          decision: resolvedAction,
          outputType: "question",
          contextInferenceTelemetry: {
            ...(interactionRef.contextInferenceTelemetry || {}),
            contextClarificationAsked: true
          }
        });
      }

      if (contextHint === "exterior") {
        sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
          type: "confirm_context",
          value: "exterior",
          slot: "context",
          object: sessionContext.slots?.object || null,
          context: sessionContext.slots?.context || null
        });
        logInfo("PENDING_QUESTION_TRANSITION", {
          reason: "ask_context_confirmation",
          pendingQuestion: sessionContext.pendingQuestion
        });
        if (queryType === "selection") {
          sessionContext.originalIntent = "selection";
          sessionContext.pendingSelection = true;
          sessionContext.pendingSelectionMissingSlot = "context";
        }
        recordClarificationAsk(sessionContext, "context");
        saveSession(sessionId, sessionContext);
        logResponseSummary("question", { products: 0 });
        logInfo("CONTEXT_CLARIFICATION_TRACE", { branch: "confirm_exterior_hint", contextHint });
        return endInteraction(interactionRef, {
          type: "question",
          message: "Este vorba despre exterior, corect?"
        }, {
          decision: resolvedAction,
          outputType: "question",
          contextInferenceTelemetry: {
            ...(interactionRef.contextInferenceTelemetry || {}),
            contextClarificationAsked: true
          }
        });
      }

      sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
        slot: "context",
        object: sessionContext.slots?.object || null,
        context: sessionContext.slots?.context || null
      });
      logInfo("PENDING_QUESTION_TRANSITION", {
        reason: "ask_context",
        pendingQuestion: sessionContext.pendingQuestion
      });
      if (queryType === "selection") {
        sessionContext.originalIntent = "selection";
        sessionContext.pendingSelection = true;
        sessionContext.pendingSelectionMissingSlot = "context";
      }
      recordClarificationAsk(sessionContext, "context");
      saveSession(sessionId, sessionContext);
      logResponseSummary("question", { products: 0 });

      logInfo("CONTEXT_CLARIFICATION_TRACE", { branch: "ask_context_open", contextHint: null });
      return endInteraction(interactionRef, {
        type: "question",
        message: getClarificationQuestion("context", sessionContext.slots || {}, sessionContext.responseLocale)
      }, {
        decision: resolvedAction,
        outputType: "question",
        contextInferenceTelemetry: {
          ...(interactionRef.contextInferenceTelemetry || {}),
          contextClarificationAsked: true
        }
      });
    }

    if (resolvedAction.action === "clarification" && shouldHandleClarification && resolvedAction.missingSlot === "object") {
      sessionContext.state = "NEEDS_OBJECT";
      const loopBrObj = tryClarificationLoopBreaker(sessionContext, interactionRef, sessionId, "object");
      if (loopBrObj) return loopBrObj;

      sessionContext.originalIntent = sessionContext.originalIntent || intent;
      if (queryType === "selection") {
        sessionContext.originalIntent = "selection";
        sessionContext.pendingSelection = true;
        sessionContext.pendingSelectionMissingSlot = "object";
      }
      sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
        slot: "object",
        object: sessionContext.slots?.object || null,
        context: sessionContext.slots?.context || null
      });
      logInfo("PENDING_QUESTION_TRANSITION", {
        reason: "ask_object",
        pendingQuestion: sessionContext.pendingQuestion
      });
      recordClarificationAsk(sessionContext, "object");
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
      const loopBrSurf = tryClarificationLoopBreaker(sessionContext, interactionRef, sessionId, "surface");
      if (loopBrSurf) return loopBrSurf;

      sessionContext.originalIntent = sessionContext.originalIntent || intent;
      if (queryType === "selection") {
        sessionContext.originalIntent = "selection";
        sessionContext.pendingSelection = true;
        sessionContext.pendingSelectionMissingSlot = "surface";
      }
      sessionContext.pendingQuestion = createPendingQuestionState(sessionContext.pendingQuestion, {
        slot: "surface",
        object: sessionContext.slots?.object || null,
        context: sessionContext.slots?.context || null
      });
      seedPendingClarificationAtEmission(sessionContext, "surface");
      logInfo("PENDING_QUESTION_TRANSITION", {
        reason: "ask_surface",
        pendingQuestion: sessionContext.pendingQuestion
      });
      recordClarificationAsk(sessionContext, "surface");
      saveSession(sessionId, sessionContext);
      logInfo("FLOW", getFlowLogPayload(intent, slotResult.slots, null, "missing_surface"));

      const questionMessage = buildSurfaceClarificationQuestionWithAssist(
        sessionContext.slots,
        sessionContext.responseLocale,
        sessionId,
        sessionContext.state
      );

      logResponseSummary("question", { products: 0 });
      return endInteraction(interactionRef, {
        type: "question",
        message: questionMessage
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

        if (
          flowId === "glass_clean_basic" ||
          flowId === "bug_removal_quick" ||
          canonicalizeObjectValue(sessionContext.slots?.object) === "glass"
        ) {
          logInfo("GLASS_ROUTE_TRACE", {
            canonicalObject: canonicalizeObjectValue(sessionContext.slots?.object),
            context: sessionContext.slots?.context || null,
            selectedFlowId: flowId,
            bugSignalDetected: hasExplicitInsectSignal(userMessage),
            pendingQuestionSlot: sessionContext.pendingQuestion?.slot || null,
            abuseResetTriggered: false
          });
        }

        const flowLocale = sessionContext.responseLocale || sessionContext.language || "ro";
        const flowResult = executeFlow(resolvedPrioritizedFlow, products, sessionContext.slots || {}, {
          responseLocale: flowLocale
        });
        const rawFlowProducts = Array.isArray(flowResult?.products) ? flowResult.products : [];
        const filteredFlowProducts = filterProducts(rawFlowProducts, sessionContext.slots || {});
        const flowBundle = buildProductBundle(filteredFlowProducts);
        const flowReply = buildMinimalFlowReply(resolvedPrioritizedFlow, flowResult, flowLocale);
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
        const clarificationMessage = getClarificationQuestion(
          clarificationSlot,
          sessionContext.slots || {},
          sessionContext.responseLocale
        );

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
        const matchedKnowledge = loggingV2.withSearchPhaseSync(
          () => getRelevantKnowledge(safeMessage, knowledgeBase, finalTags, sessionContext.slots || {}),
          (r) => ({ knowledgeHits: Array.isArray(r) ? r.length : 0, path: "safety_guidance_knowledge" })
        );
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
        safetyProducts = loggingV2.withSearchPhaseSync(
          () =>
            findRelevantProducts(finalTags, products, settings.max_products || 3, {
              message: userMessage,
              slots: sessionContext.slots || {},
              settings
            }),
          (c) => ({ productCount: Array.isArray(c) ? c.length : 0, path: "safety_guidance_products" })
        );
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
        if (safetyBundle.length > 0 && safetyBundle.length < 2) {
          logInfo("SAFEFALLBACK_BLOCKED_PRODUCTS_EXIST", {
            path: "safety_guidance",
            productCount: safetyBundle.length
          });
        }
        if (safetyBundle.length === 0) {
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
          const knowledgeResults = loggingV2.withSearchPhaseSync(
            () => getRelevantKnowledge(userMessage, knowledgeBase, finalTags, sessionContext.slots || {}),
            (r) => ({ knowledgeHits: Array.isArray(r) ? r.length : 0, path: "decision_knowledge" })
          );
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

        // Step 7–8: Search for products (tagged phase for logging v2)
        const selectionOpts = {
          message: userMessage,
          slots: sessionContext.slots || {},
          settings
        };
        let found = loggingV2.withSearchPhaseSync(() => {
          let f = findRelevantProducts(detectedTags, products, settings.max_products || 3, selectionOpts);
          f = f.length > 0 ? f : applyFallbackProducts(products);
          if (f.length === 0) {
            const retryTags = ["cleaning", "interior"];
            f = findRelevantProducts(retryTags, products, settings.max_products || 3, selectionOpts);
          }
          return f;
        }, (f) => ({ productCount: Array.isArray(f) ? f.length : 0, path: "product_search" }));

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
        if (searchBundle.length > 0 && searchBundle.length < 2) {
          logInfo("SAFEFALLBACK_BLOCKED_PRODUCTS_EXIST", {
            path: "product_search",
            productCount: searchBundle.length
          });
        }
        if (searchBundle.length === 0) {
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
    loggingV2.emitError(err, { stage: "handleChat" });
    console.error("EXECUTION_ERROR", {
      message: err.message,
      stack: err.stack,
      stage: "execution"
    });

    throw err;
  }
    });
  });
}


module.exports = {
  handleChat,
  detectLanguage,
  extractSlotsFromMessage,
  __test: {
    detectCoverageGapRole,
    tryCoverageRoleRelaxedRetry,
    roleCoverageFallbackQuestion,
    findProductsByRoleConfig,
    tryConsumeSurfaceAssistTurn,
    tryConsumeLlmSurfaceAssistTurn
  }
};
