/**
 * Deterministic wheel (jante) vs tire (anvelope) semantics for Turbo routing.
 *
 * ## Disambiguation (rules beat loose aliases)
 * - **tire_dressing** — shine/finish on rubber sidewalls: dressing, luciu, tire gel/spray,
 *   English tire shine/gloss/dressing, Romanian “dressing/luciu anvelope”, etc.
 * - **wheel_cleaning** — brake dust, iron, degreaser, wheel cleaner, “curăț jantele”, etc.
 * - **object slot** — `jante` = rims/wheels; `anvelope` = tires (rubber). We no longer map
 *   “anvelope” onto the jante object bucket.
 *
 * ## Mixed messages
 * - **How-to / sequence** (“cum fac”, “mai întâi … apoi”, “curăț jantele și apoi dressing”):
 *   return a fixed 3-step workflow (clean wheels → dry → tire dressing) via
 *   `maybeWheelTireCombinedWorkflowReply`.
 * - **Product request** with both targets but **no** sequence markers: ask one clarification
 *   (`maybeWheelTireAmbiguousProductClarification`).
 *
 * No LLM is used for these decisions.
 */

const { normalizeForMatch, hasProductRequestVerb, isProceduralHowTo } = require("./productIntentHeuristics");

/** Longer / more specific phrases first where relevant */
const TIRE_DRESSING_PHRASES = [
  "dressing anvelope",
  "dressing pentru anvelope",
  "dressing de anvelope",
  "dressing pe anvelope",
  "luciu anvelope",
  "luciu pentru anvelope",
  "gel anvelope",
  "gel pentru anvelope",
  "spray anvelope",
  "tire shine",
  "tyre shine",
  "tire dressing",
  "tyre dressing",
  "tire gloss",
  "tire gel",
  "tyre gel",
  "tire spray",
  "tire protectant",
  "tire blackener",
  "tyre blackener",
  "anvelope lucioase",
  "negru anvelope",
  "innegritor anvelope",
  "innegritor anvelope",
  "satin anvelope",
  "mat anvelope",
  "sa luceasca cauciucurile",
  "să lucească cauciucurile",
  "flanc anvelop",
  "endurance tire",
  "hot shine tire",
  "protectie anvelope",
  "protecție anvelope",
  "dressing cauciuc",
  "dressing cauciucuri",
  "luciu cauciuc",
  "rubber dressing"
];

const WHEEL_CLEANING_PHRASES = [
  "curatare jante",
  "curățare jante",
  "curat jante",
  "curăț jante",
  "curat jantele",
  "curăț jantele",
  "spal jante",
  "spăl jante",
  "wheel cleaner",
  "rim cleaner",
  "wheel cleaning",
  "degresant jante",
  "iron remover",
  "iron remover jante",
  "curatare roti",
  "praf frana",
  "praf frână",
  "brake dust",
  "praful de frana",
  "decontaminare jante",
  "fallout jante",
  "solutie jante",
  "cleaner jante",
  "curatare jantelor",
  "cu ce curat jante",
  "cu ce curăț jantele",
  "cu ce curat jantele",
  "ultimate all wheel",
  "all wheel cleaner"
];

const TIRE_OBJECT_TERMS = [
  "anvelope",
  "anvelopa",
  "anvelopelor",
  "cauciuc",
  "cauciucuri",
  "sidewall",
  "flanc"
];

const WHEEL_OBJECT_TERMS = ["jante", "janta", "jantele", "felga", "felgi", "wheel", "wheels"];
const GENERIC_WHEELS_TERMS = ["roti", "roata", "rotii"];

function normText(text) {
  return normalizeForMatch(text);
}

function hasPhrase(normFull, phrase) {
  return normFull.includes(normalizeForMatch(phrase));
}

function scoreTireDressing(normFull) {
  let s = 0;
  for (const p of TIRE_DRESSING_PHRASES) {
    if (hasPhrase(normFull, p)) s += 4;
  }
  const hasTireCue =
    normFull.includes("anvelop") ||
    normFull.includes("cauciuc") ||
    /\btires?\b/.test(normFull) ||
    normFull.includes("tire ");
  if (hasTireCue && normFull.includes("dressing")) s += 3;
  if (hasTireCue && normFull.includes("luciu")) s += 3;
  if (hasTireCue && normFull.includes("gel") && !normFull.includes("jante")) s += 2;
  if (
    hasTireCue &&
    (normFull.includes("negru") || normFull.includes("negre") || normFull.includes("innegr") || normFull.includes("black"))
  ) {
    s += 3;
  }
  return s;
}

