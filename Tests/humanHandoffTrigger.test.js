"use strict";

const {
  evaluateHumanHandoffTrigger,
  recordClarificationLoopAsk,
  recordLowSignalDeadEnd,
  resetClarificationLoopOnSlotFill
} = require("../services/handoff/humanHandoffTrigger");

describe("evaluateHumanHandoffTrigger", () => {
  it("T1 fires for product_search with empty tokens and niche zero pool", () => {
    const r = evaluateHumanHandoffTrigger({
      sessionContext: { lastDetectIntentType: "product_search" },
      intent: { type: "product_search" },
      slots: {},
      retrieval: {
        tokenInferenceMatches: [],
        poolSize: 0,
        matchText: ["roti", "tractor"],
        candidates: []
      },
      pendingQuestion: null
    });
    expect(r).toEqual({ trigger: true, reason: "T1" });
  });

  it("T1 does not fire for interior slot answer token in matchText", () => {
    const r = evaluateHumanHandoffTrigger({
      sessionContext: { lastDetectIntentType: "product_search" },
      intent: { type: "product_search" },
      slots: {},
      retrieval: {
        tokenInferenceMatches: [],
        poolSize: 0,
        matchText: ["interior"],
        candidates: []
      },
      pendingQuestion: null
    });
    expect(r.trigger).toBe(false);
  });

  it("T1 does not fire for vague articol with no catalog match", () => {
    const r = evaluateHumanHandoffTrigger({
      sessionContext: { lastDetectIntentType: "product_search" },
      intent: { type: "product_search" },
      slots: {},
      retrieval: {
        tokenInferenceMatches: [],
        poolSize: 0,
        matchText: ["articol"],
        candidates: []
      },
      pendingQuestion: null
    });
    expect(r.trigger).toBe(false);
  });

  it("T1 does not fire when retrieval pool has candidates", () => {
    const r = evaluateHumanHandoffTrigger({
      sessionContext: {},
      intent: { type: "product_search" },
      slots: {},
      retrieval: { tokenInferenceMatches: [], poolSize: 2 },
      pendingQuestion: null
    });
    expect(r.trigger).toBe(false);
  });

  it("T1 does not fire with pending question", () => {
    const r = evaluateHumanHandoffTrigger({
      sessionContext: {},
      intent: { type: "product_search" },
      slots: {},
      retrieval: { tokenInferenceMatches: [], poolSize: 0 },
      pendingQuestion: { slot: "context", active: true }
    });
    expect(r.trigger).toBe(false);
  });

  it("T2 fires after two asks for same missingSlot", () => {
    const sessionContext = { clarificationLoopCount: { context: 2 } };
    const r = evaluateHumanHandoffTrigger({
      sessionContext,
      intent: { type: "product_search" },
      slots: {},
      retrieval: { missingSlot: "context", tokenInferenceMatches: [] },
      pendingQuestion: null
    });
    expect(r).toEqual({ trigger: true, reason: "T2" });
  });

  it("T2 does not fire on first clarification (loop count 0)", () => {
    const r = evaluateHumanHandoffTrigger({
      sessionContext: { clarificationLoopCount: { context: 0 } },
      intent: { type: "product_search" },
      slots: {},
      retrieval: { missingSlot: "context", tokenInferenceMatches: [] },
      pendingQuestion: null
    });
    expect(r.trigger).toBe(false);
  });

  it("T3 fires on third low-signal dead-end", () => {
    const r = evaluateHumanHandoffTrigger({
      sessionContext: { lowSignalConsecutiveDeadEnds: 3 },
      intent: { type: "product_search" },
      slots: {},
      retrieval: {
        lowSignalDetected: true,
        tokenInferenceMatches: []
      },
      pendingQuestion: null
    });
    expect(r).toEqual({ trigger: true, reason: "T3" });
  });

  it("does not fire during active handoff await", () => {
    const r = evaluateHumanHandoffTrigger({
      sessionContext: { handoff: { state: "awaiting_contact" } },
      intent: { type: "product_search" },
      slots: {},
      retrieval: { tokenInferenceMatches: [], poolSize: 0 },
      pendingQuestion: null
    });
    expect(r.trigger).toBe(false);
  });
});

describe("clarification loop tracking", () => {
  it("increments per slot and resets on fill", () => {
    const ctx = {};
    recordClarificationLoopAsk(ctx, "context");
    recordClarificationLoopAsk(ctx, "context");
    expect(ctx.clarificationLoopCount.context).toBe(2);
    resetClarificationLoopOnSlotFill(ctx, "context");
    expect(ctx.clarificationLoopCount.context).toBeUndefined();
  });
});

describe("low-signal dead-end tracking", () => {
  it("increments on dead-end and resets on progress", () => {
    const ctx = {};
    recordLowSignalDeadEnd(ctx, {
      lowSignalDetected: true,
      pendingCleared: true,
      tokenMatchesEmpty: true
    });
    expect(ctx.lowSignalConsecutiveDeadEnds).toBe(1);
    recordLowSignalDeadEnd(ctx, {
      lowSignalDetected: false,
      pendingCleared: true,
      tokenMatchesEmpty: true
    });
    expect(ctx.lowSignalConsecutiveDeadEnds).toBe(0);
  });
});
