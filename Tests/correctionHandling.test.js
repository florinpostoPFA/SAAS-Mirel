const { __test } = require("../services/chatService");

describe("correction handling (EPIC 4.3)", () => {
  it("detects 'nu vreau X', resets conflicting slots and asks clarification", () => {
    const slots = {
      context: "exterior",
      object: "jante",
      surface: "wheels"
    };

    const decision = __test.resolveActionFinal({
      message: {
        text: "nu vreau jante",
        routingDecision: { action: "selection", reason: "test" }
      },
      slots,
      routingContext: {
        previousState: "NEEDS_OBJECT",
        slotResultMissing: "object",
        completedSlotFollowUp: false,
        userMessage: "nu vreau jante",
        selectionEscalation: false
      }
    });

    expect(slots.object).toBeNull();
    expect(slots.surface).toBeNull();
    expect(decision.action).toBe("clarification");
    expect(decision.missingSlot).toBe("object");
    expect(decision.correctionAck).toBe("Am înțeles, nu vrei jante.");
  });
});