function scoreWheelCleaning(normFull, rawLower) {
  let s = 0;
  for (const p of WHEEL_CLEANING_PHRASES) {
    if (hasPhrase(normFull, p)) s += 4;
  }
  if (normFull.includes("wheel") && (normFull.includes("clean") || normFull.includes("rinse"))) s += 2;
  if (
    normFull.includes("jante") &&
    /curat|spal|degres|iron|frana|frână|brake|cleaner|solutie|decontamin|fallout/.test(normFull)
  ) {
    s += 3;
  }
  if (rawLower.includes("iron remover") && normFull.includes("jante")) s += 2;
  return s;
}

function hasTireObject(normFull) {
  if (normFull.includes("anvelop") || normFull.includes("cauciuc")) return true;
  if (/\btires?\b/.test(normFull)) return true;
  if (/\btyres?\b/.test(normFull)) return true;
  return TIRE_OBJECT_TERMS.some((t) => t.length > 4 && normFull.includes(t));
}

function hasWheelObject(normFull) {
  return WHEEL_OBJECT_TERMS.some((t) => normFull.includes(t));
}

function hasGenericWheelsMention(normFull) {
  return GENERIC_WHEELS_TERMS.some((t) => normFull.includes(t));
}

function hasExplicitRimOrTireTarget(normFull) {
  return hasWheelObject(normFull) || hasTireObject(normFull);
}

function hasProductFormCue(normFull) {
  return (
    hasProductRequestVerb(normFull) ||
    /\b(solutie|soluție|recomand|produs|ce dau|ce pun|ce folosesc)\b/.test(normFull)
  );
}

function firstMentionObject(normFull) {
  const wheelKeys = ["jantele", "jante", "felgi", "wheels", "wheel"];
  const tireKeys = ["anvelope", "anvelopa", "anvelopelor", "cauciuc", "tires", "tire"];
  let wi = Infinity;
  let ti = Infinity;
  for (const k of wheelKeys) {
    const i = normFull.indexOf(k);
    if (i !== -1 && i < wi) wi = i;
  }
  for (const k of tireKeys) {
    const i = normFull.indexOf(k);
    if (i !== -1 && i < ti) ti = i;
  }
  if (wi === Infinity && ti === Infinity) return null;
  if (ti < wi) return "anvelope";
  if (wi < ti) return "jante";
  return "jante";
}

/**
 * @returns {{
 *   wheelTireIntent: null | "wheel_cleaning" | "tire_dressing",
 *   objectSlot: null | "jante" | "anvelope",
 *   bothTargetsMentioned: boolean,
 *   mixedCleanAndDress: boolean,
 *   tireDressScore: number,
 *   wheelCleanScore: number
 * }}
 */
function analyzeWheelTireMessage(raw) {
  const rawLower = String(raw || "").toLowerCase();
  const normFull = normText(raw);

  const tireDressScore = scoreTireDressing(normFull);
  const wheelCleanScore = scoreWheelCleaning(normFull, rawLower);
  const tireObj = hasTireObject(normFull);
  const wheelObj = hasWheelObject(normFull);
  const genericWheelsMention = hasGenericWheelsMention(normFull);
  const bothTargetsMentioned = tireObj && wheelObj;
  const mixedCleanAndDress = tireDressScore > 0 && wheelCleanScore > 0;

  let wheelTireIntent = null;
  let objectSlot = null;

  if (tireDressScore > wheelCleanScore) {
    wheelTireIntent = "tire_dressing";
    objectSlot = "anvelope";
  } else if (wheelCleanScore > tireDressScore) {
    wheelTireIntent = "wheel_cleaning";
    objectSlot = wheelObj ? "jante" : tireObj ? "anvelope" : "jante";
  } else if (tireDressScore > 0 && wheelCleanScore > 0) {
    const first = firstMentionObject(normFull);
    if (first === "anvelope") {
      wheelTireIntent = "tire_dressing";
      objectSlot = "anvelope";
    } else {
      wheelTireIntent = "wheel_cleaning";
      objectSlot = "jante";
    }
  } else if (tireDressScore > 0) {
    wheelTireIntent = "tire_dressing";
    objectSlot = "anvelope";
  } else if (wheelCleanScore > 0) {
    wheelTireIntent = "wheel_cleaning";
    objectSlot = "jante";
  } else if (tireObj && !wheelObj && (normFull.includes("luciu") || normFull.includes("dressing"))) {
    wheelTireIntent = "tire_dressing";
    objectSlot = "anvelope";
  } else if (wheelObj && !tireObj && /curat|spal|degres|cleaner|iron|frana|frână|brake/.test(normFull)) {
    wheelTireIntent = "wheel_cleaning";
    objectSlot = "jante";
  }

  return {
    wheelTireIntent,
    objectSlot,
    bothTargetsMentioned,
    mixedCleanAndDress,
    genericWheelsMention,
    ambiguousWheelTarget:
      genericWheelsMention && !hasExplicitRimOrTireTarget(normFull) && hasProductFormCue(normFull),
    tireDressScore,
    wheelCleanScore,
    detectedKeywords: {
      tireDressing: TIRE_DRESSING_PHRASES.filter((p) => hasPhrase(normFull, p)).slice(0, 6),
      wheelCleaning: WHEEL_CLEANING_PHRASES.filter((p) => hasPhrase(normFull, p)).slice(0, 6),
      genericWheelMention: genericWheelsMention
    }
  };
}

