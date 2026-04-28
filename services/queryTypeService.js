const { analyzeSafetyQuery } = require("./safetyQueryService");

function normalizeMessage(message) {
  return String(message || "").toLowerCase().trim();
}

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

/**
 * @param {string} message full normalized user message (safety always checked on this)
 * @param {string} [intentRoutingText] greeting-stripped / slang-normalized text for domain routing only
 */
function detectQueryType(message, intentRoutingText) {
  const msg = normalizeMessage(message);
  if (analyzeSafetyQuery(msg).triggered) {
    return "safety";
  }
  const routeMsg =
    intentRoutingText != null && String(intentRoutingText).trim() !== ""
      ? String(intentRoutingText).toLowerCase().trim()
      : msg;

  const informationalPhrases = ["ce este", "ce inseamna", "ce face", "la ce foloseste", "pentru ce este"];

  if (/^de\s+ce\b/i.test(routeMsg)) {
    return "informational";
  }

  if (
    routeMsg.includes("recomanda") ||
    routeMsg.includes("ce produs") ||
    routeMsg.includes("care e mai bun") ||
    (routeMsg.includes("folosesc") && (routeMsg.includes("ce") || routeMsg.includes("ceva")))
  ) {
    return "selection";
  }

  if (includesAny(routeMsg, informationalPhrases) || includesAny(routeMsg, ["definitie"])) {
    return "informational";
  }

  if (includesAny(routeMsg, ["cum", "cum spal", "cum curat"])) {
    return "procedural";
  }

  return "procedural";
}

module.exports = { detectQueryType };