"use strict";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("stub")
}));
jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));
jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { composeClarificationQuestion } = require("../services/clarificationTemplateService");
const { __test, handleChat } = require("../services/chatService");
const { appendInteractionLine } = require("../services/interactionLog");

describe("F40 clarification template composition (AC6)", () => {
  it("AC6-1: protect + wax + exterior + missing object uses aplici/ceara + exterior examples", () => {
    const { message, templateKey } = composeClarificationQuestion({
      missingSlot: "object",
      slots: { action: "protect", context: "exterior", surface: null, object: null },
      intentTags: ["exterior", "wax"]
    });
    expect(message.toLowerCase()).toMatch(/aplici|ceruie/i);
    expect(message.toLowerCase()).toContain("ceara");
    expect(message.toLowerCase()).toMatch(/vopsea|jante|plastice exterioare/);
    expect(templateKey).toContain("object:protect:wax:exterior");
  });

  it("AC6-2: clean + APC + interior + missing surface uses clean verb + interior examples", () => {
    const { message, templateKey } = composeClarificationQuestion({
      missingSlot: "surface",
      slots: { action: "clean", context: "interior", surface: null, object: "scaun" },
      intentTags: ["interior", "cleaning", "apc"]
    });
    expect(message.toLowerCase()).toMatch(/cureti|speli/);
    expect(message.toLowerCase()).toMatch(/piele|textil/);
    expect(templateKey).toContain("surface:clean");
  });

  it("AC6-3: null action + null context + missing context returns F39 context question unchanged", () => {
    const composed = composeClarificationQuestion({
      missingSlot: "context",
      slots: { action: null, context: null, surface: null, object: null },
      intentTags: []
    });
    expect(composed.message).toBe("Este pentru interior sau exterior?");
    expect(composed.templateKey).toBe("context:generic");
  });

  it("AC6-4: protect + interior + leather tag + intent_level asks hydration/protection not cleaning-first", () => {
    const { message } = composeClarificationQuestion({
      missingSlot: "intent_level",
      slots: { action: "protect", context: "interior", surface: "piele", object: "scaun" },
      intentTags: ["leather", "interior"]
    });
    expect(message.toLowerCase()).toMatch(/protejezi|hidratezi/);
    expect(message.toLowerCase()).not.toMatch(/^vrei sa o cureti/i);
  });

  it("AC6-5: negative — never emit cureti-first object question when action=protect", () => {
    for (const c of [
      { missingSlot: "object", slots: { action: "protect", context: "exterior" }, intentTags: ["wax"] },
      { missingSlot: "object", slots: { action: "protect", context: "interior" }, intentTags: ["coating"] }
    ]) {
      expect(composeClarificationQuestion(c).message.toLowerCase()).not.toMatch(/ce vrei sa cureti/);
    }
    const wired = __test.getClarificationQuestion("object", { action: "protect", context: "exterior" }, "ro", {
      intentTags: ["wax", "exterior"]
    });
    expect(wired.toLowerCase()).toMatch(/aplici|ceruie/i);
    expect(wired.toLowerCase()).not.toMatch(/ce vrei sa cureti/);
  });

  it("AC6 narrowing: zero_results with full slots composes discriminator not broaden pivot", () => {
    const { message, templateKey } = composeClarificationQuestion({
      missingSlot: "intent_level",
      slots: { action: "clean", context: "interior", surface: "textile", object: "cotiera" },
      intentTags: ["interior", "textile", "carpet", "cleaning"],
      clarificationGateReason: "zero_results"
    });
    expect(message.toLowerCase()).toMatch(/pata|murda|restr/i);
    expect(message.toLowerCase()).not.toMatch(/extind c[aă]utarea|marca.*model/i);
    expect(templateKey).toContain("narrowing");
  });

  it("AC7: composeClarificationQuestion exposes stable templateKey", () => {
    const { templateKey } = composeClarificationQuestion({
      missingSlot: "object",
      slots: { action: "protect", context: "exterior" },
      intentTags: ["wax"]
    });
    expect(typeof templateKey).toBe("string");
    expect(templateKey.length).toBeGreaterThan(3);
  });
});

describe("F40 integration — handleChat telemetry (AC7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "0";
  });

  it("wax exterior protect logs clarificationTemplateKey on object clarify", async () => {
    const sid = `f40-tel-${Date.now()}`;
    await handleChat("vreau sa dau cu ceara la exterior", "C1", [], sid);
    const log = appendInteractionLine.mock.calls.at(-1)?.[0];
    expect(log.decision.missingSlot).toBe("object");
    expect(log.clarificationTemplateKey).toMatch(/object:protect:wax:exterior/);
    expect(String(log.assistantReply || "")).toMatch(/ceara/i);
    expect(String(log.assistantReply || "")).not.toMatch(/ce vrei sa cureti/i);
  });
});
