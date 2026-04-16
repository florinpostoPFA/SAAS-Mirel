const tagDictionary = require("./tagDictionary");

/**
 * Count how many keywords from the array appear in the message.
 * @param {string} message - normalized (lowercase) user message
 * @param {string[]} keywordArray
 * @returns {number}
 */
function countMatches(message, keywordArray) {
  if (!Array.isArray(keywordArray)) return 0;
  return keywordArray.filter(kw => message.includes(kw)).length;
}

/**
 * Detect whether the user query refers to car interior or exterior.
 * @param {string} message - raw user input
 * @param {string[]} tags - tags already detected by TagService
 * @returns {{ context: string|null, confidence: number, source: string }}
 */
function detectContext(message, tags = []) {
  const normalized = String(message || "").toLowerCase();
  const safeTags = Array.isArray(tags) ? tags : [];

  // Keyword scoring
  const kwInterior = countMatches(normalized, tagDictionary.interior || []);
  const kwExterior = countMatches(normalized, tagDictionary.exterior || []);

  // Tag-based scoring
  const tagInterior = safeTags.includes("interior") ? 2 : 0;
  const tagExterior = safeTags.includes("exterior") ? 2 : 0;

  const totalInterior = kwInterior + tagInterior;
  const totalExterior = kwExterior + tagExterior;
  const total = totalInterior + totalExterior;

  let result;

  if (total === 0) {
    result = { context: null, confidence: 0, source: "none" };
  } else if (totalInterior === totalExterior) {
    result = { context: null, confidence: 0.5, source: "ambiguous" };
  } else if (totalInterior > totalExterior) {
    const source = tagInterior > 0 && kwInterior === 0 ? "tag" : "keyword";
    result = { context: "interior", confidence: totalInterior / total, source };
  } else {
    const source = tagExterior > 0 && kwExterior === 0 ? "tag" : "keyword";
    result = { context: "exterior", confidence: totalExterior / total, source };
  }

  return result;
}

module.exports = { detectContext };
