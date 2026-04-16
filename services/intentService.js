const greetingKeywords = ["salut", "hello", "hi", "hey"];
const guidanceKeywords = ["cum", "folosesc", "fac", "procedez", "pasii", "plan"];

// Recommendation: explicit phrases — checked before order to avoid "recomanda" → "comanda" false positive
const recommendKeywords = ["recomanda", "recomandă", "ce produs", "ce imi recomanzi", "suggest", "recommend"];

// Order intents: full-phrase matching only (no bare "comanda" substring)
const orderStatusPhrases = ["status comanda", "unde este comanda", "am comandat", "tracking", "urmarire comanda"];
const orderUpdateKeywords = ["modific", "schimb", "update"];
const orderCancelKeywords = ["anulez", "cancel"];

/**
 * Returns true if the message contains the keyword as a whole word.
 */
function matchWord(normalized, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalized);
}

/**
 * Detect intent from raw user message.
 * Returns an object with type and confidence.
 */
function detectIntent(message, sessionId) {
  if (!message || typeof message !== "string") {
    return { type: "product_search", confidence: "low" };
  }

  const normalized = message.toLowerCase().trim();
  const words = normalized.split(/\s+/).filter(word => word.length > 0);

  // Greeting: short message with a greeting word
  if (words.length <= 2 && words.some(word => greetingKeywords.includes(word))) {
    return { type: "greeting", confidence: "high" };
  }

  // Recommend: checked FIRST before order to prevent "recomanda" → order false positive
  if (recommendKeywords.some(keyword => matchWord(normalized, keyword))) {
    return { type: "product_search", confidence: "high" };
  }

  // Guidance: how-to signals
  if (guidanceKeywords.some(keyword => normalized.includes(keyword))) {
    return { type: "product_guidance", confidence: "high" };
  }

  // Order cancel
  if (orderCancelKeywords.some(keyword => normalized.includes(keyword))) {
    return { type: "order_cancel", confidence: "high" };
  }

  // Order update
  if (orderUpdateKeywords.some(keyword => normalized.includes(keyword))) {
    return { type: "order_update", confidence: "high" };
  }

  // Order status: full-phrase match only — avoids "recomanda" substring collision
  if (orderStatusPhrases.some(phrase => normalized.includes(phrase))) {
    return { type: "order_status", confidence: "high" };
  }

  return { type: "product_search", confidence: "medium" };
}

module.exports = { detectIntent };
