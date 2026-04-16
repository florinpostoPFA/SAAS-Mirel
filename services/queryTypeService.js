function normalizeMessage(message) {
  return String(message || "").toLowerCase().trim();
}

function includesAny(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function detectQueryType(message) {
  const msg = normalizeMessage(message);
  const informationalPhrases = ["ce este", "ce inseamna", "ce face", "la ce foloseste", "pentru ce este"];

  if (
    msg.includes("recomanda") ||
    msg.includes("ce produs") ||
    msg.includes("care e mai bun") ||
    (msg.includes("folosesc") && (msg.includes("ce") || msg.includes("ceva")))
  ) {
    return "selection";
  }

  if (includesAny(msg, informationalPhrases) || includesAny(msg, ["definitie"])) {
    return "informational";
  }

  if (includesAny(msg, ["cum", "cum spal", "cum curat"])) {
    return "procedural";
  }

  return "procedural";
}

module.exports = { detectQueryType };