const { detectExplicitContext, isExplicitMultiContext } = require("../services/contextInferenceService");
const { loadSession, resetAllSessions, persistSession } = require("../services/sessionLifecycle");
const { handleChat } = require("../services/chatService");

describe("multi-context explicit handling", () => {
  beforeEach(() => {
    resetAllSessions();
  });

  test("'si interior si exterior' is flagged as multi-context", () => {
    expect(isExplicitMultiContext("si interior si exterior")).toBe(true);
    expect(detectExplicitContext("si interior si exterior")).toBeNull();
  });

  test("'atat interior cat si exterior' is flagged as multi-context", () => {
    expect(isExplicitMultiContext("atat interior cat si exterior")).toBe(true);
    expect(detectExplicitContext("atat interior cat si exterior")).toBeNull();
  });

  test("'ambele' is flagged as multi-context", () => {
    expect(isExplicitMultiContext("ambele")).toBe(true);
    expect(detectExplicitContext("ambele")).toBeNull();
  });

  test("'both' is flagged as multi-context", () => {
    expect(isExplicitMultiContext("both")).toBe(true);
    expect(detectExplicitContext("both")).toBeNull();
  });

  test("'interior si exterior' is flagged as multi-context", () => {
    expect(isExplicitMultiContext("interior si exterior")).toBe(true);
    expect(detectExplicitContext("interior si exterior")).toBeNull();
  });

  test("REGRESSION: 'interior' alone → context=interior", () => {
    expect(detectExplicitContext("interior")).toBe("interior");
  });

  test("REGRESSION: 'exterior' alone → context=exterior", () => {
    expect(detectExplicitContext("exterior")).toBe("exterior");
  });

  test("integration: 'si interior si exterior' asks one-at-a-time clarification", async () => {
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
    expect(reply).toMatch(/interior sau exterior/i);
    expect(reply).toMatch(/luam pe rand|rand/i);
    const s = loadSession(sessionId);
    expect(s.slots.context).not.toBe("both");
    expect(s.pendingQuestion?.slot).toBe("context");
    expect(s.pendingQuestion?.source).toBe("multi_context_sequential");
  });
});
