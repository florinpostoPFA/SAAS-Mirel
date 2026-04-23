const { resolveFlowCandidates } = require("../services/flowResolver");

describe("Flow resolver gating", () => {
  it("excludes tool_care_towel for normal cleaning surface/object queries", () => {
    const candidates = resolveFlowCandidates({
      intent: "product_guidance",
      message: "vreau sa curat pielea",
      slots: { context: "interior", surface: "leather", object: null }
    });

    const flowIds = candidates.map(flow => flow.flowId);
    expect(flowIds).not.toContain("tool_care_towel");
  });

  it("includes tool_care_towel only with explicit tool-care terms", () => {
    const candidates = resolveFlowCandidates({
      intent: "product_guidance",
      message: "cum spal microfibrele",
      slots: {}
    });

    const flowIds = candidates.map(flow => flow.flowId);
    expect(flowIds).toContain("tool_care_towel");
  });

  it("keeps wheel_tire_deep_clean candidate for wheel cleaning queries", () => {
    const candidates = resolveFlowCandidates({
      intent: "product_guidance",
      message: "cum spal roata",
      slots: { context: "exterior", object: "jante", surface: "wheels" }
    });

    const flowIds = candidates.map(flow => flow.flowId);
    expect(flowIds).toContain("wheel_tire_deep_clean");
  });
});