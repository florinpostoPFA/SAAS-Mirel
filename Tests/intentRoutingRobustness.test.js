jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { executeFlow } = require("../services/flowExecutor");
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");

function lastLog() {
  const c = appendInteractionLine.mock.calls;
  return c.length ? c[c.length - 1][0] : null;
}

describe("Intent routing robustness (Phase A)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Răspuns scurt.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [{ id: 1, name: "Test", tags: ["exterior"] }]
    }));
  });

  const productSearchCases = [
    ["Salut vreau si eu ceva cu ce sa curat jantele calumea", "greeting+jante"],
    ["Vreau prosop flash detail", "towel"],
    ["vreau spuma activa", "snow foam phrase"],
    ["vreau polish", "polish"],
    ["vreau taler ptr polishat", "slang ptr"],
    ["vreau carbuni pentru masina de polish", "pads"]
  ];

  it.each(productSearchCases)("product_search path: %s (%s)", async (msg) => {
    const sessionId = `ir-${Date.now()}-${Math.random()}`;
    await handleChat(msg, "C1", [], sessionId);
    const log = lastLog();
    expect(log).toBeTruthy();
    expect(log.intent.queryType).not.toBe("informational");
    expect(log.decision.action).not.toBe("knowledge");
  });

  it("product_guidance: cum curat jantele?", async () => {
    const sessionId = `ir-pg-${Date.now()}`;
    await handleChat("cum curat jantele?", "C1", [], sessionId);
    const log = lastLog();
    expect(log.intent.queryType).toBe("procedural");
    expect(log.decision.action).not.toBe("knowledge");
  });

  it("product_guidance: cum protejez pielea?", async () => {
    const sessionId = `ir-pg2-${Date.now()}`;
    await handleChat("cum protejez pielea?", "C1", [], sessionId);
    const log = lastLog();
    expect(log.intent.queryType).toBe("procedural");
  });

  it("greeting + protect leather stays out of pure knowledge", async () => {
    const sessionId = `ir-leather-${Date.now()}`;
    await handleChat("Salut! Vreau sa protejez pielea masinii", "C1", [], sessionId);
    const log = lastLog();
    expect(log.intent.queryType).not.toBe("informational");
  });

  it("knowledge: ce este apc?", async () => {
    const sessionId = `ir-k-${Date.now()}`;
    await handleChat("ce este apc?", "C1", [], sessionId);
    expect(askLLM).toHaveBeenCalled();
    const log = lastLog();
    expect(log.intent.queryType).toBe("informational");
  });

  it("knowledge: de ce am nevoie de extractor?", async () => {
    const sessionId = `ir-k2-${Date.now()}`;
    await handleChat("de ce am nevoie de extractor?", "C1", [], sessionId);
    const log = lastLog();
    expect(log.intent.queryType).toBe("informational");
    expect(log.decision.action).toBe("knowledge");
  });

  it("safety query is not replaced by product heuristic", async () => {
    const sessionId = `ir-s-${Date.now()}`;
    await handleChat("e sigur apc pe piele?", "C1", [], sessionId);
    const log = lastLog();
    expect(log.intent.queryType).toBe("safety");
  });

  it("low-signal still intent_level for vague input", async () => {
    const sessionId = `ir-ls-${Date.now()}`;
    await handleChat("test", "C1", [], sessionId);
    const log = lastLog();
    expect(log.decision.missingSlot).toBe("intent_level");
    expect(log.lowSignalDetected).toBe(true);
  });
});
