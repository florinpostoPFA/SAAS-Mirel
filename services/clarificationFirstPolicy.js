const { getMissingSlot } = require("./slotCompleteness");

const ACTION_SIGNAL_TAGS = new Set([
  "cleaning",
  "protection",
  "polish",
  "restore",
  "maintain",
  "protect",
  "dress",
  "decontaminate",
  "wax",
  "hydrate"
]);

const ACTION_TAG_ALIASES = Object.freeze({
  interior_cleaner: "cleaning",
  leather_cleaner: "cleaning",
  glass_cleaner: "cleaning",
  wheel_cleaner: "cleaning",
  textile_cleaner: "cleaning",
  upholstery_cleaner: "cleaning",
  stain_remover: "cleaning",
  shampoo: "cleaning",
  cleaner: "cleaning",
  car_shampoo: "cleaning",
  leather_conditioner: "hydrate",
  conditioner: "hydrate",
  tire_dressing: "dress",
  polish_compound: "polish",
  sealant: "protection",
  protectant: "protection"
});

const ROLE_ACTION_TAGS = Object.freeze({
  leather_cleaner: ["cleaning"],
  leather_protectant: ["hydrate", "protection"],
  tire_dressing: ["dress"],
  glass_cleaner: ["cleaning"],
  wheel_cleaner: ["cleaning"],
  car_shampoo: ["cleaning"],
  textile_cleaner: ["cleaning"],
  interior_cleaner: ["cleaning"]
});

function actionTagsForRole(role) {
  const key = String(role || "").trim();
  return key && Array.isArray(ROLE_ACTION_TAGS[key]) ? [...ROLE_ACTION_TAGS[key]] : [];
}

function resolveSelectionActionTags({ role = null, tags = [], slots = null }) {
  const fromRole = actionTagsForRole(role);
  if (fromRole.length > 0) return fromRole;
  return extractActionCategoryTags(tags, slots);
}

function extractActionCategoryTags(tags, slots = null) {
  const out = new Set();
  const safeTags = Array.isArray(tags) ? tags : [];
  for (const raw of safeTags) {
    const t = String(raw || "").toLowerCase().trim();
    if (!t) continue;
    if (ACTION_SIGNAL_TAGS.has(t)) out.add(t);
    else if (ACTION_TAG_ALIASES[t]) out.add(ACTION_TAG_ALIASES[t]);
  }
  const slotAction = String(slots?.action || "").toLowerCase().trim();
  if (slotAction === "clean") out.add("cleaning");
  if (slotAction === "protect") out.add("protection");
  return Array.from(out);
}
const CLARIFICATION_BUDGET_MAX = 2;
const FORCE_FALLBACK_RE =
  /\b(nu\s+stiu|nu\s+știu|nu\s+stiu,?\s*recomand|recomanda-mi tu|da-mi orice)\b/i;
const STRONG_INTENSITY_RE =
  /\b(foarte|f\.\s*murdar|noroi|pete grele|mizerie grea|pata adanca)\b/i;

const ZERO_RESULTS_QUESTION_RO =
  "Nu găsesc o potrivire exactă în catalog. Vrei să extind căutarea sau să-mi spui marca și modelul mașinii?";

const TERMINAL_FALLBACK_PREFIX_RO =
  "Am încercat să găsesc o potrivire exactă, dar nu reușesc. Vrei să-ți recomand";

function getClarificationAttemptTotal(session) {
  const inc = Number(session?.clarificationCountIncrement) || 0;
  const counts = session?.clarificationAskCounts;
  if (!counts || typeof counts !== "object") return inc;
  const fromCounts = Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0);
  return Math.max(inc, fromCounts);
}

function isClarificationBudgetExhausted(session) {
  return getClarificationAttemptTotal(session) >= CLARIFICATION_BUDGET_MAX;
}

function detectForceFallback(message) {
  return FORCE_FALLBACK_RE.test(String(message || "").toLowerCase().trim());
}

function resolvePriorityMissingSlot(slots, intentTags, message) {
  const missing = getMissingSlot(slots || {});
  const tags = Array.isArray(intentTags) ? intentTags : [];
  const s = slots && typeof slots === "object" ? slots : {};

  if (!s.action && tags.some((t) => ACTION_SIGNAL_TAGS.has(String(t).toLowerCase()))) {
    return "surface";
  }
  if (missing) return missing;
  if (!s.actionIntensity && STRONG_INTENSITY_RE.test(String(message || ""))) {
    return "surface";
  }
  return null;
}

function evaluateClarificationGate(opts = {}) {
  const {
    slots = {},
    slotMeta = {},
    intentTags = [],
    productsReason = null,
    session = null,
    message = null
  } = opts;

  if (detectForceFallback(message)) {
    return { shouldClarify: false, gateReason: "none", allowTerminalFallback: true };
  }

  const exhausted = session ? isClarificationBudgetExhausted(session) : false;
  if (exhausted) {
    return { shouldClarify: false, gateReason: "none", clarificationExhausted: true, allowTerminalFallback: true };
  }

  const missingSlot = resolvePriorityMissingSlot(slots, intentTags, message);
  const slotsMissing = missingSlot != null || getMissingSlot(slots) != null;
  const zeroResults = productsReason === "no_matching_products";
  const lowConfidenceSurface =
    slotMeta?.surface === "inferred" && !slotMeta?.surfaceConfirmed;

  if (!slotsMissing && !zeroResults && !lowConfidenceSurface) {
    return { shouldClarify: false, gateReason: "none", missingSlot: null, allowTerminalFallback: false };
  }

  const gateReason =
    (slotsMissing || lowConfidenceSurface) && zeroResults
      ? "both"
      : slotsMissing || lowConfidenceSurface
        ? "slots_missing"
        : "zero_results";

  return {
    shouldClarify: true,
    gateReason,
    missingSlot: missingSlot || getMissingSlot(slots) || (zeroResults ? null : "surface"),
    clarificationExhausted: false,
    allowTerminalFallback: false
  };
}

function shouldAllowTerminalSafeFallback(session, message) {
  if (detectForceFallback(message)) return true;
  if (session && isClarificationBudgetExhausted(session)) return true;
  return getClarificationAttemptTotal(session) >= 1;
}

function buildTerminalFallbackMessage(productName) {
  const name = String(productName || "un APC sigur").trim();
  return (
    `${TERMINAL_FALLBACK_PREFIX_RO} ${name} ca soluție generală, sau preferi să-mi dai mai multe detalii?`
  );
}

function selectClarificationMessage({ missingSlot, gateReason, slots, getQuestion }) {
  const slotGap = getMissingSlot(slots || {});
  if (
    (gateReason === "zero_results" || gateReason === "both") &&
    !slotGap
  ) {
    return ZERO_RESULTS_QUESTION_RO;
  }
  if (typeof getQuestion === "function" && missingSlot) {
    return getQuestion(missingSlot, slots || {}, "ro");
  }
  return ZERO_RESULTS_QUESTION_RO;
}

module.exports = {
  ACTION_SIGNAL_TAGS,
  ACTION_TAG_ALIASES,
  ROLE_ACTION_TAGS,
  actionTagsForRole,
  resolveSelectionActionTags,
  extractActionCategoryTags,
  CLARIFICATION_BUDGET_MAX,
  ZERO_RESULTS_QUESTION_RO,
  evaluateClarificationGate,
  isClarificationBudgetExhausted,
  shouldAllowTerminalSafeFallback,
  detectForceFallback,
  buildTerminalFallbackMessage,
  selectClarificationMessage,
  getClarificationAttemptTotal
};
