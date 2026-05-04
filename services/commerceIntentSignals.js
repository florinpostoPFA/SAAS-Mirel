/**
 * P1.12 — Explicit commerce / purchase-intent phrases (Romanian + common Latin).
 * Used to avoid dead-end informational routing when the user asks for products, links, or recommendations.
 */

function hasExplicitCommerceProductIntent(message) {
  const m = String(message || "").toLowerCase().trim();
  if (!m) return false;
  if (/\bde care\b/.test(m)) return true;
  if (/\blink\b/.test(m)) return true;
  if (/\brecomand[aăă]|recomanzi|recomanda-?mi|recomanda\b/i.test(m)) return true;
  if (/ce (să|sa) cump(ăr|ar)/.test(m)) return true;
  if (/\bprodus(e)?\b.*\b(iau|cumpar|cumpăr|vreau)\b/.test(m)) return true;
  return false;
}

module.exports = { hasExplicitCommerceProductIntent };
