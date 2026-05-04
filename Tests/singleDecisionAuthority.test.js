jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

const { appendInteractionLine } = require("../services/interactionLog");
const chatService = require("../services/chatService");

describe("single decision authority (resolveActionFinal)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not mutate clarification decision fields after resolveActionFinal returns (regression: post-resolve reassignment)", () => {
    const resolveActionFinal = chatService.__test?.resolveActionFinal;
    expect(typeof resolveActionFinal).toBe("function");

    const routingDecision = { action: "procedural", reason: "test" };
    const slots = { context: "interior", object: "scaune", surface: null };
    const base = resolveActionFinal({
      problemType: null,
      message: { text: "test", routingDecision },
      slots,
      routingContext: {
        previousState: "NEEDS_SURFACE",
        slotResultMissing: "surface",
        completedSlotFollowUp: false,
        userMessage: "followup",
        selectionEscalation: false
      }
    });

    const before = {
      action: base.action,
      flowId: base.flowId,
      missingSlot: base.missingSlot
    };

    expect(() => {
      base.action = "flow";
      base.flowId = "fake_flow";
      base.missingSlot = "object";
    }).not.toThrow();

    expect(before).toEqual({
      action: "clarification",
      flowId: null,
      missingSlot: "surface"
    });
  });

  it("flow decision comes from a single resolveAction object reference (no downstream field patches)", async () => {
    const sessionId = `sda-flow-${Date.now()}`;
    const { handleChat } = chatService;
    const result = await handleChat(
      "cum curat insectele de pe parbriz",
      "C1",
      [],
      sessionId
    );
    expect(result.type).toBe("flow");

    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.action).toBe("flow");
    expect(last.decision.flowId).toBe("bug_removal_quick");
    expect(last.decision.missingSlot).toBeNull();
  });

  it("clarification path preserves authority fields from resolveAction in the interaction log", async () => {
    const sessionId = `sda-clar-${Date.now()}`;
    const { handleChat } = chatService;
    await handleChat("vreau produse", "C1", [], sessionId);

    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.action).toBe("clarification");
    expect(["context", "object", "surface", "intent_level"]).toContain(last.decision.missingSlot);
    expect(last.output.type).toBe("question");
  });
});
