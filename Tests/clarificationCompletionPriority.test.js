jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { handleChat } = require("../services/chatService");
const { getSession, saveSession } = require("../services/sessionStore");
const { appendInteractionLine } = require("../services/interactionLog");

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

describe("Clarification Completion Priority (P0)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves pending surface before intent overrides in same turn", async () => {
    const sessionId = `p0-order-${Date.now()}`;
    const s = getSession(sessionId);
    s.slots = { context: "exterior", object: "caroserie", surface: null };
    s.pendingQuestion = { active: true, slot: "surface", context: "exterior", object: "caroserie" };
    s.previousAction = "knowledge";
    saveSession(sessionId, s);

    await handleChat("vopsea", "C1", [], sessionId);

    const after = getSession(sessionId);
    const log = lastLog();
    expect(after.slots.surface).toBe("paint");
    expect(after.pendingQuestion).toBeNull();
    expect(log?.decision?.missingSlot).not.toBe("surface");
    expect(log?.decision?.missingSlot).not.toBe("intent_level");
  });
});