function hasSequenceMarker(normFull) {
  return (
    /\b(apoi|dupa|după|întâi|intai|mai întâi|mai intai)\b/.test(normFull) ||
    /\bși apoi\b/.test(normFull) ||
    /\bsi apoi\b/.test(normFull)
  );
}

function maybeWheelTireCombinedWorkflowReply(message, locale = "ro") {
  const a = analyzeWheelTireMessage(message);
  if (!a.bothTargetsMentioned || !a.mixedCleanAndDress) return null;

  const normFull = normText(message);
  const procedural =
    isProceduralHowTo(message) ||
    /^cum\s+/i.test(String(message || "").trim()) ||
    hasSequenceMarker(normFull);

  if (!procedural) return null;

  if (shouldAskWheelTireProductClarification(message, a)) return null;

  if (locale === "en") {
    return (
      "1) Clean the wheels: use a dedicated wheel cleaner on cool rims, brush if needed, rinse well.\n" +
      "2) Dry the wheel and tire area completely.\n" +
      "3) Apply tire dressing only on clean, dry sidewalls (not on the tread contact patch)."
    );
  }
  return (
    "1) Curăță jantele: aplică wheel cleaner pe jante reci, periază dacă e nevoie, clătește bine.\n" +
    "2) Uscă complet janta și zona anvelopei.\n" +
    "3) Aplică dressing de anvelope doar pe flancuri curate și uscate (nu pe banda de rulare)."
  );
}

function shouldAskWheelTireProductClarification(message, analysis) {
  if (!analysis.mixedCleanAndDress || !analysis.bothTargetsMentioned) return false;
  if (!hasProductRequestVerb(message)) return false;
  const normFull = normText(message);
  if (hasSequenceMarker(normFull)) return false;
  return true;
}

function maybeWheelTireAmbiguousProductClarification(message) {
  const a = analyzeWheelTireMessage(message);
  const normFull = normText(message);
  if (hasSequenceMarker(normFull)) return null;

  if (a.ambiguousWheelTarget) {
    return "Vrei soluție pentru curățarea jantelor sau pentru dressing pe anvelope?";
  }

  if (!a.bothTargetsMentioned || !hasProductRequestVerb(message)) return null;

  if (a.mixedCleanAndDress) {
    return shouldAskWheelTireProductClarification(message, a)
      ? "Vrei produs pentru curățarea jantelor sau pentru dressing pe anvelope?"
      : null;
  }

  if (a.wheelTireIntent) return null;

  return "Vrei produs pentru curățarea jantelor sau pentru dressing pe anvelope?";
}

function applyWheelTireObjectToSlots(message, slots) {
  const a = analyzeWheelTireMessage(message);
  if (!a.objectSlot || a.mixedCleanAndDress) return slots;
  const next = { ...slots };
  next.object = a.objectSlot;
  if (!next.context) next.context = "exterior";
  if (!next.surface) {
    next.surface = a.objectSlot === "anvelope" ? "tires" : "wheels";
  }
  return next;
}

function wheelTireTagBoost(message) {
  const a = analyzeWheelTireMessage(message);
  if (a.mixedCleanAndDress && a.bothTargetsMentioned) {
    return ["exterior", "wheels", "tires", "dressing", "cleaning"];
  }
  if (a.wheelTireIntent === "tire_dressing") {
    return ["exterior", "tires", "rubber", "dressing"];
  }
  if (a.wheelTireIntent === "wheel_cleaning") {
    return ["exterior", "wheels", "cleaning", "metal"];
  }
  return [];
}

function selectionRoleFromWheelTire(message) {
  const a = analyzeWheelTireMessage(message);
  if (a.wheelTireIntent === "tire_dressing") return "tire_dressing";
  if (a.wheelTireIntent === "wheel_cleaning") return "wheel_cleaner";
  return null;
}

module.exports = {
  analyzeWheelTireMessage,
  maybeWheelTireCombinedWorkflowReply,
  maybeWheelTireAmbiguousProductClarification,
  applyWheelTireObjectToSlots,
  wheelTireTagBoost,
  selectionRoleFromWheelTire
};
