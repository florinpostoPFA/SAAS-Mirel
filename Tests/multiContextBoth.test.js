jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Recomandare determinista.")
}));

const {
  detectExplicitContext,
  isExplicitMultiContext,
  extractContextEntries,
  hasAmbiguousBothReply
} = require("../services/contextInferenceService");
const { loadSession, resetAllSessions, persistSession } = require("../services/sessionLifecycle");
const { handleChat } = require("../services/chatService");

describe("multi-context conversational sequential handling", () => {
  beforeEach(() => {
    resetAllSessions();
  });

  test("'si interior si exterior' is explicit multi-context (no context=both)", () => {
    expect(isExplicitMultiContext("si interior si exterior")).toBe(true);
    expect(detectExplicitContext("si interior si exterior")).toBeNull();
  });

  test("'atat interior cat si exterior' is explicit multi-context", () => {
    expect(isExplicitMultiContext("atat interior cat si exterior")).toBe(true);
    expect(detectExplicitContext("atat interior cat si exterior")).toBeNull();
  });

  test("'ambele' remains ambiguous-both reply", () => {
    expect(hasAmbiguousBothReply("ambele")).toBe(true);
    expect(isExplicitMultiContext("ambele")).toBe(false);
    expect(detectExplicitContext("ambele")).toBeNull();
  });

  test("ContextEntry extraction uses typed shape", () => {
    const out = extractContextEntries("Am piele perforata in interior si ceramic pe exterior, cu ce curat tot?");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(
      expect.objectContaining({
        context: "interior",
        surface: expect.any(String),
        treatment: expect.any(String),
        source: "user_input"
      })
    );
    expect(out[1]).toEqual(
      expect.objectContaining({
        context: "exterior",
        surface: expect.any(String),
        treatment: "ceramic",
        source: "user_input"
      })
    );
  });

  test("single-context is unchanged", () => {
    expect(detectExplicitContext("interior")).toBe("interior");
    expect(detectExplicitContext("exterior")).toBe("exterior");
  });

  test("ambiguous 'ambele' on pending context asks targeted re-prompt", async () => {
    const sessionId = `multi-ctx-reprompt-${Date.now()}`;
    const session = loadSession(sessionId);
    session.pendingQuestion = { slot: "context", active: true };
    persistSession(sessionId, session);

    const result = await handleChat("ambele", "C1", [], sessionId);
    const reply = String(result.reply || result.message || "");
    expect(reply).toMatch(/Pentru care din cele doua/i);
  });

  test("explicit multi-context turn keeps queue and appends continuation prompt", async () => {
    const sessionId = `multi-ctx-${Date.now()}`;
    const products = [
      { id: "LEATHER1", name: "Leather cleaner interior", tags: ["cleaner", "interior", "leather"] },
      { id: "EXTCER1", name: "Exterior ceramic safe cleaner", tags: ["cleaner", "exterior", "paint", "ceramic"] }
    ];

    const result = await handleChat(
      "Am piele perforata in interior si ceramic pe exterior, cu ce curat tot?",
      "C1",
      products,
      sessionId
    );
    const reply = String(result.reply || result.message || "");
    expect(reply.length).toBeGreaterThan(0);

    const s = loadSession(sessionId);
    expect(Array.isArray(s.pendingContexts)).toBe(true);
    expect(s.pendingContexts.length).toBeGreaterThan(0);
    expect(s.pendingContexts[0]).toEqual(
      expect.objectContaining({ context: "exterior", source: "user_input" })
    );
    expect(s.slots.context).not.toBe("both");
  });

  test("yes resumes queued context, no clears queue", async () => {
    const sessionId = `multi-ctx-yesno-${Date.now()}`;
    const session = loadSession(sessionId);
    session.pendingContexts = [
      { context: "exterior", surface: "paint", treatment: "ceramic", source: "user_input" }
    ];
    persistSession(sessionId, session);
    const products = [{ id: "EXTCER1", name: "Exterior ceramic safe cleaner", tags: ["cleaner", "exterior"] }];

    await handleChat("da", "C1", products, sessionId);
    let s = loadSession(sessionId);
    expect(s.pendingContexts).toHaveLength(0);

    s.pendingContexts = [{ context: "exterior", surface: "paint", treatment: "ceramic", source: "user_input" }];
    persistSession(sessionId, s);
    await handleChat("nu, multumesc", "C1", products, sessionId);
    s = loadSession(sessionId);
    expect(s.pendingContexts).toHaveLength(0);
  });

  test("topic shift clears pendingContexts", async () => {
    const sessionId = `multi-ctx-shift-${Date.now()}`;
    const session = loadSession(sessionId);
    session.pendingContexts = [
      { context: "exterior", surface: "paint", treatment: "ceramic", source: "user_input" }
    ];
    persistSession(sessionId, session);
    await handleChat("ce este apc?", "C1", [], sessionId);
    const s = loadSession(sessionId);
    expect(s.pendingContexts).toHaveLength(0);
  });
});
