/**
 * Strip narrow material tags unless the user explicitly mentions them.
 * Prevents wheel/jante queries from inheriting "metal" without aluminiu/metal/etc.
 */

const INFERRED_MATERIAL_TAGS = new Set(["metal", "aluminum", "aluminium"]);

const EXPLICIT_MATERIAL_RE =
  /\b(aluminiu|aluminum|aluminium|metal|crom|otel|inox|chrome|chromium|otel)\b/i;

function userMentionedExplicitMaterial(message) {
  return EXPLICIT_MATERIAL_RE.test(String(message || ""));
}

/**
 * @param {string} message
 * @param {string[]} tags
 * @returns {string[]}
 */
function stripInferredMaterialTags(message, tags) {
  if (userMentionedExplicitMaterial(message)) {
    return tags;
  }
  const list = Array.isArray(tags) ? tags : [];
  return list.filter((t) => !INFERRED_MATERIAL_TAGS.has(String(t || "").toLowerCase()));
}

module.exports = {
  INFERRED_MATERIAL_TAGS,
  EXPLICIT_MATERIAL_RE,
  userMentionedExplicitMaterial,
  stripInferredMaterialTags
};
