jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");
const { getSession } = require("../services/sessionStore");
const {
  evaluateClarificationGate,
  isClarificationBudgetExhausted,
  shouldAllowTerminalSafeFallback,
  detectForceFallback
} = require("../services/clarificationFirstPolicy");

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

const LEATHER_PRODUCT = {
  id: "leather-1",
  name: "Leather Conditioner Pro",
  description: "Hidratare si intretinere piele interior auto.",
  tags: ["leather", "piele", "interior", "conditioner", "cleaner", "interior_cleaner"],
  stock: 5,
  manufacturerId: "13"
};

const TEXTILE_PRODUCT = {
  id: "textile-1",
  name: "Textile Upholstery Cleaner",
  tags: ["textile", "textile_cleaner", "interior", "cleaning", "stain_remover"],
  stock: 5,
  manufacturerId: "13"
};

describe("clarificationFirstPolicy unit", () => {
  it("evaluateClarificationGate — slots_missing", () => {
    const g = evaluateClarificationGate({
      slots: { context: "interior", object: "cotiera", surface: null },
      intentTags: ["cleaning"],
      productsReason: null,
      session: {}
    });
    expect(g.shouldClarify).toBe(true);
    expect(g.gateReason).toBe("slots_missing");
  });

  it("evaluateClarificationGate — zero_results with full slots", () => {
    const g = evaluateClarificationGate({
      slots: { context: "interior", surface: "textile", object: "cotiera", action: "clean" },
      intentTags: ["cleaning"],
      productsReason: "no_matching_products",
      session: { clarificationCountIncrement: 0 }
    });
    expect(g.shouldClarify).toBe(true);
    expect(g.gateReason).toBe("zero_results");
  });

  it("isClarificationBudgetExhausted at 2", () => {
    expect(isClarificationBudgetExhausted({ clarificationCountIncrement: 2 })).toBe(true);
    expect(isClarificationBudgetExhausted({ clarificationCountIncrement: 1 })).toBe(false);
  });

  it("shouldAllowTerminalSafeFallback — false on fresh session", () => {
    expect(shouldAllowTerminalSafeFallback({ clarificationCountIncrement: 0 }, "cotiera murdara")).toBe(false);
  });

  it("detectForceFallback phrase", () => {
    expect(detectForceFallback("nu știu ce-mi trebuie, recomanda-mi tu")).toBe(true);
  });
});

describe("clarificationFirstPolicy E2E", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "0";
  });

  it("AC5#1 turn1 ambiguous cotiera → clarify surface, no APC", async () => {
    const sid = `f39-t1-${Date.now()}`;
    const reply = await handleChat("am cotiera foarte murdara", "C1", [TEXTILE_PRODUCT], sid);
    const log = lastLog();
    const msg = String(reply.message || reply.reply || "");
    expect(log.decision.action).toBe("clarification");
    expect(msg).toMatch(/suprafata|textil|piele|plastic|alcantara/i);
    expect(msg).not.toMatch(/fallback sigur|All Purpose Cleaner/i);
  });

  it("AC5#2 turn2 textil binds surface → forward, not F22", async () => {
    const sid = `f39-t2-${Date.now()}`;
    await handleChat("am cotiera foarte murdara", "C1", [TEXTILE_PRODUCT], sid);
    const reply = await handleChat("textil", "C1", [TEXTILE_PRODUCT], sid);
    const log = lastLog();
    const session = getSession(sid);
    const msg = String(reply.message || reply.reply || "");
    expect(session.slots.surface).toBe("textile");
    expect(msg).not.toMatch(/fallback sigur|Vorbesc doar românește/i);
    expect(log.decision.action).not.toBe("knowledge");
  });

  it("AC5#4 turn1 full slots hydrate → recommend without clarification", async () => {
    const sid = `f39-t4-${Date.now()}`;
    const reply = await handleChat(
      "scaunul de piele este uscat, vreau să-l hidratez",
      "C1",
      [LEATHER_PRODUCT],
      sid
    );
    const log = lastLog();
    expect(log.decision.action).not.toBe("clarification");
    expect(String(reply.message || reply.reply || "")).not.toMatch(/Este pentru interior sau exterior/i);
  });

  it("AC5#5 turn1 force fallback → terminal safeFallback path", async () => {
    const sid = `f39-t5-${Date.now()}`;
    const reply = await handleChat("nu știu ce-mi trebuie, recomanda-mi tu", "C1", [], sid);
    const log = lastLog();
    const msg = String(reply.message || reply.reply || "");
    expect(msg).toMatch(/potrivire exactă|soluție generală|fallback/i);
    expect(log.decision.action).toBe("knowledge");
  });

  it("AC5#6 turn1 safety compatibility → safety gate", async () => {
    const sid = `f39-t6-${Date.now()}`;
    const reply = await handleChat("pot folosi apc pe piele?", "C1", [], sid);
    const log = lastLog();
    expect(log.decision.action).toBe("safety");
    expect(String(reply.message || reply.reply || "")).not.toMatch(/fallback sigur/i);
  });

  it("D4-(c) full slots zero catalog → clarify broader scope, not F22", async () => {
    const sid = `f39-zr-${Date.now()}`;
    const noMatchCatalog = [
      {
        id: "wax-only",
        name: "Wax Exterior",
        tags: ["exterior", "paint", "wax"],
        stock: 5,
        manufacturerId: "13"
      }
    ];
    const reply = await handleChat(
      "ce produs recomanzi pentru cotiera textil murdara",
      "C1",
      noMatchCatalog,
      sid
    );
    const log = lastLog();
    const msg = String(reply.message || reply.reply || "");
    expect(log.decision.action).toBe("clarification");
    expect(["zero_results", "both"]).toContain(log.clarificationGateReason);
    expect(msg).toMatch(/potrivire exactă|extind căutarea|marca/i);
    expect(msg).not.toMatch(/fallback sigur|All Purpose Cleaner/i);
  });
});
