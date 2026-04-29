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

function lastLogEntry() {
  const calls = appendInteractionLine.mock.calls;
  return calls[calls.length - 1][0];
}

describe("Recommend decision consistency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Raspuns scurt.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow ${flow.flowId}`,
      products: [{ id: 1, name: "Produs test", tags: ["interior"] }]
    }));
  });

  it("does not downgrade recommend journey to intent_level clarification", async () => {
    const sessionId = `rec-consistency-${Date.now()}`;

    await handleChat("vreau o recomandare de produs", "C1", [], sessionId);
    await handleChat("interior", "C1", [], sessionId);
    await handleChat("bord de plastic", "C1", [], sessionId);

    const log = lastLogEntry();

    expect(log.decision.missingSlot).not.toBe("intent_level");
    if (log.decision.action === "clarification") {
      expect(["context", "object", "surface"]).toContain(log.decision.missingSlot);
    } else {
      expect(["recommend", "selection", "knowledge"]).toContain(log.decision.action);
    }
  });

  it("keeps selection continuation on coverage goal reply (curatare) without low-signal menu", async () => {
    const sessionId = `rec-goal-cont-${Date.now()}`;

    await handleChat("vreau o recomandare de produs", "C1", [], sessionId);
    await handleChat("interior", "C1", [], sessionId);
    const turn3 = await handleChat("scaun de textil", "C1", [], sessionId);
    const turn3Text = String(turn3.reply || turn3.message || "").toLowerCase();
    const log3 = lastLogEntry();

    expect(turn3Text).toMatch(/cureti|protejezi|hidratezi/);
    expect(log3.decision.missingSlot).not.toBe("intent_level");

    const turn4 = await handleChat("curatare", "C1", [], sessionId);
    const turn4Text = String(turn4.reply || turn4.message || "").toLowerCase();
    const log4 = lastLogEntry();

    expect(log4.decision.missingSlot).not.toBe("intent_level");
    expect(Boolean(log4.lowSignalDetected)).toBe(false);
    expect(log4.slots.context).toBe("interior");
    expect(log4.slots.object).toBe("scaun");
    expect(log4.slots.surface).toBe("textile");
    expect(turn4Text).not.toMatch(/interior\s+sau\s+exterior|e\s+pentru\s+interior\s+sau\s+exterior/);
  });
});
