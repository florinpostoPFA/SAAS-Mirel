jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { executeFlow } = require("../services/flowExecutor");
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat, __test } = require("../services/chatService");

describe("P0.3 runEntryGuard (unit)", () => {
  const base = (over = {}) => ({
    userMessage: "salut",
    routingMessage: "salut",
    intentCore: "salut",
    sessionContext: {},
    sessionId: `eg-unit-${Date.now()}`,
    ...over
  });

  it("returns none for a normal cleaning-style message", () => {
    const r = __test.runEntryGuard(
      base({
        userMessage: "vreau sa curat interiorul",
        routingMessage: "vreau sa curat interiorul",
        intentCore: "vreau sa curat interiorul"
      })
    );
    expect(r.handled).toBe(false);
    expect(r.reasonCode).toBe("none");
  });

  it("handles non-cleaning greeting before downstream routing", () => {
    const r = __test.runEntryGuard(base());
    expect(r.handled).toBe(true);
    expect(r.reasonCode).toBe("non_cleaning_domain");
    expect(r.patch.decision.action).toBe("knowledge");
  });

  it("handles profanity as abuse", () => {
    const r = __test.runEntryGuard(
      base({
        userMessage: "muie",
        routingMessage: "muie",
        intentCore: "muie"
      })
    );
    expect(r.handled).toBe(true);
    expect(r.reasonCode).toBe("abuse");
    expect(r.patch.decision.action).toBe("safety");
  });

  it("handles empty user text", () => {
    const r = __test.runEntryGuard(
      base({
        userMessage: "   ",
        routingMessage: "",
        intentCore: ""
      })
    );
    expect(r.handled).toBe(true);
    expect(r.reasonCode).toBe("empty_message");
  });

  it("handles duplicate message when session repeats last user line", () => {
    const r = __test.runEntryGuard(
      base({
        userMessage: "acelasi",
        routingMessage: "acelasi",
        intentCore: "acelasi",
        sessionContext: { lastUserMessage: "acelasi" }
      })
    );
    expect(r.handled).toBe(true);
    expect(r.reasonCode).toBe("duplicate_user_message");
  });
});

describe("P0.3 entry guard integration (handleChat)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("LLM.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [{ id: 1, name: "T", tags: [] }]
    }));
  });

  it("exits on greeting without invoking flow executor or slot flows", async () => {
    const sessionId = `eg-int-${Date.now()}`;
    await handleChat("salut", "C1", [], sessionId);
    expect(executeFlow).not.toHaveBeenCalled();
    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.action).toBe("knowledge");
  });

  it("still reaches compatibility safety after entry guard (not abuse/non-cleaning)", async () => {
    const sessionId = `eg-safety-${Date.now()}`;
    await handleChat("pot folosi apc pe piele?", "C1", [], sessionId);
    expect(executeFlow).not.toHaveBeenCalled();
    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.action).toBe("safety");
  });

  it("handles disable recommendations in entry guard", async () => {
    const sessionId = `eg-dis-${Date.now()}`;
    await handleChat("nu vreau recomandari", "C1", [], sessionId);
    expect(executeFlow).not.toHaveBeenCalled();
    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.action).toBe("no_recommendations");
  });
});
