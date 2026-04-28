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
const { getSession } = require("../services/sessionStore");
const { handleChat } = require("../services/chatService");

describe("Session slot isolation (cross-intent)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Răspuns scurt.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [{ id: 1, name: "Test", tags: ["exterior"] }]
    }));
  });

  it("clears prior intent slots when a new informational turn has no continuation context", async () => {
    const sessionId = `slot-iso-${Date.now()}`;

    await handleChat(
      "vreau sa curat jantele la exterior",
      "C1",
      [],
      sessionId
    );
    const mid = getSession(sessionId);
    expect(mid.slots && mid.slots.context).toBeTruthy();
    expect(mid.slots && mid.slots.object).toBeTruthy();

    await handleChat("ce este apc?", "C1", [], sessionId);
    const after = getSession(sessionId);

    expect(after.slots?.context ?? null).toBeNull();
    expect(after.slots?.object ?? null).toBeNull();
    expect(after.slots?.surface ?? null).toBeNull();
  });

  it("still carries slots when answering a pending clarification (continuation)", async () => {
    const sessionId = `slot-cont-${Date.now()}`;

    await handleChat("vreau polish", "C1", [], sessionId);
    const s1 = getSession(sessionId);
    expect(s1.pendingQuestion || s1.state !== "IDLE").toBeTruthy();

    await handleChat("exterior", "C1", [], sessionId);
    const s2 = getSession(sessionId);
    expect(s2.slots?.context === "exterior" || s2.pendingQuestion).toBeTruthy();
  });

  it("serializes concurrent handleChat calls for the same session (no overlapping LLM)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    askLLM.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      inFlight -= 1;
      return "ok";
    });
    const sessionId = `conc-${Date.now()}`;
    await Promise.all([
      handleChat("ce este apc?", "C1", [], sessionId),
      handleChat("ce este wax?", "C1", [], sessionId)
    ]);
    expect(maxInFlight).toBe(1);
  });
});
