function detectFlow(message, tags) {
  const text = String(message || "").toLowerCase();
  const normalizedTags = Array.isArray(tags)
    ? tags.map(tag => String(tag).toLowerCase())
    : [];

  const productQuerySignals = ["ce produs", "recomanda", "cat costa"];
  if (productQuerySignals.some(signal => text.includes(signal))) {
    return null;
  }

  const guidanceSignals = ["cum", "spal", "spalare", "ghid", "pasii"];
  const hasGuidanceSignal = guidanceSignals.some(signal => text.includes(signal));
  if (!hasGuidanceSignal) {
    return null;
  }

  const hasExterior = normalizedTags.includes("exterior");
  const hasCleaning = normalizedTags.includes("cleaning");

  if (hasExterior && hasCleaning) {
    return "exterior_wash_beginner";
  }

  return null;
}

module.exports = { detectFlow };
