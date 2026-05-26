const { __test } = require("../services/chatService");
const { isEchoOfLastBotReply, normalizeForEchoCompare } = __test;
const { handleChat } = require("../services/chatService");
const { loadSession, resetAllSessions, persistSession } = require("../services/sessionLifecycle");

describe("bot-echo loop detection", () => {
  beforeEach(() => {
    resetAllSessions();
  });

  test("normalizeForEchoCompare strips punctuation and collapses whitespace", () => {
    expect(normalizeForEchoCompare("Salut! Spune-mi...  cu ce?")).toBe("salut spunemi cu ce");
  });

  test("exact echo of lastBotReply → true", () => {
    const ctx = { lastBotReply: "Salut! Spune-mi cu ce te pot ajuta." };
    expect(isEchoOfLastBotReply("Salut! Spune-mi cu ce te pot ajuta.", ctx)).toBe(true);
  });

  test("near-echo (whitespace/case/punctuation diff) → true", () => {
    const ctx = { lastBotReply: "Salut! Spune-mi cu ce te pot ajuta." };
    expect(isEchoOfLastBotReply("salut  spune-mi cu ce te pot ajuta", ctx)).toBe(true);
  });

  test("short message (< 10 chars normalized) → false (not an echo)", () => {
    const ctx = { lastBotReply: "Da." };
    expect(isEchoOfLastBotReply("Da.", ctx)).toBe(false);
  });

  test("genuinely different message sharing a few words → false", () => {
    const ctx = { lastBotReply: "Salut! Spune-mi cu ce te pot ajuta cu detailing-ul auto." };
    expect(isEchoOfLastBotReply("Salut, am nevoie de un polish", ctx)).toBe(false);
  });

  test("no lastBotReply in context → false", () => {
    expect(isEchoOfLastBotReply("anything", {})).toBe(false);
    expect(isEchoOfLastBotReply("anything", null)).toBe(false);
  });

  test("integration: echo of bot reply returns recovery message", async () => {
    const sessionId = `echo-detect-${Date.now()}`;
    const session = loadSession(sessionId);
    session.lastBotReply = "Salut! Spune-mi cu ce te pot ajuta cu detailing-ul auto.";
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = false;
    persistSession(sessionId, session);

    const products = [
      { id: "p1", name: "Koch FSE", tags: ["polish"], description: "polish" }
    ];

    const result = await handleChat(
      "Salut! Spune-mi cu ce te pot ajuta cu detailing-ul auto.",
      "C1", products, sessionId
    );
    expect(result.echoDetected).toBe(true);
    expect(result.reply).toMatch(/cuvintele tale/i);
  });

  test("integration: genuinely new message after bot reply routes normally", async () => {
    const sessionId = `echo-normal-${Date.now()}`;
    const session = loadSession(sessionId);
    session.lastBotReply = "Salut! Spune-mi cu ce te pot ajuta cu detailing-ul auto.";
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = false;
    persistSession(sessionId, session);

    const products = [
      { id: "p1", name: "Koch FSE", tags: ["polish"], description: "polish" }
    ];

    const result = await handleChat("am nevoie de un polish", "C1", products, sessionId);
    expect(result.echoDetected).toBeUndefined();
  });
});
