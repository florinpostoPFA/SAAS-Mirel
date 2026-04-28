/**
 * Deterministic greeting/filler stripping for intent routing (Phase A robustness).
 * Operates on already lowercased, whitespace-normalized text.
 */

const LEADING_GREETING_OR_FILLER = new Set([
  "salut",
  "salutare",
  "buna",
  "bună",
  "buna ziua",
  "bună ziua",
  "noroc",
  "hello",
  "hey",
  "hi",
  "ok",
  "okay",
  "off",
  "te rog",
  "te rog frumos",
  "multumesc",
  "mulțumesc",
  "mersi"
]);

function collapseRepeatedCommas(s) {
  return String(s || "").replace(/(?:\s*,\s*){2,}/g, ", ").replace(/^\s*,\s*/, "").trim();
}

function stripEdgePunctuation(token) {
  return String(token || "")
    .replace(/^[,.!?;:¡¿"'«»]+/g, "")
    .replace(/[,.!?;:]+$/g, "")
    .toLowerCase();
}

/**
 * Light slang / chat normalizations before domain matching.
 */
function applySlangNormalize(text) {
  let s = String(text || "").trim();
  s = s.replace(/\bptr\b/gi, "pentru");
  s = s.replace(/\bpt\b(?=\s)/gi, "pentru ");
  s = s.replace(/\bcalumea\b/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Strip leading greetings, fillers, and punctuation-only prefixes. Repeat until stable.
 * @param {string} normalizedMessage lowercased, trimmed message
 * @returns {{ text: string, strippedGreeting: boolean }}
 */
function stripGreetingAndFillers(normalizedMessage) {
  let s = collapseRepeatedCommas(String(normalizedMessage || "").trim());
  let strippedGreeting = false;
  let guard = 0;

  while (guard++ < 20 && s.length > 0) {
    let changed = false;
    while (/^[,!.?;:]+/.test(s)) {
      s = s.replace(/^[,!.?;:]+\s*/, "").trim();
      strippedGreeting = true;
      changed = true;
    }

    const tokens = s.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) break;

    const first = stripEdgePunctuation(tokens[0]);
    const firstTwo =
      tokens.length >= 2
        ? `${stripEdgePunctuation(tokens[0])} ${stripEdgePunctuation(tokens[1])}`
        : null;

    if (LEADING_GREETING_OR_FILLER.has(first)) {
      tokens.shift();
      s = tokens.join(" ").trim();
      strippedGreeting = true;
      changed = true;
    } else if (firstTwo && LEADING_GREETING_OR_FILLER.has(firstTwo)) {
      tokens.shift();
      tokens.shift();
      s = tokens.join(" ").trim();
      strippedGreeting = true;
      changed = true;
    }

    if (!changed) break;
  }

  return { text: s, strippedGreeting };
}

module.exports = {
  stripGreetingAndFillers,
  applySlangNormalize,
  collapseRepeatedCommas
};
