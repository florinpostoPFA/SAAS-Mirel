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
const { getSession, saveSession } = require("../services/sessionStore");

describe("Decision boundary and reset rules", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    askLLM.mockResolvedValue("Raspuns informational.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow executat: ${flow.flowId}`,
      products: [
        { id: 1, name: "Cleaner", tags: ["cleaner", "exterior", "glass"] },
        { id: 2, name: "Tool", tags: ["tool", "exterior", "glass"] },
        { id: 3, name: "Microfiber", tags: ["microfiber", "exterior", "glass"] }
      ]
    }));
  });

  it("cum curat insectele de pe parbriz executes bug_removal_quick as flow", async () => {
    const sessionId = `flow-${Date.now()}`;

    const result = await handleChat("cum curat insectele de pe parbriz", "C1", [], sessionId);

    expect(result.type).toBe("flow");
    expect(executeFlow).toHaveBeenCalled();
    expect(executeFlow.mock.calls[0][0].flowId).toBe("bug_removal_quick");
  });

  it("flow decision stays flow when executor returns empty payload", async () => {
    const sessionId = `flow-empty-${Date.now()}`;
    executeFlow.mockReturnValueOnce({ reply: "", products: [] });

    const result = await handleChat("cum curat insectele de pe parbriz", "C1", [], sessionId);

    expect(result.type).toBe("flow");
    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("flow");
    expect(lastLogEntry.decision.flowId).toBe("bug_removal_quick");
    expect(lastLogEntry.output.type).toBe("flow");
  });

  it("flow decision stays flow when executor returns non-flow payload", async () => {
    const sessionId = `flow-nonflow-${Date.now()}`;
    executeFlow.mockReturnValueOnce({ type: "knowledge", reply: "", products: [] });

    const result = await handleChat("cum curat insectele de pe parbriz?", "C1", [], sessionId);

    expect(result.type).toBe("flow");
    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("flow");
    expect(lastLogEntry.decision.flowId).toBe("bug_removal_quick");
    expect(lastLogEntry.output.type).toBe("flow");
  });

  it("cum curat o cotiera murdara then textil then cod de reducere resets without surface loop", async () => {
    const sessionId = `reset-${Date.now()}`;

    await handleChat("cum curat o cotiera murdara?", "C1", [], sessionId);
    await handleChat("textil", "C1", [], sessionId);
    const second = await handleChat("cod de reducere", "C1", [], sessionId);

    const session = getSession(sessionId);
    const reply = String(second.reply || second.message || "").toLowerCase();

    expect(second.type).toBe("reply");
    expect(reply).not.toContain("suprafata");
    expect(session.pendingQuestion).toBeNull();
    expect(session.slots || {}).toEqual({});
  });

  it("pot folosi apc pe piele always stays knowledge even after procedural state", async () => {
    const sessionId = `safety-${Date.now()}`;

    await handleChat("cum curat o cotiera murdara?", "C1", [], sessionId);
    await handleChat("textil", "C1", [], sessionId);
    const flowCallsBefore = executeFlow.mock.calls.length;

    const result = await handleChat("pot folosi apc pe piele?", "C1", [], sessionId);

    expect(result.type).toBe("reply");
    expect(executeFlow.mock.calls.length).toBe(flowCallsBefore);
    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("knowledge");
    expect(lastLogEntry.slots).toEqual({});
  });

  it("clears procedural slots on knowledge boundary after procedural sequence", async () => {
    const sessionId = `knowledge-boundary-${Date.now()}`;
    askLLM.mockResolvedValue("Da, poti folosi APC pe piele doar diluat.");

    await handleChat("cotiera", "C1", [], sessionId);
    await handleChat("textil", "C1", [], sessionId);
    const final = await handleChat("pot folosi apc pe piele?", "C1", [], sessionId);

    expect(final.type).toBe("reply");
    const session = getSession(sessionId);
    expect(session.slots || {}).toEqual({});
    expect(session.pendingQuestion).toBeNull();

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("knowledge");
    expect(lastLogEntry.slots).toEqual({});
  });

  it("cod de reducere resets session without clarification loop", async () => {
    const sessionId = `discount-${Date.now()}`;

    await handleChat("cum curat cotiera", "C1", [], sessionId);
    const result = await handleChat("cod de reducere", "C1", [], sessionId);

    expect(result.type).toBe("reply");
    const reply = String(result.reply || result.message || "").toLowerCase();
    expect(reply).not.toContain("suprafata");

    const session = getSession(sessionId);
    expect(session.pendingQuestion).toBeNull();
    expect(session.slots || {}).toEqual({});
  });

  it("textil without pendingQuestion is treated as new query, not slot fill", async () => {
    const sessionId = `token-no-pending-${Date.now()}`;

    saveSession(sessionId, {
      state: "NEEDS_SURFACE",
      tags: ["interior"],
      activeProducts: [],
      lastResponse: null,
      slots: {
        context: "interior",
        object: "cotiera",
        surface: null
      },
      pendingQuestion: null
    });

    await handleChat("textil", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.slots.object).not.toBe("cotiera");
  });

  it("bancheta satisfies object slot and does not ask for object again", async () => {
    const sessionId = `bancheta-${Date.now()}`;

    const first = await handleChat("pai ce sa fac... vreau sa curat interiorul", "C1", [], sessionId);
    expect(first.type).toBe("question");

    await handleChat("bancheta", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.missingSlot).not.toBe("object");
  });

  it("vreau sa curat pielea defaults context to interior and does not ask context clarification", async () => {
    const sessionId = `leather-default-${Date.now()}`;

    const first = await handleChat("vreau sa curat pielea", "C1", [], sessionId);
    const firstMessage = String(first.message || first.reply || "").toLowerCase();
    const session = getSession(sessionId);

    expect(firstMessage).not.toContain("interior sau exterior");
    expect(session.slots.context).toBe("interior");
    expect(session.slots.surface).toBe("leather");
  });

  it("pending clarification keeps procedural path on cotiera follow-up", async () => {
    const sessionId = `pending-lock-${Date.now()}`;

    await handleChat("vreau sa curat pielea", "C1", [], sessionId);
    await handleChat("cotiera", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).not.toBe("knowledge");
    expect(lastLogEntry.decision.missingSlot).not.toBe("surface");
  });

  it("pending clarification treats interiorul as slot completion, not product_search", async () => {
    const sessionId = `pending-interior-${Date.now()}`;

    await handleChat("vreau sa curat", "C1", [], sessionId);
    await handleChat("interiorul", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).not.toBe("knowledge");
  });

  it("knowledge to de care escalates to selection", async () => {
    const sessionId = `escalate-de-care-${Date.now()}`;

    await handleChat("ce este apc?", "C1", [], sessionId);
    const second = await handleChat("de care?", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("selection");
    expect(Array.isArray(second.products)).toBe(true);
    expect(second.products.length).toBeGreaterThan(0);
  });

  it("knowledge to link de apc escalates to selection", async () => {
    const sessionId = `escalate-apc-link-${Date.now()}`;

    await handleChat("ce este apc?", "C1", [], sessionId);
    const second = await handleChat("link de apc", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("selection");
    expect(Array.isArray(second.products)).toBe(true);
    expect(second.products.length).toBeGreaterThan(0);
  });

  it("knowledge to care recomanzi pentru interior stays in selection with interior context", async () => {
    const sessionId = `escalate-interior-reco-${Date.now()}`;

    await handleChat("ce este apc?", "C1", [], sessionId);
    await handleChat("care recomanzi pentru interior?", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("selection");
    expect(lastLogEntry.slots.context).toBe("interior");
  });

  it("knowledge to ok does not escalate to selection", async () => {
    const sessionId = `escalate-no-ok-${Date.now()}`;

    await handleChat("ce este apc?", "C1", [], sessionId);
    await handleChat("ok", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).not.toBe("selection");
  });
});
