/**
 * Deterministic interior/exterior context inference (strong signals only).
 * Single source of truth for explicit keywords + keyword bundles.
 */

const { hasExplicitInsectSignal } = require("./insectSignal");
const { logInfo } = require("./logger");

function normalizeForContextInference(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

function messageMentionsGlassSynonym(message) {
  const msg = String(message || "").toLowerCase();
  return (
    msg.includes("sticla") ||
    msg.includes("sticlă") ||
    msg.includes("geam") ||
    msg.includes("parbriz") ||
    msg.includes("windshield")
  );
}

function hasStrongGlassExteriorSignal(message) {
  return hasExplicitInsectSignal(message) && messageMentionsGlassSynonym(message);
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

function detectExplicitContext(message) {
  const s = normalizeForContextInference(message);

  if (isExplicitMultiContext(message)) return null;

  const hasInterior =
    s.includes("interior") ||
    s.includes("interioara") ||
    s.includes("interioare") ||
    s.includes("in interior") ||
    s.includes("cabina") ||
    s.includes("habitaclu");

  const hasExterior =
    s.includes("exterior") ||
    s.includes("exterioara") ||
    s.includes("exterioare") ||
    s.includes("in exterior") ||
    s.includes("pe afara");

  if (hasInterior && !hasExterior) return "interior";
  if (hasExterior && !hasInterior) return "exterior";
  return null;
}

const CONTEXT_ENTRY_TREATMENTS = Object.freeze(["ceramic", "ppf", "wax", "none", "unknown"]);

function hasAmbiguousBothReply(message) {
  const s = normalizeForContextInference(message);
  return /\bambele\b/.test(s) || /\bboth\b/.test(s) || s === "amandoua";
}

function isExplicitMultiContext(message) {
  const s = normalizeForContextInference(message);
  const hasInteriorKeyword =
    s.includes("interior") || s.includes("in interior") || s.includes("habitaclu") || s.includes("cabina");
  const hasExteriorKeyword =
    s.includes("exterior") || s.includes("in exterior") || s.includes("pe afara") || s.includes("caroserie");

  const hasInteriorObject = hasInteriorCabinObjectSignal(s);
  const hasInteriorMaterial = s.includes("piele") || s.includes("textil") || s.includes("alcantara");
  const hasExteriorObject =
    s.includes("caroserie") || s.includes("jante") || s.includes("anvelope") || s.includes("vopsea");

  return (
    (hasInteriorKeyword && hasExteriorKeyword) ||
    ((hasInteriorObject || hasInteriorMaterial) && hasExteriorKeyword) ||
    (hasInteriorKeyword && hasExteriorObject) ||
    ((hasInteriorObject || hasInteriorMaterial) && hasExteriorObject) ||
    s.includes("atat interior cat si exterior") ||
    s.includes("interior si exterior") ||
    s.includes("exterior si interior")
  );
}

function inferTreatment(message) {
  const s = normalizeForContextInference(message);
  if (s.includes("ceramic")) return "ceramic";
  if (s.includes("ppf")) return "ppf";
  if (s.includes("ceara") || s.includes("wax")) return "wax";
  return "unknown";
}

function inferInteriorSurface(message) {
  const s = normalizeForContextInference(message);
  if (s.includes("piele")) return "leather";
  if (s.includes("textil") || s.includes("textile")) return "textile";
  if (s.includes("alcantara")) return "alcantara";
  if (s.includes("bord") || s.includes("plastic")) return "plastic";
  return "interior";
}

function inferExteriorSurface(message) {
  const s = normalizeForContextInference(message);
  if (s.includes("geam") || s.includes("sticla") || s.includes("parbriz")) return "glass";
  if (s.includes("jante")) return "wheels";
  if (s.includes("anvelope")) return "tires";
  return "paint";
}

function buildContextEntry(context, surface, treatment, source) {
  const t = CONTEXT_ENTRY_TREATMENTS.includes(treatment) ? treatment : "unknown";
  return { context, surface, treatment: t, source };
}

function extractContextEntries(message) {
  if (!isExplicitMultiContext(message)) return [];
  const treatment = inferTreatment(message);
  const entries = [
    buildContextEntry("interior", inferInteriorSurface(message), "unknown", "user_input"),
    buildContextEntry("exterior", inferExteriorSurface(message), treatment, "user_input")
  ];
  return entries;
}

function hasInteriorCabinObjectSignal(normalized) {
  const s = normalized || "";
  return (
    s.includes("bord") ||
    s.includes("scaun") ||
    s.includes("bancheta") ||
    s.includes("tapiterie") ||
    s.includes("mocheta") ||
    s.includes("plafon") ||
    s.includes("volan") ||
    s.includes("cotiera")
  );
}

function inferStrongContextBundles(message, normalized, slots) {
  const s = normalized || normalizeForContextInference(message);
  const text = String(message || "").toLowerCase();
  const obj = String((slots && slots.object) || "").toLowerCase();

  const glassObj = obj === "glass" || messageMentionsGlassSynonym(message);
  if (glassObj) {
    if (hasStrongGlassExteriorSignal(message)) {
      return { inferredContext: "exterior", reason: "insect_on_glass", confidence: "strong" };
    }
    if (hasStrongGlassInteriorSignal(message)) {
      return { inferredContext: "interior", reason: "glass_interior_cue", confidence: "strong" };
    }
  }

  if (hasExplicitInsectSignal(message)) {
    if (
      s.includes("parbriz") ||
      s.includes("bara") ||
      s.includes("capota") ||
      text.includes("parbriz") ||
      text.includes("bara") ||
      text.includes("capota")
    ) {
      return { inferredContext: "exterior", reason: "insect_on_body_panel", confidence: "strong" };
    }
  }

  const interiorStorageCue =
    s.includes("portbagaj") ||
    s.includes("cabina") ||
    s.includes("habitaclu") ||
    (s.includes("anvelope") && (s.includes("depozit") || s.includes("cauciucuri")));

  if ((s.includes("jante") || s.includes("anvelope")) && !interiorStorageCue) {
    return { inferredContext: "exterior", reason: "wheels_or_tires", confidence: "strong" };
  }

  const washExteriorStrong =
    s.includes("sampon") ||
    s.includes("prewash") ||
    s.includes("pre wash") ||
    (s.includes("spuma") && s.includes("activ")) ||
    (s.includes("spal") &&
      (s.includes("caroserie") || s.includes("exterior") || s.includes("masina") || s.includes("auto")));

  if (washExteriorStrong) {
    return { inferredContext: "exterior", reason: "exterior_wash_cues", confidence: "strong" };
  }

  const coatingExteriorStrong =
    s.includes("coating") ||
    s.includes("ceramic") ||
    s.includes("ceramica") ||
    s.includes("ceara") ||
    s.includes("sealant") ||
    s.includes("sigilant") ||
    s.includes("protectie vopsea") ||
    s.includes("protectie lac");

  if (coatingExteriorStrong) {
    return { inferredContext: "exterior", reason: "coating_wax_polish_cues", confidence: "strong" };
  }

  if (hasInteriorCabinObjectSignal(s)) {
    return { inferredContext: "interior", reason: "cabin_object", confidence: "strong" };
  }

  return null;
}

/**
 * @param {object} params
 * @returns {{ inferredContext: "interior"|"exterior"|null, reason: string, confidence: "strong"|"weak" }}
 */
function inferContext(params) {
  const {
    message,
    normalizedMessage,
    slots = {},
    slotMeta,
    pendingQuestion
  } = params || {};

  const normalized =
    normalizedMessage != null ? String(normalizedMessage) : normalizeForContextInference(message);

  if (slotMeta && slotMeta.context === "confirmed") {
    const pendingSlot = pendingQuestion && pendingQuestion.slot;
    const answeringContext =
      pendingSlot === "context" || pendingQuestion?.type === "confirm_context";
    if (!answeringContext) {
      return {
        inferredContext: null,
        reason: "context_confirmed_no_reinfer",
        confidence: "weak"
      };
    }
  }

  const explicit = detectExplicitContext(message);
  if (explicit) {
    return { inferredContext: explicit, reason: "explicit_context", confidence: "strong" };
  }

  const extracted = extractContextEntries(message);
  if (extracted.length > 1) {
    return { inferredContext: null, reason: "multi_context_explicit", confidence: "weak" };
  }

  const bundle = inferStrongContextBundles(message, normalized, slots);
  if (bundle) {
    return bundle;
  }

  return { inferredContext: null, reason: "no_strong_signal", confidence: "weak" };
}

function logContextInferenceTrace(payload) {
  logInfo("CONTEXT_INFERENCE_TRACE", payload);
}

module.exports = {
  normalizeForContextInference,
  detectExplicitContext,
  isExplicitMultiContext,
  hasAmbiguousBothReply,
  extractContextEntries,
  CONTEXT_ENTRY_TREATMENTS,
  inferContext,
  logContextInferenceTrace
};
