jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/logger", () => {
  const actual = jest.requireActual("../services/logger");
  return {
    ...actual,
    logInfo: jest.fn((...args) => actual.logInfo(...args))
  };
});

const logger = require("../services/logger");
const { askLLM } = require("../services/llm");
const { executeFlow } = require("../services/flowExecutor");
const { handleChat, CHAT_PIPELINE_STAGE_ORDER } = require("../services/chatService");

function pipelineStagesFromCalls(logInfoMock) {
  return logInfoMock.mock.calls
    .filter((c) => c[0] === "CHAT_PIPELINE_STAGE")
    .map((c) => c[1].pipelineStage);
}

function expectOrder(stages, a, b) {
  const ia = stages.indexOf(a);
  const ib = stages.indexOf(b);
  expect(ia).toBeGreaterThanOrEqual(0);
  expect(ib).toBeGreaterThanOrEqual(0);
  expect(ia).toBeLessThan(ib);
}

describe("P0.4 canonical chat pipeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("LLM.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [{ id: 1, name: "T", tags: [] }]
    }));
  });

  it("exports ordered stage list with entry_guard before safety_gate", () => {
    expect(Object.isFrozen(CHAT_PIPELINE_STAGE_ORDER)).toBe(true);
    expect(CHAT_PIPELINE_STAGE_ORDER.indexOf("safety_gate")).toBeGreaterThan(
      CHAT_PIPELINE_STAGE_ORDER.indexOf("entry_guard")
    );
    expect(CHAT_PIPELINE_STAGE_ORDER.indexOf("finalize_logging")).toBeGreaterThan(
      CHAT_PIPELINE_STAGE_ORDER.indexOf("execution")
    );
  });

  it("runs entry_guard before finalize on greeting early exit (no safety_gate)", async () => {
    const sessionId = `pipe-greet-${Date.now()}`;
    await handleChat("salut", "C1", [], sessionId);
    const stages = pipelineStagesFromCalls(logger.logInfo);
    expectOrder(stages, "validate_input", "entry_guard");
    expectOrder(stages, "entry_guard", "finalize_logging");
    expect(stages).not.toContain("safety_gate");
  });

  it("runs safety_gate after entry_guard for compatibility safety", async () => {
    const sessionId = `pipe-safe-${Date.now()}`;
    await handleChat("pot folosi apc pe piele?", "C1", [], sessionId);
    const stages = pipelineStagesFromCalls(logger.logInfo);
    expectOrder(stages, "entry_guard", "safety_gate");
    expectOrder(stages, "safety_gate", "finalize_logging");
  });

  it("runs low_signal_gate after entry_guard on low-signal early exit", async () => {
    const sessionId = `pipe-low-${Date.now()}`;
    await handleChat("test", "C1", [], sessionId);
    const stages = pipelineStagesFromCalls(logger.logInfo);
    expectOrder(stages, "entry_guard", "low_signal_gate");
    expectOrder(stages, "low_signal_gate", "finalize_logging");
  });
});
