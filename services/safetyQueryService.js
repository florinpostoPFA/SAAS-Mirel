/**
 * Safety / compatibility query analysis (deterministic).
 * Option A: answer-first + at most one targeted clarification.
 */

const { logInfo } = require("./logger");

const SAFETY_TRIGGER_PHRASES = [
  "pot folosi",
  "pot sa folosesc",
  "e sigur",
  "este sigur",
  "compatibil",
  "merge pe",
  "strica",
  "strică",
  "dauneaza",
  "dăunează",
  "e ok pe",
  "este ok pe",
  "afecteaza",
  "afectează",
  "am voie",
  "pot sa",
  "este bun pentru",
  "e bun pentru",
  "este ok pentru",
  "e ok pentru",
  "functioneaza pe",
  "funcționează pe",
  "sigur pe",
  "safe pe"
];

const MATERIAL_KEYWORDS = [
  "piele",
  "textil",
  "textile",
  "plastic",
  "alcantara",
  "vopsea",
  "sticla",
  "sticlă",
  "geam",
  "parbriz",
  "crom",
  "jante",
  "anvelope",
  "mocheta",
  "bord",
  "vinyl",
  "piele ecologica",
  "piele ecologică"
];

const CHEMICAL_PRODUCT_KEYWORDS = [
  "apc",
  "degresant",
  "alcool",
  "solvent",
  "acid",
  "snow foam",
  "tar remover",
  "clay",
  "iron remover",
  "solutie",
  "soluție",
  "sampon",
  "șampon",
  "shampoo",
  "wax",
  "polish",
  "ceramic",
  "coat",
  "prewash",
  "pre-spalare",
  "insect",
  "bug remover",
  "tfr",
  "wheel acid"
];

const ORDER_BLOCK_PHRASES = [
  "status comanda",
  "unde este comanda",
  "am comandat",
  "urmarire comanda",
  "anulez comanda",
  "modific comanda"
];

function normalizeMsg(message) {
  return String(message || "").toLowerCase().trim();
}

function includesAny(hay, list) {
  return list.some((x) => hay.includes(x));
}

/**
 * @returns {{ triggered: boolean, reason: string, missingCriticalField?: string, safetyAnswerType?: "yes"|"no"|"depends" }}
 */
function analyzeSafetyQuery(message) {
  const msg = normalizeMsg(message);
  if (!msg) {
    return { triggered: false, reason: "empty_message" };
  }

  if (includesAny(msg, ORDER_BLOCK_PHRASES)) {
    return { triggered: false, reason: "order_intent_excluded" };
  }

  const mergePeCompat = /\bmerge\b/.test(msg) && /\bpe\b/.test(msg);

  const hasTrigger = includesAny(msg, SAFETY_TRIGGER_PHRASES) ||
    mergePeCompat ||
    /(este|e)\s+bun\s+pentru/.test(msg) ||
    /(este|e)\s+ok\s+pentru/.test(msg);

  if (!hasTrigger) {
    return { triggered: false, reason: "no_safety_phrase" };
  }

  const hasMaterial = includesAny(msg, MATERIAL_KEYWORDS);
  const hasChemical = includesAny(msg, CHEMICAL_PRODUCT_KEYWORDS);

  if (!hasMaterial && !hasChemical) {
    return {
      triggered: true,
      reason: "safety_phrase_missing_target",
      missingCriticalField: "material_or_product"
    };
  }

  if (hasTrigger && hasMaterial && !hasChemical) {
    return {
      triggered: true,
      reason: "safety_material_missing_product",
      missingCriticalField: "product_or_chemical"
    };
  }

  if (hasTrigger && hasChemical && !hasMaterial) {
    return {
      triggered: true,
      reason: "safety_product_missing_surface",
      missingCriticalField: "surface_material"
    };
  }

  const hasFinishHint =
    /\bmat(a)?\b|lucios|lucio|ceramic|wax|coating|folie|luciu/.test(msg);
  if (
    hasTrigger &&
    hasMaterial &&
    hasChemical &&
    msg.includes("plastic") &&
    (msg.includes("degresant") || msg.includes("solvent")) &&
    !hasFinishHint
  ) {
    return {
      triggered: true,
      reason: "safety_plastic_deg_finish_unknown",
      missingCriticalField: "finish_type"
    };
  }

  const hasLeatherTypeHint =
    /naturala|naturală|ecologic|vinyl|nappa|anilin/.test(msg);
  if (
    hasTrigger &&
    hasMaterial &&
    hasChemical &&
    msg.includes("apc") &&
    msg.includes("piele") &&
    !hasLeatherTypeHint
  ) {
    return {
      triggered: true,
      reason: "safety_leather_type_unknown",
      missingCriticalField: "leather_type"
    };
  }

  return {
    triggered: true,
    reason: "safety_complete_signal",
    safetyAnswerType: inferAnswerShape(msg)
  };
}

function inferAnswerShape(msg) {
  if (msg.includes("acid") && (msg.includes("piele") || msg.includes("textil"))) {
    return "no";
  }
  if (msg.includes("apc") && msg.includes("piele")) {
    return "depends";
  }
  if (msg.includes("degresant") && msg.includes("plastic")) {
    return "depends";
  }
  return "depends";
}

