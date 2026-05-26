const { detectExplicitContext, inferContext } = require("../services/contextInferenceService");
const { loadSession, resetAllSessions, persistSession } = require("../services/sessionLifecycle");
const { handleChat } = require("../services/chatService");

describe("multi-context both-affirmative detection", () => {
  beforeEach(() => {
    resetAllSessions();
  });

  test("'si interior si exterior' → context=both", () => {
    expect(detectExplicitContext("si interior si exterior")).toBe("both");
  });

  test("'atat interior cat si exterior' → context=both", () => {
    expect(detectExplicitContext("atat interior cat si exterior")).toBe("both");
  });

  test("'ambele' → context=both", () => {
    expect(detectExplicitContext("ambele")).toBe("both");
  });

  test("'both' → context=both", () => {
    expect(detectExplicitContext("both")).toBe("both");
  });

  test("'interior si exterior' → context=both", () => {
    expect(detectExplicitContext("interior si exterior")).toBe("both");
  });

  test("REGRESSION: 'interior' alone → context=interior", () => {
    expect(detectExplicitContext("interior")).toBe("interior");
  });

  test("REGRESSION: 'exterior' alone → context=exterior", () => {
    expect(detectExplicitContext("exterior")).toBe("exterior");
  });

  test("integration: 'si interior si exterior' does not re-ask context", async () => {
    const sessionId = `multi-ctx-${Date.now()}`;
    const session = loadSession(sessionId);
    session.slots = {};
    session.slotMeta = {};
    session.state = "NEEDS_CONTEXT";
    session.pendingQuestion = { slot: "context", active: true };
    session.pendingSelection = false;
    persistSession(sessionId, session);

    const products = [
      { id: "APC1", name: "Koch Chemie MZR APC", tags: ["cleaner", "interior", "exterior"], description: "all purpose cleaner" }
    ];

    const result = await handleChat("si interior si exterior", "C1", products, sessionId);
    const reply = String(result.reply || result.message || "");
    expect(reply).not.toMatch(/interior sau exterior/i);
    const s = loadSession(sessionId);
    expect(s.slots.context).toBe("both");
  });
});
