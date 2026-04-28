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
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");
const {
  isKnowledgeDeadEnd,
  buildKnowledgeDeadEndRecoveryPatch,
  hasActionableKnowledgeCue
} = require("../services/knowledgeDeadEndService");

function lastLog() {
  const c = appendInteractionLine.mock.calls;
  return c[c.length - 1][0];
}

describe("knowledgeDeadEndService", () => {
  it("isKnowledgeDeadEnd true for thin reply without question", () => {
    expect(
      isKnowledgeDeadEnd({
        decision: { action: "knowledge" },
        outputType: "reply",
        finalProducts: [],
        replyText: "ok.",
        queryType: "procedural"
      })
    ).toBe(true);
  });

  it("isKnowledgeDeadEnd false when reply asks something", () => {
    expect(
      isKnowledgeDeadEnd({
        decision: { action: "knowledge" },
        outputType: "reply",
        finalProducts: [],
        replyText: "Spune-mi ce vrei sa cureti?",
        queryType: "procedural"
      })
    ).toBe(false);
  });

  it("isKnowledgeDeadEnd false for safety queryType", () => {
    expect(
      isKnowledgeDeadEnd({
        decision: { action: "knowledge" },
        outputType: "reply",
        finalProducts: [],
        replyText: "",
        queryType: "safety"
      })
    ).toBe(false);
  });

  it("hasActionableKnowledgeCue detects next-step phrasing", () => {
    expect(hasActionableKnowledgeCue("Poti sa imi spui interior sau exterior?")).toBe(true);
  });
});

describe("Knowledge dead-end recovery (integration)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("ok.");
  });

  it("Salut vreau ceva pt jante — no dead-end stall (recovery or substantive)", async () => {
    askLLM.mockResolvedValueOnce("Da.");
    const sessionId = `kde-jante-${Date.now()}`;
    await handleChat("Salut vreau ceva pt jante", "C1", [], sessionId);
    const log = lastLog();
    const ar = String(log.assistantReply || "");
    expect(ar.length).toBeGreaterThan(3);
    expect(
      log.knowledgeRecoveryApplied === true ||
        ar.includes("?") ||
        hasActionableKnowledgeCue(ar) ||
        log.output.productsLength > 0
    ).toBe(true);
  });

  it("Vreau prosop flash detail — not an empty dead end", async () => {
    askLLM.mockResolvedValueOnce(".");
    await handleChat("Vreau prosop flash detail", "C1", [], `kde-pro-${Date.now()}`);
    const log = lastLog();
    const ar = String(log.assistantReply || "");
    expect(ar.length).toBeGreaterThan(5);
    expect(
      (log.knowledgeDeadEndDetected === true && log.knowledgeRecoveryApplied === true) ||
        log.output.productsLength > 0 ||
        ar.includes("?") ||
        hasActionableKnowledgeCue(ar)
    ).toBe(true);
  });

  it("Salut vreau sa protejez pielea — recovery or guidance with next step", async () => {
    askLLM.mockResolvedValueOnce("x");
    await handleChat("Salut! Vreau sa protejez pielea masinii", "C1", [], `kde-leather-${Date.now()}`);
    const log = lastLog();
    const ar = String(log.assistantReply || "");
    expect(
      log.knowledgeRecoveryApplied === true ||
        hasActionableKnowledgeCue(ar) ||
        ar.includes("?") ||
        log.output.productsLength > 0
    ).toBe(true);
  });

  it("Salutare vreau reducere — targeted discount clarifier", async () => {
    await handleChat("Salutare vreau reducere", "C1", [], `kde-disc-${Date.now()}`);
    const log = lastLog();
    const ar = String(log.assistantReply || "").toLowerCase();
    expect(ar).toMatch(/cod|campanie|discount/);
    expect(String(log.assistantReply || "")).toMatch(/\?/);
  });

  it("safety messages do not get knowledge recovery flags", async () => {
    await handleChat("Pot folosi APC pe piele naturala?", "C1", [], `kde-safe-${Date.now()}`);
    const log = lastLog();
    expect(log.decision.action).toBe("safety");
    expect(log.knowledgeDeadEndDetected).toBeFalsy();
    expect(log.knowledgeRecoveryApplied).toBeFalsy();
  });

  it("buildKnowledgeDeadEndRecoveryPatch sets pendingQuestion for clarification mode", () => {
    const interactionRef = {
      decision: { action: "knowledge", flowId: null, missingSlot: null },
      queryType: "procedural",
      message: "test",
      slots: { context: null, object: null, surface: null },
      sessionId: "s1"
    };
    const sessionContext = { slots: {}, knowledgeDeadEndRecoveryCount: 0 };
    const patch = buildKnowledgeDeadEndRecoveryPatch({
      interactionRef,
      sessionContext,
      finalResult: { reply: "nu stiu", message: "nu stiu" },
      finalOutputType: "reply",
      finalProducts: [],
      getMissingSlot: () => "context"
    });
    expect(patch).toBeTruthy();
    expect(patch.telemetry.knowledgeDeadEndDetected).toBe(true);
    expect(patch.telemetry.knowledgeRecoveryApplied).toBe(true);
    expect(patch.pendingQuestion.slot).toBe("context");
    expect(patch.finalResult.message).toMatch(/interior sau exterior/i);
    const qCount = (String(patch.finalResult.message).match(/\?/g) || []).length;
    expect(qCount).toBeLessThanOrEqual(1);
  });
});
