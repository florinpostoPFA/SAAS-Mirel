const { info } = require("./logger");

const greetingKeywords = ["salut", "hello", "hi", "hey"];

/**
 * Detect intent from raw user message.
 * Returns one of: "greeting", "product_search".
 */
function detectIntent(message) {
  if (!message || typeof message !== "string") {
    return "product_search";
  }

  const normalized = message.toLowerCase().trim();
  const words = normalized.split(/\s+/).filter(word => word.length > 0);
  
  // Greeting should match ONLY if:
  // - message contains greeting words AND has max 1–2 words
  if (words.length <= 2 && words.some(word => greetingKeywords.includes(word))) {
    const detectedIntent = "greeting";
    console.log("[INTENT]", message, "→", detectedIntent);
    info("IntentService", `Detected greeting intent: ${words.join(' ')}`);
    return detectedIntent;
  }

  const detectedIntent = "product_search";
  console.log("[INTENT]", message, "→", detectedIntent);
  info("IntentService", "Detected default product_search intent");
  return detectedIntent;
}

module.exports = { detectIntent };
