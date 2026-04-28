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
const { getSession } = require("../services/sessionStore");

function lastLog() {
  const c = appendInteractionLine.mock.calls;
  return c[c.length - 1][0];
}

describe("Glass routing and glass_clean_basic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("ok");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [
        { id: 1, name: "Glass Cleaner", tags: ["glass_cleaner", "exterior", "glass"] },
        { id: 2, name: "Microfiber", tags: ["microfiber", "exterior", "glass"] }
      ]
    }));
  });

  it("A: vreau sa curat sticla asks Interior sau exterior then interior runs glass_clean_basic", async () => {
    const sessionId = `glass-a-${Date.now()}`;
    const first = await handleChat("vreau sa curat sticla", "C1", [], sessionId);
    expect(first.type).toBe("question");
    expect(String(first.message || "")).toMatch(/interior\w*\s+sau\s+exterior\w*/i);

    const s1 = getSession(sessionId);
    expect(s1.pendingQuestion?.slot).toBe("context");

    const second = await handleChat("interior", "C1", [], sessionId);
    expect(second.type).toBe("flow");
    expect(executeFlow).toHaveBeenCalled();
    expect(executeFlow.mock.calls[executeFlow.mock.calls.length - 1][0].flowId).toBe("glass_clean_basic");
    const log = lastLog();
    expect(log.decision.flowId).toBe("glass_clean_basic");
  });

  it("A: geamuri / parbriz in message map to canonical object glass", async () => {
    const sid1 = `glass-syn1-${Date.now()}`;
    await handleChat("vreau sa curat geamuri", "C1", [], sid1);
    expect(getSession(sid1).slots?.object).toBe("glass");
    const sid2 = `glass-syn2-${Date.now()}`;
    await handleChat("cum curat parbrizul", "C1", [], sid2);
    expect(getSession(sid2).slots?.object).toBe("glass");
  });

  it("B: insecte pe parbriz routes to bug_removal_quick with exterior context", async () => {
    const sessionId = `glass-bug-${Date.now()}`;
    const result = await handleChat("insecte pe parbriz", "C1", [], sessionId);
    expect(result.type).toBe("flow");
    expect(executeFlow.mock.calls[0][0].flowId).toBe("bug_removal_quick");
    const slots = executeFlow.mock.calls[0][2];
    expect(slots.context).toBe("exterior");
    expect(lastLog().decision.flowId).toBe("bug_removal_quick");
  });

  it("C: geamuri without insect does not select bug_removal_quick", async () => {
    const sessionId = `glass-neg-${Date.now()}`;
    await handleChat("cum curat geamurile", "C1", [], sessionId);
    await handleChat("exterior", "C1", [], sessionId);
    const calls = executeFlow.mock.calls.map((c) => c[0].flowId);
    expect(calls.includes("bug_removal_quick")).toBe(false);
    expect(calls[calls.length - 1]).toBe("glass_clean_basic");
  });

  it("D: profanity during clarification clears pendingQuestion", async () => {
    const sessionId = `glass-abuse-${Date.now()}`;
    await handleChat("vreau sa curat sticla", "C1", [], sessionId);
    expect(getSession(sessionId).pendingQuestion).toBeTruthy();
    const rude = await handleChat("esti un idiot", "C1", [], sessionId);
    expect(rude.type).toBe("reply");
    const s = getSession(sessionId);
    expect(s.pendingQuestion).toBeNull();
    expect(s.slots || {}).toEqual({});
  });
});
