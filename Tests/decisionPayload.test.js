const { __test } = require("../services/chatService");

const { buildDecision, validateDecisionContract, DECISION_PAYLOAD_ACTIONS, resolveAction } = __test;

describe("Decision payload (canonical shape)", () => {
  it("buildDecision fills reasonCode and boolean needsDisambiguation", () => {
    const d = buildDecision({
      action: "knowledge",
      flowId: null,
      missingSlot: null
    });
    expect(d.reasonCode).toBe("routing.knowledge");
    expect(d.needsDisambiguation).toBe(false);
    expect(d.productsReason).toBeNull();
  });

  it("buildDecision preserves explicit reasonCode", () => {
    const d = buildDecision({
      action: "clarification",
      flowId: null,
      missingSlot: "surface",
      reasonCode: "custom.reason"
    });
    expect(d.reasonCode).toBe("custom.reason");
  });

  it("validateDecisionContract accepts flow with flowId", () => {
    expect(
      validateDecisionContract(
        buildDecision({ action: "flow", flowId: "glass_clean_basic", missingSlot: null })
      ).valid
    ).toBe(true);
  });

  it("validateDecisionContract rejects flow without flowId", () => {
    const r = validateDecisionContract(
      buildDecision({ action: "flow", flowId: null, missingSlot: null })
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("flow_missing_flowId");
  });

  it("validateDecisionContract rejects unknown action", () => {
    const r = validateDecisionContract(
      buildDecision({ action: "not_a_real_action", flowId: null, missingSlot: null })
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("invalid_action");
  });

  it("resolveAction returns buildDecision-shaped object with reasonCode", () => {
    const d = resolveAction({
      message: {
        text: "vreau sa curat scaunele",
        routingDecision: { action: "procedural" }
      },
      slots: { context: "interior", object: "seats", surface: "textile" }
    });
    expect(d.action).toBeTruthy();
    expect(typeof d.reasonCode).toBe("string");
    expect(d.reasonCode.length).toBeGreaterThan(3);
    expect(typeof d.needsDisambiguation).toBe("boolean");
  });

  it("DECISION_PAYLOAD_ACTIONS includes core routing actions", () => {
    expect(DECISION_PAYLOAD_ACTIONS.has("flow")).toBe(true);
    expect(DECISION_PAYLOAD_ACTIONS.has("greeting")).toBe(true);
  });
});
