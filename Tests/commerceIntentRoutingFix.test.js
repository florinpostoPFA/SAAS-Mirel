jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { handleChat, __test: t } = require("../services/chatService");
const { appendInteractionLine } = require("../services/interactionLog");

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

describe("Commerce Intent Routing Fix (P1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("detects required Romanian commerce phrases deterministically", () => {
    const phrases = [
      "recomanda-mi ceva pentru geamuri",
      "ce folosesc pentru jante",
      "ce iau pentru interior textil",
      "de care sa aleg pentru piele",
      "trimite link pentru un cleaner de bord"
    ];
    for (const msg of phrases) {
      expect(t.hasExplicitSelectionIntent(msg)).toBe(true);
    }
  });

  it("routes commerce query to recommend-first or one targeted clarification", async () => {
    const sessionId = `p1-commerce-${Date.now()}`;
    const response = await handleChat("ce folosesc pentru jante", "C1", [], sessionId);
    const log = lastLog();
    const action = log?.decision?.action || response?.decisionTrace?.action;
    const missingSlot = log?.decision?.missingSlot || response?.decisionTrace?.missingSlot;
    expect(["recommend", "clarification"]).toContain(action);
    if (action === "clarification") {
      expect(["context", "object", "surface"]).toContain(missingSlot);
    }
  });
});
