/**
 * Informational section text-fallback when role config yields zero products (May 31).
 * Core matching remains in chatService.findProductsByRoleConfig.
 */
const { tryRoleEmptySectionKnowledgeFallback } = require("./productSectionsKnowledge");

/**
 * @param {Array} roleMatches - products from findProductsByRoleConfig
 * @param {string} message
 * @param {string} queryType
 * @returns {import("./productSectionsKnowledge").tryProductSectionQuoteKnowledge extends Function ? object : null}
 */
function tryInformationalSectionFallbackFromRoleEmpty(roleMatches, message, queryType) {
  return tryRoleEmptySectionKnowledgeFallback(message, queryType, roleMatches);
}

module.exports = {
  tryInformationalSectionFallbackFromRoleEmpty
};
