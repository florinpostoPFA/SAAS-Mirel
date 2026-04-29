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

describe("Low-signal intent-level handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Răspuns explicativ scurt despre APC.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [{ id: 1, name: "Test produs", tags: ["interior"] }]
    }));
  });

  it("A: low-signal emits intent-level clarification (not context/object/surface slots)", async () => {
    const sessionId = `lowsig-a-${Date.now()}`;
    const res = await handleChat("test", "C1", [], sessionId);
    const reply = String(res.reply || res.message || "");
    const log = lastLogEntry();

    expect(reply.toLowerCase()).toMatch(/pa[sș]i/);
    expect(reply.toLowerCase()).toMatch(/recomandare|produse/);
    expect(log.decision.missingSlot).toBe("intent_level");
    expect(log.decision.missingSlot).not.toBe("context");
    expect(log.lowSignalDetected).toBe(true);
    expect(log.lowSignalQuestionType).toBe("intent_level");
  });

  it("A: recomanda ceva asks intent-level question", async () => {
    const sessionId = `lowsig-a2-${Date.now()}`;
    const res = await handleChat("recomanda ceva", "C1", [], sessionId);
    const reply = String(res.reply || res.message || "");
    const log = lastLogEntry();

    expect(reply.toLowerCase()).toMatch(/pa[sș]i/);
    expect(reply.toLowerCase()).toMatch(/recomandare|produse/);
    expect(log.decision.missingSlot).toBe("intent_level");
  });

  it("A3: explicit recommendation phrase avoids intent_level (vreau recomandare de produs)", async () => {
    const sessionId = `lowsig-a3-${Date.now()}`;
    await handleChat("vreau recomandare de produs", "C1", [], sessionId);
    const log = lastLogEntry();

    expect(log.decision.missingSlot).not.toBe("intent_level");
    if (log.decision.action === "clarification") {
      expect(["context", "object", "surface"]).toContain(log.decision.missingSlot);
    }
  });

  it("A4: explicit recommendation phrase avoids intent_level (recomandare de produse)", async () => {
    const sessionId = `lowsig-a4-${Date.now()}`;
    await handleChat("recomandare de produse", "C1", [], sessionId);
    const log = lastLogEntry();

    expect(log.decision.missingSlot).not.toBe("intent_level");
    if (log.decision.action === "clarification") {
      expect(["context", "object", "surface"]).toContain(log.decision.missingSlot);
    }
  });

  it("B: follow-up produse routes to selection (not intent_level / low-signal menu)", async () => {
    const sessionId = `lowsig-b-${Date.now()}`;
    await handleChat("recomanda ceva", "C1", [], sessionId);
    jest.clearAllMocks();
    appendInteractionLine.mockClear();

    const res2 = await handleChat("produse", "C1", [], sessionId);
    const log2 = lastLogEntry();

    expect(log2.intent.queryType).toBe("selection");
    expect(log2.decision.missingSlot).not.toBe("intent_level");
    const q = String(res2.reply || res2.message || "").toLowerCase();
    expect(q).not.toMatch(/vrei pa[sș]i.*recomandare|alege una:/);
    expect(log2.lowSignalRecoveryApplied).toBe(true);
  });

  it("C: safety query is not replaced by low-signal intent-level", async () => {
    const sessionId = `lowsig-c-${Date.now()}`;
    const res = await handleChat("e sigur apc pe piele?", "C1", [], sessionId);
    const log = lastLogEntry();

    expect(log.intent.queryType).toBe("safety");
    expect(log.decision.missingSlot).not.toBe("intent_level");
    expect(String(res.reply || res.message || "").length).toBeGreaterThan(5);
  });

  it("D: informational ce este apc stays knowledge path (no intent_level clarification)", async () => {
    const sessionId = `lowsig-d-${Date.now()}`;
    await handleChat("ce este apc?", "C1", [], sessionId);
    const log = lastLogEntry();

    expect(askLLM).toHaveBeenCalled();
    expect(log.decision.missingSlot).not.toBe("intent_level");
    expect(Boolean(log.lowSignalDetected)).toBe(false);
  });

  it("E: mixed domain + ce-mi dai bun avoids intent_level", async () => {
    const sessionId = `lowsig-e-${Date.now()}`;
    await handleChat("salut vreau sa curat plasticul din interiorul masinii. ce-mi dai bun?", "C1", [], sessionId);
    const log = lastLogEntry();

    expect(log.decision.missingSlot).not.toBe("intent_level");
    if (log.decision.action === "clarification") {
      expect(["context", "object", "surface"]).toContain(log.decision.missingSlot);
    }
  });
});
