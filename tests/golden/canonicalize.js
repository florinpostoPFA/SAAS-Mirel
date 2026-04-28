/**
 * Stable key order for JSON comparison.
 */

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    out[k] = canonicalize(value[k]);
  }
  return out;
}

function stableStringify(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

module.exports = { canonicalize, stableStringify };
