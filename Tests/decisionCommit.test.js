"use strict";

const { __test } = require("../services/chatService");

describe("commitTurnDecision", () => {
  it("freezes decision so authority fields cannot be reassigned", () => {
    const ref = {};
    __test.commitTurnDecision(ref, {
      action: "knowledge",
      flowId: null,
      missingSlot: null,
      reasonCode: "routing.knowledge"
    });
    expect(Object.isFrozen(ref.decision)).toBe(true);
    expect(() => {
      ref.decision.action = "clarification";
    }).toThrow();
  });
});
