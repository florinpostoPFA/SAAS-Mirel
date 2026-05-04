"use strict";

const chatService = require("../services/chatService");
const { evaluateDeterministicSessionReset, applyDeterministicSessionResetInPlace } =
  chatService.__test;

describe("evaluateDeterministicSessionReset", () => {
  it("returns reset.new_root_query for new root cleaning query", () => {
    const r = evaluateDeterministicSessionReset({
      userMessage: "vreau sa spal masina complet",
      sessionContext: { slots: { object: "jante" }, pendingQuestion: null },
      intentCore: "vreau sa spal masina complet",
      pendingSlotClarificationActive: false
    });
    expect(r).toEqual({ reset: true, reasonCode: "reset.new_root_query" });
  });

  it("returns reset.high_level_intent_shift when last HL differs from current", () => {
    const r = evaluateDeterministicSessionReset({
      userMessage: "vreau sampon pentru jante",
      sessionContext: {
        lastHighLevelIntent: "knowledge",
        slots: {},
        pendingQuestion: null
      },
      intentCore: "vreau sampon pentru jante",
      pendingSlotClarificationActive: false
    });
    expect(r).toEqual({ reset: true, reasonCode: "reset.high_level_intent_shift" });
  });

  it("does not reset on HL shift when pending slot clarification is active", () => {
    const r = evaluateDeterministicSessionReset({
      userMessage: "vreau sampon pentru jante",
      sessionContext: {
        lastHighLevelIntent: "knowledge",
        slots: { surface: "vopsea" },
        pendingQuestion: { slot: "surface", type: "slot" }
      },
      intentCore: "vreau sampon pentru jante",
      pendingSlotClarificationActive: true
    });
    expect(r).toEqual({ reset: false, reasonCode: null });
  });

  it("returns reset.new_object when canonical object changes", () => {
    const r = evaluateDeterministicSessionReset({
      userMessage: "vreau produs pentru jante",
      sessionContext: {
        lastHighLevelIntent: "product_search",
        slots: { object: "mocheta" },
        pendingQuestion: null
      },
      intentCore: "vreau produs pentru jante",
      pendingSlotClarificationActive: false
    });
    expect(r).toEqual({ reset: true, reasonCode: "reset.new_object" });
  });

  it("does not reset for da/nu during HL shift guard", () => {
    const r = evaluateDeterministicSessionReset({
      userMessage: "da",
      sessionContext: {
        lastHighLevelIntent: "knowledge",
        slots: {},
        pendingQuestion: null
      },
      intentCore: "da",
      pendingSlotClarificationActive: false
    });
    expect(r.reset).toBe(false);
  });
});

describe("applyDeterministicSessionResetInPlace", () => {
  it("clears session fields and nulls lastHighLevelIntent", () => {
    const sessionContext = {
      slots: { object: "jante" },
      pendingQuestion: { slot: "surface" },
      pendingSelection: true,
      pendingSelectionMissingSlot: "surface",
      lastFlow: "x",
      glassFlowContextLocked: true,
      state: "NEEDS_SURFACE",
      originalIntent: "clean",
      intentFlags: { a: 1 },
      selectionFollowupCarryover: { slots: {} },
      slotMeta: { context: "exterior", surface: "wheels", object: "jante" },
      lastHighLevelIntent: "product_search"
    };
    applyDeterministicSessionResetInPlace(sessionContext, "sess-1", "reset.new_object");
    expect(sessionContext.slots).toEqual({});
    expect(sessionContext.pendingQuestion).toBeNull();
    expect(sessionContext.pendingSelection).toBe(false);
    expect(sessionContext.pendingSelectionMissingSlot).toBeNull();
    expect(sessionContext.lastFlow).toBeNull();
    expect(sessionContext.glassFlowContextLocked).toBe(false);
    expect(sessionContext.state).toBe("IDLE");
    expect(sessionContext.originalIntent).toBeNull();
    expect(sessionContext.intentFlags).toEqual({});
    expect(sessionContext.selectionFollowupCarryover).toBeUndefined();
    expect(sessionContext.slotMeta).toEqual({
      context: "unknown",
      surface: "unknown",
      object: "unknown"
    });
    expect(sessionContext.lastHighLevelIntent).toBeNull();
  });
});
