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
const {
  applyUserCorrection,
  shouldBreakRepeatedAsk,
  recordClarificationAsk,
  extractPendingSlotBinding
} = require("../services/slotCorrectionService");

function lastLog() {
  const c = appendInteractionLine.mock.calls;
  return c.length ? c[c.length - 1][0] : null;
}

describe("slotCorrectionService (deterministic)", () => {
  it("A: explicit correction overrides previous context", () => {
    const r = applyUserCorrection({
      prevSlots: { context: "exterior", surface: null, object: null },
      newExtraction: { context: null, surface: null, object: null },
      pendingQuestion: null,
      message: "nu, interior",
      slotMeta: { context: "inferred", surface: "unknown", object: "unknown" }
    });
    expect(r.nextSlots.context).toBe("interior");
    expect(r.slotMeta.context).toBe("confirmed");
    expect(r.reason).toBe("explicit_correction");
  });

  it("B: pending surface binds textil from message", () => {
    const bind = extractPendingSlotBinding("textil", { slot: "surface" });
    expect(bind).toEqual({ slot: "surface", value: "textile" });

    const r = applyUserCorrection({
      prevSlots: { context: "interior", surface: null, object: "cotiera" },
      newExtraction: { context: null, surface: null, object: null },
      pendingQuestion: { slot: "surface", object: "cotiera", context: "interior" },
      message: "textil",
      slotMeta: { context: "confirmed", surface: "unknown", object: "confirmed" }
    });
    expect(r.nextSlots.surface).toBe("textile");
    expect(r.pendingCleared).toBe(true);
    expect(r.reason).toBe("pending_answer");
  });

  it("B2: pending object binds vopseaua to caroserie without auto-filling surface", () => {
    const bind = extractPendingSlotBinding("vopseaua", { slot: "object" });
    expect(bind).toEqual({ slot: "object", value: "caroserie" });

    const r = applyUserCorrection({
      prevSlots: { context: "exterior", surface: null, object: null },
      newExtraction: { context: null, surface: "paint", object: "caroserie" },
      pendingQuestion: { slot: "object", context: "exterior" },
      message: "vopseaua",
      slotMeta: { context: "confirmed", surface: "unknown", object: "unknown" }
    });
    expect(r.nextSlots.object).toBe("caroserie");
    expect(r.nextSlots.surface).toBeNull();
    expect(r.pendingCleared).toBe(true);
    expect(r.reason).toBe("pending_answer");
  });

  it("D: does not silently flip confirmed context when extraction disagrees", () => {
    const r = applyUserCorrection({
      prevSlots: { context: "interior", surface: null, object: null },
      newExtraction: { context: "exterior", surface: null, object: null },
      pendingQuestion: null,
      message: "ok",
      slotMeta: { context: "confirmed", surface: "unknown", object: "unknown" }
    });
    expect(r.nextSlots.context).toBe("interior");
    expect(r.updates.filter((u) => u.slot === "context")).toHaveLength(0);
  });

  it("loop breaker: second ask for same slot", () => {
    const session = { clarificationAskCounts: {} };
    expect(shouldBreakRepeatedAsk(session, "surface")).toBe(false);
    recordClarificationAsk(session, "surface");
    expect(shouldBreakRepeatedAsk(session, "surface")).toBe(true);
  });
});

describe("Slot correction integration (handleChat)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Explicație scurtă.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow ${flow.flowId}`,
      products: [{ id: 1, name: "Produs test", tags: ["interior"] }]
    }));
  });

  it("C: repeated surface clarification triggers loop breaker (intent_level)", async () => {
    const sessionId = `slot-loop-${Date.now()}`;
    await handleChat("cum curat cotiera murdara", "C1", [], sessionId);
    appendInteractionLine.mockClear();

    await handleChat("hmm", "C1", [], sessionId);
    const log2 = lastLog();
    expect(log2?.decision?.missingSlot).toBe("intent_level");
    expect(log2?.slotCorrectionReason).toBe("loop_breaker");
    expect(String(log2?.assistantReply || "").toLowerCase()).toMatch(/pa[sș]i|recomandare/);
  });

  it("E: profanity with active pending clears state (abuse reset)", async () => {
    const sessionId = `slot-abuse-${Date.now()}`;
    const s = getSession(sessionId);
    s.pendingQuestion = { slot: "surface", context: "interior", object: "scaun" };
    s.slots = { context: "interior", object: "scaun", surface: null };
    saveSession(sessionId, s);

    await handleChat("esti un idiot", "C1", [], sessionId);
    const log = lastLog();
    expect(log.decision.action).toBe("safety");
    expect(log.slotCorrectionReason).toBe("abuse_reset");
    const after = getSession(sessionId);
    expect(after.pendingQuestion).toBeNull();
  });

  it("sequence: surface answer textil after cotiera how-to converges slots", async () => {
    const sessionId = `slot-seq-${Date.now()}`;
    const res1 = await handleChat("cum curat cotiera murdara", "C1", [], sessionId);
    expect(res1.type).toBe("question");

    await handleChat("textil", "C1", [], sessionId);
    const fin = getSession(sessionId);
    expect(fin.slots.object).toBe("cotiera");
    expect(fin.slots.surface).toBe("textile");
    expect(fin.slots.context).toBe("interior");
  });

  it("exterior object clarification accepts vopseaua and progresses to surface without loop breaker", async () => {
    const sessionId = `slot-exterior-paint-${Date.now()}`;

    await handleChat("vreau sa curat exteriorul", "C1", [], sessionId);
    const q1 = lastLog();
    expect(q1?.decision?.missingSlot).toBe("object");

    appendInteractionLine.mockClear();
    await handleChat("vopseaua", "C1", [], sessionId);
    const q2 = lastLog();

    expect(q2?.decision?.missingSlot).toBe("surface");
    expect(Boolean(q2?.decision?.loopBreaker)).toBe(false);
    expect(q2?.slots?.object).toBe("caroserie");
    expect(q2?.slots?.context).toBe("exterior");
    expect(q2?.decision?.missingSlot).not.toBe("intent_level");

    const progress = Array.isArray(q2?.logs)
      ? q2.logs.find((entry) => entry?.event === "CLARIFICATION_SLOT_PROGRESS")
      : null;
    if (progress) {
      expect(progress.nextMissingSlot).toBe("surface");
    }
  });
});
