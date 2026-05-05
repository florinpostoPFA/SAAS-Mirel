"use strict";

const ENGLISH_WORDS_RE =
  /\b(the|and|for|with|your|you|please|what|which|best|recommend|clean|use|products?)\b/i;
const GENERIC_CLARIFICATION_RE =
  /\b(po[iț]i\s+(?:detalia|clarifica)|mai\s+multe\s+detalii|po[iț]i\s+s[ăa]\s+fii\s+mai\s+specific|te\s+rog\s+detalii)\b/i;
const GUIDED_HINT_RE =
  /\b(buget|suprafa(?:ta|ț[aă])|problem(?:a|ă)|obiect|interior|exterior|material|piele|textil|jante|geamuri|cantitate)\b/i;
const EXPLANATION_RE = /\b(pentru\s+c[ăa]|deoarece|fiindc[ăa]|motivul|astfel\s+incat)\b/i;

function normalizeQuestion(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasRepeatedQuestion(reply) {
  const rawQuestions = String(reply || "")
    .split("?")
    .map((s) => normalizeQuestion(s))
    .filter(Boolean);
  const seen = new Set();
  for (const q of rawQuestions) {
    if (seen.has(q)) return true;
    seen.add(q);
  }
  return false;
}

function evaluateUXExpectation(entry, expectSpec) {
  const failures = [];
  const assistantReply = entry && entry.assistantReply != null ? String(entry.assistantReply) : "";
  const replyTrimmed = assistantReply.trim();

  if (expectSpec.noEmptyReply && replyTrimmed.length === 0) {
    failures.push("assistantReply is empty");
  }

  if (expectSpec.noEnglish && ENGLISH_WORDS_RE.test(assistantReply)) {
    failures.push("assistantReply contains English words");
  }

  if (expectSpec.noGenericClarification && GENERIC_CLARIFICATION_RE.test(assistantReply) && !GUIDED_HINT_RE.test(assistantReply)) {
    failures.push("clarification is generic, not guided");
  }

  if (expectSpec.noRepeatedQuestion && hasRepeatedQuestion(assistantReply)) {
    failures.push("assistantReply repeats the same question");
  }

  if (expectSpec.requireSelectionExplanation) {
    const hasRecommendationSignal = /\b(recomand|alege|potrivit|ideal)\b/i.test(assistantReply);
    if (hasRecommendationSignal && !EXPLANATION_RE.test(assistantReply)) {
      failures.push("selection is missing explanation");
    }
  }

  return { pass: failures.length === 0, failures };
}

module.exports = {
  evaluateUXExpectation
};
