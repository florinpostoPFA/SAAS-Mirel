jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { executeFlow } = require("../services/flowExecutor");
const { appendInteractionLine } = require("../services/interactionLog");
const { extractSlotsFromMessage, handleChat } = require("../services/chatService");

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

describe("paint surface deterministic inference", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow ${flow.flowId}`,
      products: [{ id: "p1", name: "Produs test", tags: ["paint", "cleaner", "exterior"] }]
    }));
  });

  it("extracts paint surface from Romanian paint mention in first turn", () => {
    const slots = extractSlotsFromMessage("cum intretin vopseaua masinii de la exterior intre spalari?");
    expect(slots.surface).toBe("paint");
    expect(slots.object).toBe("caroserie");
    expect(slots.context).toBe("exterior");
  });

  it("does not ask missing surface for the exact paint phrase", async () => {
    const sessionId = `slot-paint-first-turn-${Date.now()}`;
    await handleChat("cum intretin vopseaua masinii de la exterior intre spalari?", "C1", [], sessionId);
    const log = lastLog();

    expect(log?.slots?.surface).toBe("paint");
    expect(log?.decision?.missingSlot).not.toBe("surface");
  });
});
