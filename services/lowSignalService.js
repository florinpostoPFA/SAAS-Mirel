/**
 * Deterministic low-signal detection + intent-level clarification (Turbo: no slot loops).
 */

const { logInfo } = require("./logger");
const { analyzeSafetyQuery } = require("./safetyQueryService");

const SOURCE = "LowSignalService";

const MIN_CHARS = 12;
const MIN_TOKENS = 3;

const DOMAIN_NOUNS = [
  "geam",
  "geamuri",
  "jante",
  "anvelope",
  "bord",
  "scaune",
  "scaun",
  "piele",
  "textil",
  "mocheta",
  "parbriz",
  "vopsea",
  "plastic",
  "alcantara",
  "roti",
  "cauciuc",
  "insect",
  "ceramic",
  "wax",
  "polish"
];

const GENERIC_VERB_PHRASES = [
  "recomanda ceva",
  "recomandă ceva",
  "ce imi recomanzi",
  "ce îmi recomanzi",
  "vreau ceva",
  "ceva bun",
  "da-mi ceva",
  "dami ceva",
  "ajuta-ma",
  "ajută-mă",
  "ajuta ma",
  "help me",
  "help"
];

const CURAT_HINTS = ["curat", "curăț", "curatat", "curățat", "spal", "spăl"];

