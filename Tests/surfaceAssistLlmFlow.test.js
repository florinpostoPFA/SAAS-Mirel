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
const { __test } = require("../services/chatService");

function baseSession() {
  return {
    slots: { context: "interior", object: "scaun", surface: null },
    pendingQuestion: { slot: "surface", active: true },
    responseLocale: "ro",
    state: "NEEDS_SURFACE"
  };
}

async function runAssist(sessionContext, userMessage) {
  const interactionRef = {};
  const endInteractionFn = (ref, payload, patch) => ({ payload, patch, patchMeta: patch });
  return __test.tryConsumeSurfaceAssistTurn({
    sessionId: "llm-surf-test",
    sessionContext,
    userMessage,
    interactionRef,
    queryType: "procedural",
    endInteractionFn
  });
}

describe("LLM surface assist (advisory)", () => {
  const originalLlm = process.env.SURFACE_ASSIST_LLM;

  beforeEach(() => {
    process.env.SURFACE_ASSIST_LLM = "1";
    jest.clearAllMocks();
    askLLM.mockResolvedValue('["textile","leather","alcantara"]');
  });

  afterEach(() => {
    if (originalLlm === undefined) {
      delete process.env.SURFACE_ASSIST_LLM;
    } else {
      process.env.SURFACE_ASSIST_LLM = originalLlm;
    }
  });

  it("uncertainty asks for vehicle without calling LLM", async () => {
    const ctx = baseSession();
    const r = await runAssist(ctx, "nu stiu");
    expect(askLLM).not.toHaveBeenCalled();
    expect(r).toBeTruthy();
    expect(String(r.payload.message || "")).toMatch(/marca|model/i);
    expect(ctx.pendingQuestion.surfaceAssistLlmPhase).toBe("awaiting_vehicle");
  });

  it("vehicle line triggers askLLM and does not set surface", async () => {
    const ctx = baseSession();
    await runAssist(ctx, "nu stiu");
    askLLM.mockResolvedValueOnce('["textile","leather"]');
    const r2 = await runAssist(ctx, "VW Golf 2020");
    expect(askLLM).toHaveBeenCalledTimes(1);
    expect(askLLM.mock.calls[0][1]).toMatchObject({ timeoutMs: 2500 });
    expect(ctx.slots.surface == null || ctx.slots.surface === "").toBe(true);
    expect(ctx.pendingQuestion.surfaceAssistLlmPhase).toBe("awaiting_pick");
    expect(String(r2.payload.message || "")).toMatch(/Pentru|Golf|VW/i);
    expect(r2.payload.ui?.type).toBe("chips");
  });

  it("explicit material answer sets surface (no LLM slot write)", async () => {
    const ctx = baseSession();
    await runAssist(ctx, "nu stiu");
    askLLM.mockResolvedValueOnce('["textile","leather"]');
    await runAssist(ctx, "VW Golf 2020");
    jest.clearAllMocks();
    const r3 = await runAssist(ctx, "piele");
    expect(askLLM).not.toHaveBeenCalled();
    expect(r3).toBeNull();
    expect(ctx.slots.surface).toBe("piele");
    expect(ctx.pendingQuestion).toBeNull();
  });

  it("numeric pick maps suggestion to CTO surface", async () => {
    const ctx = baseSession();
    ctx.pendingQuestion = {
      slot: "surface",
      surfaceAssistMode: "llm_advisory",
      surfaceAssistLlmPhase: "awaiting_pick",
      surfaceAssistLlmSuggestions: ["textile", "leather"],
      surfaceAssistLlmCarLabel: "VW Golf 2020"
    };
    ctx.llmSurfaceAssistConsumed = true;
    const r = await runAssist(ctx, "2");
    expect(r).toBeNull();
    expect(ctx.slots.surface).toBe("piele");
  });

  it("LLM failure falls back to normal surface question", async () => {
    const ctx = baseSession();
    await runAssist(ctx, "nu stiu");
    askLLM.mockRejectedValueOnce(new Error("timeout"));
    const rf = await runAssist(ctx, "Audi A3 2019");
    expect(String(rf.payload.message || "")).toMatch(/suprafata|material/i);
    expect(ctx.slots.surface == null || ctx.slots.surface === "").toBe(true);
    expect(rf.patchMeta?.llmSurfaceAssistError).toBe("timeout");
  });

  it("invalid LLM JSON falls back without setting surface", async () => {
    const ctx = baseSession();
    await runAssist(ctx, "nu stiu");
    askLLM.mockResolvedValueOnce("not valid json");
    const rf = await runAssist(ctx, "BMW 320 2018");
    expect(String(rf.payload.message || "")).toMatch(/suprafata|material/i);
    expect(ctx.slots.surface == null || ctx.slots.surface === "").toBe(true);
  });
});
