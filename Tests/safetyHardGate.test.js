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
const { handleChat } = require("../services/chatService");
const { runSafetyGate, resolveSafetyTrustContext } = require("../services/safetyQueryService");

describe("P0.2 Safety hard gate (compatibility)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("LLM.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [{ id: 1, name: "T", tags: [] }]
    }));
  });

  it("runSafetyGate matches resolveSafetyTrustContext for a complete safety phrase", () => {
    const routingMessage = "pot folosi apc pe piele?";
    const sessionContext = {};
    const gate = runSafetyGate({ routingMessage, sessionContext });
    const ctx = resolveSafetyTrustContext(routingMessage, sessionContext);
    expect(gate.triggered).toBe(true);
    expect(gate.reasonCode).toBe(ctx.analysis.reason);
    expect(gate.analysis).toEqual(ctx.analysis);
  });

  it("does not trigger runSafetyGate for empty / non-safety phrasing", () => {
    expect(runSafetyGate({ routingMessage: "", sessionContext: {} }).triggered).toBe(false);
    expect(runSafetyGate({ routingMessage: "cod reducere", sessionContext: {} }).triggered).toBe(
      false
    );
  });

  it("exits before low-signal intent_level when message is a compatibility safety query", async () => {
    const sessionId = `hard-gate-low-${Date.now()}`;
    const result = await handleChat("pot folosi apc pe piele?", "C1", [], sessionId);

    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.action).toBe("safety");
    expect(last.intent.queryType).toBe("safety");
    expect(last.slots).toEqual({});
    expect(executeFlow).not.toHaveBeenCalled();
    const reply = String(result.reply || result.message || "");
    expect(reply.length).toBeGreaterThan(10);
  });

  it("after safety hard exit, flow executor is not invoked for APC on leather", async () => {
    const sessionId = `hard-gate-flow-${Date.now()}`;
    await handleChat("pot folosi apc pe piele naturala diluat?", "C1", [], sessionId);
    expect(executeFlow).not.toHaveBeenCalled();
    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.action).toBe("safety");
    expect(last.blockedProductRouting).toBe(true);
  });
});