function isSafetyQuery(message) {
  return analyzeSafetyQuery(message).triggered;
}

const CLARIFICATION_BY_FIELD = {
  material_or_product:
    "Pentru un raspuns sigur: despre ce suprafata sau ce produs chimic e vorba (ex: APC diluat, piele, textil)?",
  product_or_chemical:
    "Ce produs anume vrei sa folosesti (ex: APC, degresant, sampon) si e concentrat sau deja diluat?",
  surface_material:
    "Pe ce suprafata exact vrei sa il folosesti (piele naturala, textil, plastic, vopsea mată/lucioasă)?",
  leather_type:
    "E piele naturala sau piele ecologica (vinyl)?",
  apc_dilution:
    "APC-ul tau e concentrat sau deja diluat gata de folosit?",
  finish_type:
    "Suprafata e mata sau lucioasa / are deja ceramic sau wax?"
};

function buildAnswerFirstBody(msg, answerType) {
  const lines = [];
  if (answerType === "no") {
    lines.push("NU — risc mare de deteriorare sau pata ireversibila.");
    lines.push("Evita aplicarea pe materiale sensibile; foloseste un produs dedicat suprafetei.");
    lines.push("Daca ai aplicat deja, clateste abundent cu apa si usuca cu microfibra curata.");
    return lines;
  }
  if (msg.includes("piele")) {
    lines.push("DEPINDE de tipul de piele si de dilutie.");
    lines.push("In general: da, doar foarte diluat (ex. dilutie mica), test intr-o zona ascunsa, timp scurt de contact, sterge imediat si nu lasa sa usuce pe piele.");
    lines.push("Nu folosi APC puternic sau repetat; prefera cleaner dedicat pentru piele.");
    return lines;
  }
  if (msg.includes("textil") || msg.includes("mocheta")) {
    lines.push("DEPINDE de material si de cat e de diluat produsul.");
    lines.push("Da, doar diluat, fara sa imbibi excesiv; test discret intr-un colt.");
    lines.push("Clateste bine si lasa sa aeriseasca; evita frecarea agresiva.");
    return lines;
  }
  if (msg.includes("plastic") || msg.includes("bord")) {
    lines.push("DEPINDE de agresivitatea solutiei si finisaj (mat/lucios).");
    lines.push("In general pe plastic dur: da, diluat, sters complet, fara produs uscat pe suprafata.");
    lines.push("Evita solventi puternici sau lasat indelung; test pe zona mica.");
    return lines;
  }
  if (msg.includes("vopsea") || msg.includes("clear") || msg.includes("lac")) {
    lines.push("DEPINDE de produs si daca vopseaua are deja protectie.");
    lines.push("Nu lasa APC/solventi sa usuce pe vopsea; clateste repede.");
    lines.push("Test pe zona mica; evita soarele fierbinte imediat dupa.");
    return lines;
  }
  if (msg.includes("geam") || msg.includes("sticla") || msg.includes("parbriz")) {
    lines.push("In general DA pe geam, cu produs potrivit si laveta curata.");
    lines.push("Evita solutii cu amoniac pe folii interior daca e cazul; pe exterior urmeaza instructiunile produsului.");
    return lines;
  }
  lines.push("DEPINDE de produsul exact si suprafata.");
  lines.push("Principii: diluare corecta, timp scurt de actiune, test discret, clatire completa, uscare cu microfibra.");
  lines.push("Daca nu esti sigur, foloseste varianta cea mai putin agresiva sau un produs dedicat.");
  return lines;
}

function headlineForType(answerType) {
  if (answerType === "no") return "NU.";
  if (answerType === "yes") return "DA.";
  return "DEPINDE.";
}

/**
 * Deterministic safety reply (no product list).
 */
function buildSafetyAnswerText(message, analysis) {
  const msg = normalizeMsg(message);
  const t = analysis.safetyAnswerType || "depends";
  const head = headlineForType(t);
  const body = buildAnswerFirstBody(msg, t);
  return [head, ...body].join("\n");
}

function conservativeFollowUpReply() {
  return [
    "DEPINDE.",
    "Fara detalii clare, recomand varianta cea mai conservatoare: produs dedicat suprafetei, dilutie mica, test intr-o zona ascunsa, timp scurt, clatire abundenta.",
    "Daca ai dubii, nu combina solutii agresive pe materiale sensibile."
  ].join("\n");
}

function logSafetyFields(payload) {
  logInfo("SAFETY_TRUST", {
    safetyGateTriggered: payload.safetyGateTriggered,
    safetyReason: payload.safetyReason,
    missingCriticalField: payload.missingCriticalField ?? null,
    safetyAnswerType: payload.safetyAnswerType ?? null,
    askedClarification: payload.askedClarification,
    blockedProductRouting: payload.blockedProductRouting
  });
}

module.exports = {
  analyzeSafetyQuery,
  isSafetyQuery,
  buildSafetyAnswerText,
  CLARIFICATION_BY_FIELD,
  conservativeFollowUpReply,
  logSafetyFields,
  normalizeMsg,
  SAFETY_TRIGGER_PHRASES,
  MATERIAL_KEYWORDS,
  CHEMICAL_PRODUCT_KEYWORDS
};