function normalizeRo(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

function tokenCount(normalized) {
  return normalized.split(/\s+/).filter(Boolean).length;
}

function hasDomainNoun(normalized) {
  const msg = normalized;
  return DOMAIN_NOUNS.some((w) => msg.includes(w));
}

function matchesInformationalBypass(raw, normalized) {
  const n = normalized != null ? String(normalized) : normalizeRo(raw);
  const r = String(raw || "").trim();
  if (/^ce\s+(este|e|inseamna|insemna)\b/i.test(r)) return true;
  if (/^cum\s+function(eaza|ează)\b/i.test(n)) return true;
  if (/^cum\s+funcționează\b/i.test(r)) return true;
  if (/^de\s+ce\b/i.test(n)) return true;
  return false;
}

function hasGenericVerbNoObject(normalized) {
  if (GENERIC_VERB_PHRASES.some((p) => normalized.includes(p))) {
    return true;
  }
  if (normalized === "ajuta" || normalized === "help") return true;
  return false;
}

function hasCleaningHintWithoutObject(normalized) {
  if (/^cum\s+/i.test(normalized)) {
    return false;
  }
  const hasCurat = CURAT_HINTS.some((h) => normalized.includes(h));
  if (!hasCurat) return false;
  return !hasDomainNoun(normalized) && !/\b(interior|exterior)\b/.test(normalized);
}

function slotsEffectivelyEmpty(slots) {
  if (!slots || typeof slots !== "object") return true;
  const keys = ["context", "object", "surface"];
  return keys.every((k) => slots[k] == null || String(slots[k]).trim() === "");
}

function intentIsAmbiguous(intent) {
  if (intent == null) return true;
  if (typeof intent === "string") {
    const t = intent.toLowerCase().trim();
    return t === "" || t === "unknown";
  }
  const type = typeof intent.type === "string" ? intent.type.toLowerCase().trim() : "";
  if (!type || type === "unknown") return true;
  const conf = typeof intent.confidence === "number" ? intent.confidence : null;
  if (conf != null && conf >= 0.72) return false;
  return conf == null || conf < 0.72;
}

/**
 * @param {string} message
 * @param {string} [normalizedMessage]
 * @param {unknown} intent
 * @param {Record<string, unknown>} [slots]
 * @param {unknown[]} [tags]
 * @returns {{ lowSignal: boolean, reason: string }}
 */
function isLowSignalMessage(message, normalizedMessage, intent, slots, tags) {
  const raw = String(message || "").trim();
  const normalized = normalizedMessage != null ? String(normalizedMessage).trim() : normalizeRo(raw);

  if (!raw) {
    return { lowSignal: true, reason: "empty" };
  }

  if (matchesInformationalBypass(raw, normalized)) {
    return { lowSignal: false, reason: "informational_bypass" };
  }

  const safety = analyzeSafetyQuery(raw);
  if (safety.triggered) {
    return { lowSignal: false, reason: "safety_query" };
  }

  if (hasDomainNoun(normalized)) {
    return { lowSignal: false, reason: "domain_noun" };
  }

  if (!slotsEffectivelyEmpty(slots)) {
    return { lowSignal: false, reason: "slots_present" };
  }

  if (!intentIsAmbiguous(intent)) {
    return { lowSignal: false, reason: "intent_clear" };
  }

  const tc = tokenCount(normalized);
  const shortMessage = raw.length < MIN_CHARS || tc < MIN_TOKENS;

  const genericVerb = hasGenericVerbNoObject(normalized);
  const weakClean = hasCleaningHintWithoutObject(normalized);

  if (shortMessage || genericVerb || weakClean) {
    const reason = shortMessage
      ? genericVerb
        ? "short_and_generic_verb"
        : weakClean
          ? "short_and_clean_hint"
          : "short_or_few_tokens"
      : genericVerb
        ? "generic_verb_no_object"
        : weakClean
          ? "clean_hint_no_object"
          : "generic";

    logInfo("LOW_SIGNAL_TRACE", {
      source: SOURCE,
      lowSignal: true,
      reason,
      len: raw.length,
      tokens: tc
    });
    return { lowSignal: true, reason };
  }

  return { lowSignal: false, reason: "sufficient_signal" };
}

/**
 * @param {string} message
 * @param {string} [normalizedMessage]
 * @returns {string}
 */
function buildLowSignalClarificationQuestion(message, normalizedMessage) {
  const raw = String(message || "");
  const norm = normalizedMessage != null ? String(normalizedMessage) : normalizeRo(raw);

  const interiorOnly =
    /\binterior\b/i.test(norm) &&
    !/\bexterior\b/i.test(norm) &&
    !hasDomainNoun(norm);
  const exteriorOnly =
    /\bexterior\b/i.test(norm) &&
    !/\binterior\b/i.test(norm) &&
    !hasDomainNoun(norm);

  if (interiorOnly || exteriorOnly) {
    return "Ce zonă vrei să tratezi? (ex: bord, scaune, mocheta, geamuri)";
  }

  if (hasCleaningHintWithoutObject(norm)) {
    return "Ce vrei să cureți: interior, exterior, geamuri, jante sau anvelope?";
  }

  return "Vrei pași (cum se face) sau vrei recomandare de produse?";
}

/**
 * @returns {{ kind: "procedural" } | { kind: "selection" } | { kind: "none" }}
 */
function classifyIntentLevelReply(message, normalizedMessage) {
  const raw = String(message || "").trim();
  const norm = normalizedMessage != null ? String(normalizedMessage) : normalizeRo(message);

  if (matchesInformationalBypass(raw, norm)) {
    return { kind: "none" };
  }

  if (
    /\b(pasi|pași|instructiuni|instrucțiuni)\b/.test(norm) ||
    /\bcum\s+se\s+face\b/.test(norm) ||
    /\bcum\s+fac\b/.test(norm) ||
    /\bprocedur\b/.test(norm) ||
    /\bghid\b/.test(norm) ||
    /^cum\s+/i.test(raw)
  ) {
    return { kind: "procedural" };
  }

  if (
    /\b(produse|produs|recomandare|recomand|recomanda|recomandă|caut|cumpar|cumpara|cumpăr)\b/.test(norm) ||
    /\b(product|shop|buy)\b/.test(norm)
  ) {
    return { kind: "selection" };
  }

  return { kind: "none" };
}

function buildLowSignalMenuPrompt() {
  return "Alege una: (1) Pași / cum se face  (2) Recomandare produse  (3) Spune ce zonă (ex: geamuri, jante).";
}

/**
 * Original narrow follow-up shapes: always skip low-signal intent_level (even without session carry-over).
 * @param {string} message
 * @returns {boolean}
 */
function isLegacySelectionFollowupShape(message) {
  const msg = String(message || "").toLowerCase();
  return (
    msg.includes("de care") ||
    msg.includes("ce recomanzi") ||
    msg.includes("link") ||
    msg.includes("ce produs") ||
    msg.includes("care e mai bun")
  );
}

/**
 * Expanded Romanian selection/recommendation follow-up (diacritics-insensitive).
 * For low-signal bypass these require session carry-over (see chatService); legacy shapes above do not.
 *
 * @param {string} message
 * @returns {boolean}
 */
function isSelectionFollowupMessage(message) {
  if (isLegacySelectionFollowupShape(message)) {
    return true;
  }

  const n = normalizeRo(message);
  if (!n || n.length < 6) {
    return false;
  }

  if (n.includes("recomanzi") && n.includes("pentru asta")) {
    return true;
  }
  if (n.includes("recomanda") && n.includes("pentru asta")) {
    return true;
  }
  if (n.includes("recomanzi pt asta") || n.includes("recomanda pt asta")) {
    return true;
  }
  if (n.includes("ce imi recoman") || n.includes("ce imi recomand")) {
    return true;
  }
  if (n.includes("ce produs recoman")) {
    return true;
  }
  if (n.includes("ce sa cumpar") || n.includes("ce sa cumperi")) {
    return true;
  }
  if (/\bimi\s+recoman/.test(n)) {
    return true;
  }
  if (n.includes("ce recomandare") || n.includes("vreau recomandare")) {
    return true;
  }

  return false;
}

module.exports = {
  normalizeRo,
  isLowSignalMessage,
  buildLowSignalClarificationQuestion,
  classifyIntentLevelReply,
  buildLowSignalMenuPrompt,
  matchesInformationalBypass,
  isLegacySelectionFollowupShape,
  isSelectionFollowupMessage,
  DOMAIN_NOUNS
};
