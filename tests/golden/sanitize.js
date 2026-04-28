/**
 * Remove volatile / bulky fields so golden baselines stay stable.
 */

const VOLATILE_KEY_RE = /^(timestamp|normalizedMessage|productsCatalog|feedback)$/i;

function shouldDropKey(key) {
  return VOLATILE_KEY_RE.test(key);
}

function sanitizeValue(value, path) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v, i) => sanitizeValue(v, `${path}[${i}]`));
  }
  const out = {};
  const keys = Object.keys(value).sort();
  for (const k of keys) {
    if (shouldDropKey(k)) continue;
    if (k === "createdAt" || k === "lastActivity") continue;
    if (path === "" && k === "conversationHistory") {
      out[k] = (value[k] || []).map((row, i) => {
        if (!row || typeof row !== "object") return row;
        const { timestamp: _t, ...rest } = row;
        return sanitizeValue(rest, `${path}.${k}[${i}]`);
      });
      continue;
    }
    out[k] = sanitizeValue(value[k], path ? `${path}.${k}` : k);
  }
  return out;
}

function sanitizeGoldenSummary(obj) {
  return sanitizeValue(obj, "");
}

module.exports = { sanitizeGoldenSummary, shouldDropKey };
