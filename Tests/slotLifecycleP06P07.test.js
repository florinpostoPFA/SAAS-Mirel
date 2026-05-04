"use strict";

const { __test: t } = require("../services/chatService");

describe("P0.6 extractNormalizedSlotsFromMessage", () => {
  it("normalizes extracted slots without requiring session", () => {
    const s = t.extractNormalizedSlotsFromMessage("mocheta");
    expect(s.object).toBe("mocheta");
    expect(s.surface).toBe("textile");
  });
});

describe("P0.7 shouldPreserveSlotsForContinuation", () => {
  it("does not treat da as continuation when no pendingQuestion", () => {
    const keep = t.shouldPreserveSlotsForContinuation({
      userMessage: "da",
      sessionContext: {
        state: "IDLE",
        pendingQuestion: null,
        previousAction: "recommend"
      },
      handledPendingQuestionAnswer: false,
      handledPendingQuestionAnswerEarly: false,
      previousState: "IDLE"
    });
    expect(keep).toBe(false);
  });

  it("still treats da as continuation when pendingQuestion exists", () => {
    const keep = t.shouldPreserveSlotsForContinuation({
      userMessage: "da",
      sessionContext: {
        state: "IDLE",
        pendingQuestion: { slot: "surface", active: true },
        previousAction: "clarification"
      },
      handledPendingQuestionAnswer: false,
      handledPendingQuestionAnswerEarly: false,
      previousState: "IDLE"
    });
    expect(keep).toBe(true);
  });
});
