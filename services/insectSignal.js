/**
 * Explicit insect/bug signals for routing (RO + EN). Deterministic; no LLM.
 * bug_removal_quick must only run when this returns true.
 */

function normalizeForInsectMatch(text) {
  let s = String(text || "").toLowerCase();
  s = s.replace(/[ăâ]/g, "a").replace(/î/gi, "i").replace(/[șş]/g, "s").replace(/[țţ]/g, "t");
  return s;
}

function hasExplicitInsectSignal(message) {
  const raw = String(message || "").toLowerCase();
  const msg = normalizeForInsectMatch(message);

  const phrases = [
    "insecte",
    "insect",
    "gandaci",
    "muste",
    "musca",
    "urme de insecte",
    "buguri",
    "bugs"
  ];

  if (phrases.some((p) => msg.includes(p))) {
    return true;
  }

  if (/\bbug\b/.test(msg)) {
    return true;
  }

  if (raw.includes("țânțar") || raw.includes("tantar")) {
    return true;
  }

  return false;
}

module.exports = { hasExplicitInsectSignal, normalizeForInsectMatch };
