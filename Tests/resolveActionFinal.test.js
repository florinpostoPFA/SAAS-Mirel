"use strict";

const { __test } = require("../services/chatService");

describe("resolveActionFinal", () => {
  it("resolveAction is raw router classification; resolveActionFinal shapes selection → recommend", () => {
    const { resolveAction, resolveActionFinal } = __test;
    const opts = {
      problemType: null,
      message: {
        text: "test mesaj",
        routingDecision: { action: "selection" }
      },
      slots: { context: "interior", object: "scaun", surface: "textile" },
      routingContext: {
        previousState: null,
        slotResultMissing: null,
        completedSlotFollowUp: false,
        userMessage: "test mesaj",
        selectionEscalation: false
      }
    };
    expect(resolveAction(opts).action).toBe("selection");
    expect(resolveActionFinal(opts).action).toBe("recommend");
  });

  it("enforces clarification + surface when NEEDS_SURFACE pending slot is still missing", () => {
    const { resolveActionFinal } = __test;
    const opts = {
      problemType: null,
      message: { text: "followup", routingDecision: { action: "procedural" } },
      slots: { context: "interior", object: "scaune", surface: null },
      routingContext: {
        previousState: "NEEDS_SURFACE",
        slotResultMissing: "surface",
        completedSlotFollowUp: false,
        userMessage: "followup",
        selectionEscalation: false
      }
    };
    const fin = resolveActionFinal(opts);
    expect(fin.action).toBe("clarification");
    expect(fin.missingSlot).toBe("surface");
    expect(fin.flowId).toBeNull();
  });

  it("copies routingDecision.reason onto the decision (M4 migration)", () => {
    const { resolveAction, resolveActionFinal } = __test;
    const opts = {
      problemType: null,
      message: {
        text: "x",
        routingDecision: {
          action: "clarification",
          reason: "missing_context",
          missingSlot: "context"
        }
      },
      slots: { context: null, object: null, surface: null },
      routingContext: {
        previousState: null,
        slotResultMissing: "context",
        completedSlotFollowUp: false,
        userMessage: "x",
        selectionEscalation: false
      }
    };
    const base = resolveAction(opts);
    const fin = resolveActionFinal(opts);
    expect(fin.reason).toBe("missing_context");
    expect(fin.action).toBe(base.action);
    expect(fin.missingSlot).toBe(base.missingSlot);
  });
});
