function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[!?.,:;()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(token) {
  return String(token || "")
    .replace(/ului$/, "")
    .replace(/ul$/, "")
    .replace(/a$/, "");
}

function findRelevantKnowledge(userMessage, knowledgeList) {
  const message = normalizeText(userMessage);
  const safeKnowledgeList = Array.isArray(knowledgeList) ? knowledgeList : [];
  const isDefinitionQuery =
    message.includes("ce este") ||
    message.includes("ce inseamna") ||
    message.includes("ce face");

  if (!message) {
    return [];
  }

  const STOP_WORDS = ["ce", "este", "inseamna", "la", "cu", "pentru", "si", "de", "auto", "masina", "masinii", "vehicul", "face", "foloseste", "folosi", "fac"];
  const words = message.split(/\s+/).filter(Boolean);
  const filteredWords = words
    .map(normalizeToken)
    .filter(w => w.length > 2 && !STOP_WORDS.includes(w));

  if (filteredWords.length === 0) {
    return [];
  }

  console.log("QUERY:", userMessage);
  console.log("FILTERED TOKENS:", filteredWords);

  const scored = safeKnowledgeList.map(entry => {
    const searchText = normalizeText(entry?.searchText);
    const tagTokens = Array.isArray(entry?.tags)
      ? entry.tags.map(tag => normalizeText(tag))
      : [];

    let score = 0;
    let matchedTokens = [];

    for (const word of filteredWords) {
      if (tagTokens.includes(word)) {
        score += 3;
        matchedTokens.push(word);
      } else if (searchText.includes(word)) {
        score += 2;
        matchedTokens.push(word);
      } else if (tagTokens.some(tag => tag.includes(word))) {
        score += 1;
      }
    }

    if (isDefinitionQuery && matchedTokens.length > 0) {
      const entryId = String(entry?.id || "");
      if (
        entryId.includes("definition") ||
        entryId.includes("importance") ||
        entryId.includes("rol")
      ) {
        score += 2;
      }
    }

    return { entry, score, matchedTokens };
  })
  .filter(e => e.score >= 2 && e.matchedTokens.length > 0)
  .sort((a, b) => b.score - a.score);

  console.log("TOP MATCHES:");
  scored.slice(0, 3).forEach(r => {
    console.log({
      id: r.entry.id,
      score: r.score,
      tokens: r.matchedTokens
    });
  });

  return scored.map(e => e.entry).slice(0, 3);
}

module.exports = { findRelevantKnowledge };