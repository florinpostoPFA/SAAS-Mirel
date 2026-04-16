function isSafetyQuestion(message) {
  const text = String(message || "").toLowerCase();
  const keywords = [
    "pot folosi",
    "pot sa",
    "este sigur",
    "e sigur",
    "merge pe",
    "compatibil",
    "ok pentru",
    "functioneaza pe"
  ];
  return keywords.some(k => text.includes(k));
}

function isFollowUpAnswer(message) {
  const msg = String(message || "").toLowerCase().trim();
  return ["piele", "textil", "alcantara"].includes(msg);
}

function normalizeDecision(message, intentResult, sessionContext, tags) {
  const safeSessionContext = sessionContext && typeof sessionContext === "object"
    ? sessionContext
    : {};

  let intent = typeof intentResult === "string"
    ? intentResult
    : intentResult?.type;

  const isSafety = isSafetyQuestion(message);
  const isFollowUp = isFollowUpAnswer(message);

  const SLOT_STATES = ["NEEDS_CONTEXT", "NEEDS_OBJECT", "NEEDS_SURFACE", "NEEDS_MATERIAL"];

  if (SLOT_STATES.includes(safeSessionContext.state)) {
    if (safeSessionContext.intent) {
      intent = safeSessionContext.intent;
    }
  }

  if (isSafety) {
    intent = "product_guidance";
  }

  return {
    intent,
    isSafety,
    isFollowUp,
    state: safeSessionContext.state,
    context: safeSessionContext.context,
    tags,
    originalIntent: safeSessionContext.intent
  };
}

module.exports = { normalizeDecision };
