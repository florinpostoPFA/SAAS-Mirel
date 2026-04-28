jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/logger", () => ({
  logInfo: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { executeFlow } = require("../services/flowExecutor");
const { appendInteractionLine } = require("../services/interactionLog");
const { logInfo } = require("../services/logger");
const { handleChat } = require("../services/chatService");

function lastLogEntry() {
  const calls = appendInteractionLine.mock.calls;
  return calls[calls.length - 1][0];
}

describe("Regression: low-signal follow-up bypass must not yield null decision.action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Răspuns mock LLM.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: []
    }));
  });

  it("fresh session: 'ce imi recomanzi?' returns intent-level clarification, no bypass, no hard guard", async () => {
    const sessionId = `nullguard-fresh-${Date.now()}`;
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await handleChat("ce imi recomanzi?", "C1", [], sessionId);
    const log = lastLogEntry();

    expect(errSpy.mock.calls.some(c => c[0] === "HARD_GUARD_VIOLATION")).toBe(false);

    expect(log?.decision?.action).toBeTruthy();
    expect(log.decision.action).toBe("clarification");
    expect(log.decision.missingSlot).toBe("intent_level");
    expect(log.pendingQuestion).toBeTruthy();
    expect(log.pendingQuestion.slot).toBe("intent_level");

    expect(logInfo.mock.calls.some(c => c[0] === "LOW_SIGNAL_BYPASSED_FOLLOWUP")).toBe(false);
    expect(logInfo.mock.calls.some(c => c[0] === "LOW_SIGNAL_FOLLOWUP_BYPASS_BLOCKED")).toBe(true);

    const reply = String(res.reply || res.message || "");
    expect(reply.length).toBeGreaterThan(5);

    errSpy.mockRestore();
  });

  it("positive: recommendation follow-up with carryover bypasses low-signal and routes selection", async () => {
    const sessionId = `nullguard-positive-${Date.now()}`;
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const products = [
      {
        id: "td1",
        name: "Dressing Anvelope Black",
        description: "Finisaj satin pentru anvelope.",
        short_description: "Dressing anvelope.",
        tags: ["exterior", "wheels", "tire_dressing"]
      }
    ];

    await handleChat("ce produs sa folosesc pentru anvelope la exterior?", "C1", products, sessionId);
    jest.clearAllMocks();
    appendInteractionLine.mockClear();
    logInfo.mockClear();

    askLLM.mockResolvedValue("Recomand un dressing dedicat pentru anvelope.");

    await handleChat("ok, ce imi recomanzi pentru asta?", "C1", products, sessionId);
    const log2 = lastLogEntry();

    expect(errSpy.mock.calls.some(c => c[0] === "HARD_GUARD_VIOLATION")).toBe(false);
    expect(log2?.decision?.action).toBeTruthy();
    expect(log2.intent?.queryType).toBe("selection");
    expect(logInfo.mock.calls.some(c => c[0] === "LOW_SIGNAL_BYPASSED_FOLLOWUP")).toBe(true);

    errSpy.mockRestore();
  });
});

