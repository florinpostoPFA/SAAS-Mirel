function toShortSnippet(text) {
  const content = String(text || "").trim();
  if (!content) return "";

  // Keep at most the first 2 sentences.
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (sentences.length === 0) return "";
  return sentences.slice(0, 2).join(" ");
}

function getKnowledgeSnippets(knowledgeIds, knowledgeBase) {
  const ids = Array.isArray(knowledgeIds) ? knowledgeIds : [];
  const base = Array.isArray(knowledgeBase) ? knowledgeBase : [];
  const snippets = [];

  for (const id of ids) {
    const item = base.find(entry => String(entry.id) === String(id));
    if (!item) continue;

    const snippet = toShortSnippet(item.content);
    if (snippet) {
      snippets.push(snippet);
    }
  }

  return snippets;
}

module.exports = { getKnowledgeSnippets };
