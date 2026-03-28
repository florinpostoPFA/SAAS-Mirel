/**
 * tagService.js
 * Hybrid intent detection: rules-based + AI fallback
 * 
 * Flow:
 * 1. Apply client's tag_rules (fast deterministic matching)
 * 2. If no match → AI fallback (constrained by available tags)
 * 3. Return max 3 tags
 */

const { askLLM } = require("./llm");
const { info, debug } = require("./logger");

const SOURCE = "TagService";

/**
 * Step 1: Rule-based tag detection
 * Fast, deterministic matching using client's tag_rules
 * Returns matched tags or empty array
 */
function detectTagsByRules(message, tagRules) {
  const messageLower = message.toLowerCase();
  const detectedTags = [];

  if (!tagRules || tagRules.length === 0) {
    debug(SOURCE, "No tag rules configured, skipping rule-based detection");
    return [];
  }

  tagRules.forEach(rule => {
    // Check if any intent phrase matches the message
    if (Array.isArray(rule.phrases)) {
      rule.phrases.forEach(phrase => {
        if (messageLower.includes(phrase.toLowerCase())) {
          detectedTags.push(...rule.tags);
        }
      });
    }
  });

  return [...new Set(detectedTags)]; // Remove duplicates
}

/**
 * Step 2: AI-based tag detection (fallback)
 * Uses LLM to interpret intent, constrained to available tags
 * Only called if rule-based detection finds nothing
 */
async function detectTagsByAI(message, availableTags) {
  info(SOURCE, "Rule-based detection failed, using AI fallback");

  const availableTagsList = availableTags.join(", ");

  const prompt = `You are a product tag detector.
Given a customer message and available product tags, detect which tags are relevant.

Available tags: ${availableTagsList}

Customer message: "${message}"

Respond ONLY with a comma-separated list of tags (e.g.: "polish, wax").
If no tags match, respond: "none"
`;

  try {
    const response = await askLLM(prompt);
    const tags = response
      .toLowerCase()
      .split(",")
      .map(t => t.trim())
      .filter(t => t && t !== "none" && availableTags.includes(t));

    debug(SOURCE, "AI detected tags", tags);
    return tags;
  } catch (err) {
    debug(SOURCE, "AI fallback failed", { error: err.message });
    return [];
  }
}

/**
 * Main intent detection function
 * Hybrid approach: rules first, AI fallback
 * 
 * @param {string} message - Customer message
 * @param {array} tagRules - Client-defined rules [{phrases: [], tags: []}, ...]
 * @param {array} availableTags - All tags present in product catalog
 * @returns {array} Detected tags (max 3)
 */
async function detectTags(message, tagRules, availableTags) {
  info(SOURCE, `Detecting tags for message: "${message}"`);

  // Step 1: Try rule-based detection
  let detectedTags = detectTagsByRules(message, tagRules);

  if (detectedTags.length > 0) {
    info(SOURCE, `Rule-based detection matched`, detectedTags);
    return detectedTags.slice(0, 3); // Max 3 tags
  }

  // Step 2: Fall back to AI
  detectedTags = await detectTagsByAI(message, availableTags);

  if (detectedTags.length > 0) {
    info(SOURCE, `AI fallback succeeded`, detectedTags);
    return detectedTags.slice(0, 3);
  }

  // Step 3: No tags detected
  info(SOURCE, "No tags detected (rules nor AI)");
  return [];
}

module.exports = {
  detectTags,
  detectTagsByRules,
  detectTagsByAI
};
