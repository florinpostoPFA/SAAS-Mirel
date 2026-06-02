"use strict";

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { executeFlow } = require("../services/flowExecutor");
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat, __test: t } = require("../services/chatService");
const { buildLowSignalClarificationQuestion } = require("../services/lowSignalService");
const { inferHighLevelIntent } = require("../services/productIntentHeuristics");

describe("Prod regression fixes (locale, mirrors, shine heuristic, narrowing)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Stub LLM.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [{ id: 1, name: "T", tags: [] }]
    }));
  });

  it("extractNormalizedSlotsFromMessage: oglinzile inflection → glass + exterior", () => {
    const s = t.extractNormalizedSlotsFromMessage("cum curat oglinzile?");
    expect(s.object).toBe("glass");
    expect(s.context).toBe("exterior");
  });

  it("buildLowSignalClarificationQuestion uses English for intent_level when locale is en (F27)", () => {
    const q = buildLowSignalClarificationQuestion("x", "x", "en");
    expect(q).toMatch(/steps|product/i);
    expect(q).not.toMatch(/recomandare de produse|vrei pași/i);
  });

  it("inferHighLevelIntent: BMW + shine goal → product_search (not knowledge dead-end)", () => {
    expect(inferHighLevelIntent("bmw negru mat vreau sa luceasca")).toBe("product_search");
  });

  it("handleChat: EN opener then low-signal follow-up → Romanian intent_level question (F32)", async () => {
    const sessionId = `prod-reg-en-intent-${Date.now()}`;
    await handleChat("Hello I need help cleaning my car exterior", "C1", [], sessionId);
    const r2 = await handleChat("x", "C1", [], sessionId);
    const msg = String(r2.message || r2.reply || "");
    expect(r2.type).toBe("question");
    expect(msg).toMatch(/recomandare de produse|vrei pași/i);
    expect(msg).not.toMatch(/\bDo you want steps\b/i);
    expect(msg).not.toMatch(/\bsteps or product recommendation\b/i);
  });

  it("handleChat: oglinzile → glass_clean_basic flow", async () => {
    const sessionId = `prod-reg-mirrors-${Date.now()}`;
    const r = await handleChat("cum curat oglinzile?", "C1", [], sessionId);
    expect(r.type).toBe("flow");
    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.action).toBe("flow");
    expect(last.decision.flowId).toBe("glass_clean_basic");
  });

  it("handleChat: after textile recommendation, murdărie grea does not loop on intent_level", async () => {
    const sessionId = `prod-reg-narrow-${Date.now()}`;
    const products = [
      {
        id: "t1",
        name: "Cleaner Textil Interior",
        description: "Curata sigur textilele din interior si indeparteaza murdaria persistenta.",
        short_description: "Curata sigur textilele din interior.",
        tags: ["interior", "textile", "interior_cleaner", "cleaner"]
      },
      {
        id: "t2",
        name: "Perie pentru textile",
        description: "Ajuta la desprinderea murdariei din fibre fara agresivitate.",
        short_description: "Perie moale pentru textile.",
        tags: ["interior", "textile", "brush", "tool"]
      },
      {
        id: "t3",
        name: "Laveta Microfibra Premium",
        description: "Pentru stergere fara scame si fara zgarieturi.",
        short_description: "Laveta premium din microfibra.",
        tags: ["microfiber", "tool"]
      }
    ];
    await handleChat("ce produs recomanzi pentru cotiera textil murdara", "C1", products, sessionId);
    await handleChat("murdarie grea", "C1", products, sessionId);
    const last = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(last.decision.missingSlot).not.toBe("intent_level");
    expect(last.decision.action).not.toBe("knowledge");
  });
});
