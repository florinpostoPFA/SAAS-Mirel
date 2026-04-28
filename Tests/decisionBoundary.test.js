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
    const llmCallsBefore = askLLM.mock.calls.length;

    const result = await handleChat("pot folosi apc pe piele?", "C1", [], sessionId);

    expect(result.type).toBe("reply");
    expect(executeFlow.mock.calls.length).toBe(flowCallsBefore);
    expect(askLLM.mock.calls.length).toBe(llmCallsBefore);
    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("safety");
    expect(lastLogEntry.slots).toEqual({});
    const reply = String(result.reply || result.message || "");
    const isAnswerFirst = /^(DEPINDE|DA|NU)[.\s]/i.test(reply.trim());
    const isTargetedClarification = /\?/.test(reply) && /piele|diluat|concentrat|suprafata|finisaj|mat|lucio/i.test(reply);
    expect(isAnswerFirst || isTargetedClarification).toBe(true);
  });

  it("clears procedural slots on knowledge boundary after procedural sequence", async () => {
    const sessionId = `knowledge-boundary-${Date.now()}`;
    askLLM.mockResolvedValue("Da, poti folosi APC pe piele doar diluat.");

    await handleChat("cotiera", "C1", [], sessionId);
    await handleChat("textil", "C1", [], sessionId);
    const llmCallsBefore = askLLM.mock.calls.length;
    const final = await handleChat("pot folosi apc pe piele?", "C1", [], sessionId);

    expect(final.type).toBe("reply");
    expect(askLLM.mock.calls.length).toBe(llmCallsBefore);
    const session = getSession(sessionId);
    expect(session.slots || {}).toEqual({});
    expect(session.pendingQuestion).toBeNull();

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("safety");
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

  it("vreau sa curat pielea does not default context; asks interior vs exterior (leather alone ambiguous)", async () => {
    const sessionId = `leather-default-${Date.now()}`;

    const first = await handleChat("vreau sa curat pielea", "C1", [], sessionId);
    const firstMessage = String(first.message || first.reply || "").toLowerCase();
    const session = getSession(sessionId);

    expect(firstMessage).toMatch(/interior.*exterior|exterior.*interior/);
    expect(session.slots.context == null || String(session.slots.context).trim() === "").toBe(true);
    expect(session.slots.surface).toBe("piele");
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

  it("knowledge to de care no longer auto-escalates to selection without pending/recommendation state", async () => {
    const sessionId = `escalate-de-care-${Date.now()}`;

    await handleChat("ce este apc?", "C1", [], sessionId);
    const second = await handleChat("de care?", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).not.toBe("selection");
    expect(lastLogEntry.decision.action).toBe("clarification");
    expect(Array.isArray(second.products || [])).toBe(true);
  });

  it("knowledge to link de apc no longer auto-escalates to selection without pending/recommendation state", async () => {
    const sessionId = `escalate-apc-link-${Date.now()}`;

    await handleChat("ce este apc?", "C1", [], sessionId);
    const second = await handleChat("link de apc", "C1", [], sessionId);

    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).not.toBe("selection");
    expect(lastLogEntry.decision.action).toBe("clarification");
    expect(Array.isArray(second.products || [])).toBe(true);
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

  // Fix 3: Knowledge gate protection for procedural how-to queries

  it("cum curet cotiera stays procedural and asks for surface", async () => {
    const sessionId = `howto-surface-1-${Date.now()}`;

    const result = await handleChat("cum curat cotiera", "C1", [], sessionId);

    expect(result.type).toBe("question");
    const msg = String(result.message || "").toLowerCase();
    expect(msg).toMatch(/textil|piele|plastic|alcantara/);
    const session = getSession(sessionId);
    expect(session.state).toBe("NEEDS_SURFACE");
  });

  it("cum curet cotiera murdara stays procedural and asks for surface (not downgraded to informational)", async () => {
    const sessionId = `howto-surface-2-${Date.now()}`;

    const result = await handleChat("cum curat cotiera murdara", "C1", [], sessionId);

    expect(result.type).toBe("question");
    const msg = String(result.message || "").toLowerCase();
    expect(msg).toMatch(/textil|piele|plastic|alcantara/);
    const session = getSession(sessionId);
    expect(session.state).toBe("NEEDS_SURFACE");
  });

  it("cum scot pete de pe scaun stays procedural and asks for surface", async () => {
    const sessionId = `howto-surface-3-${Date.now()}`;

    const result = await handleChat("cum scot pete de pe scaun", "C1", [], sessionId);

    expect(result.type).toBe("question");
    const msg = String(result.message || "").toLowerCase();
    expect(msg).toMatch(/textil|piele|plastic|alcantara/);
  });

  it("missing surface clarification in ro contains only romanian helper", async () => {
    const sessionId = `surface-clar-ro-${Date.now()}`;

    const result = await handleChat("vreau sa curat cotiera", "C1", [], sessionId);

    expect(result.type).toBe("question");
    const message = String(result.message || result.reply || "");
    expect(message).toContain("Ce suprafata este: textile, piele, plastic sau alcantara?");
    expect(message).toContain("Nu esti sigur?");
    expect(message).not.toContain("Not sure?");
    expect(message).toContain("\n\n");
  });

  it("missing surface clarification in en contains only english helper", async () => {
    const sessionId = `surface-clar-en-${Date.now()}`;

    saveSession(sessionId, {
      state: "FOLLOWUP",
      tags: [],
      activeProducts: [],
      lastResponse: null,
      slots: {},
      pendingQuestion: null,
      responseLocale: "en",
      language: "en"
    });

    const result = await handleChat("i want to clean my armrest", "C1", [], sessionId);

    expect(result.type).toBe("question");
    const message = String(result.message || result.reply || "");
    expect(message).toContain("What surface is it: textile, piele, plastic, or alcantara?");
    expect(message).toContain("Not sure? Tell me your car (make, model, year) and I'll help you pick.");
    expect(message).not.toContain("Nu esti sigur?");
    expect(message).toContain("\n\n");
  });

  it("cum functioneaza apc remains informational and does not ask surface", async () => {
    const sessionId = `howto-informational-1-${Date.now()}`;

    const result = await handleChat("cum functioneaza apc", "C1", [], sessionId);

    const msg = String(result.message || result.reply || "").toLowerCase();
    expect(msg).not.toMatch(/textil|piele|plastic|alcantara/);
    expect(result.type).not.toBe("question");
    const logEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(logEntry.decision.action).toBe("knowledge");
  });

  it("ce este apc remains informational - regression check", async () => {
    const sessionId = `howto-informational-2-${Date.now()}`;

    const result = await handleChat("ce este apc", "C1", [], sessionId);

    const msg = String(result.message || result.reply || "").toLowerCase();
    expect(msg).not.toMatch(/textil|piele|plastic|alcantara/);
    expect(result.type).not.toBe("question");
    const logEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(logEntry.decision.action).toBe("knowledge");
  });

  it("cum curat cotiera with surface in message proceeds without asking surface", async () => {
    const sessionId = `howto-surface-known-${Date.now()}`;

    const result = await handleChat("cum curat cotiera din piele", "C1", [], sessionId);

    // Surface is piele (leather) - should NOT ask for surface again
    const msg = String(result.message || result.reply || "").toLowerCase();
    const isAskingSurface = result.type === "question" && msg.match(/textil|piele|plastic|alcantara/);
    expect(isAskingSurface).toBeFalsy();
  });

  it("cum curat prosopul executes tool_care_towel without slot clarification", async () => {
    const sessionId = `towel-specialized-${Date.now()}`;

    const result = await handleChat("cum curat prosopul ?", "C1", [], sessionId);

    expect(result.type).toBe("flow");
    expect(executeFlow).toHaveBeenCalled();
    expect(executeFlow.mock.calls[0][0].flowId).toBe("tool_care_towel");
    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).not.toBe("clarification");
    expect(lastLogEntry.decision.flowId).toBe("tool_care_towel");
    expect(lastLogEntry.decision.missingSlot).toBeNull();
    expect(lastLogEntry.output.type).not.toBe("question");
  });

  it("cum curat o cotiera still clarifies when legacy flow requires surface", async () => {
    const sessionId = `cotiera-surface-clar-${Date.now()}`;

    const result = await handleChat("cum curat o cotiera ?", "C1", [], sessionId);

    expect(result.type).toBe("question");
    const lastLogEntry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(lastLogEntry.decision.action).toBe("clarification");
    expect(lastLogEntry.output.type).toBe("question");
    expect(lastLogEntry.decision.missingSlot).toBe("surface");
  });

  it("responseLocale stays ro across procedural surface clarification into flow execution", async () => {
    const sessionId = `locale-clar-flow-${Date.now()}`;
    executeFlow.mockImplementation((flow, products, slots, options) => {
      expect(options?.responseLocale).toBe("ro");
      return {
        reply: "Pasul 1: curatare textile. Foloseste solutie dedicata textilelor.",
        products: []
      };
    });

    const first = await handleChat("cum curat o cotiera ?", "C1", [], sessionId);
    expect(first.type).toBe("question");
    const q1 = String(first.message || "").toLowerCase();
    expect(q1).toMatch(/suprafata|textile|piele|plastic|alcantara/);
    expect(q1).not.toMatch(/^what surface is it/i);

    const mid = getSession(sessionId);
    expect(mid.responseLocale).toBe("ro");
    expect(mid.pendingClarification?.responseLocale).toBe("ro");

    await handleChat("textile", "C1", [], sessionId);
    const fin = getSession(sessionId);
    expect(fin.responseLocale).toBe("ro");
    const lastFlowCall = executeFlow.mock.calls[executeFlow.mock.calls.length - 1];
    expect(lastFlowCall[3]?.responseLocale).toBe("ro");
  });
});
