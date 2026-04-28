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

  it("includes decontamination_basics candidate for exterior paint decontamination queries", () => {
    const candidates = resolveFlowCandidates({
      intent: "product_guidance",
      message: "vreau decontaminare pentru caroserie",
      slots: { context: "exterior", surface: "paint", object: "caroserie" }
    });

    const flowIds = candidates.map(flow => flow.flowId);
    expect(flowIds).toContain("decontamination_basics");
  });

  it("includes interior_quick_maintenance for interior maintenance queries", () => {
    const candidates = resolveFlowCandidates({
      intent: "product_guidance",
      message: "intretinere rapida interior",
      slots: { context: "interior", surface: "plastic", object: "bord" }
    });

    const flowIds = candidates.map(flow => flow.flowId);
    expect(flowIds).toContain("interior_quick_maintenance");
  });

  it("ranks leather_ink_removal above interior_clean_basic for pix on leather upholstery", () => {
    const message =
      "mi-au scris copiii cu pix pe tapiteria din piele, ce fac?";
    const candidates = resolveFlowCandidates({
      intent: "product_guidance",
      message,
      slots: { context: "interior", surface: "leather", object: "scaun" }
    });

    const flowIds = candidates.map(flow => flow.flowId);
    expect(flowIds).toContain("leather_ink_removal");
    expect(flowIds).toContain("interior_clean_basic");
    expect(flowIds.indexOf("leather_ink_removal")).toBeLessThan(
      flowIds.indexOf("interior_clean_basic")
    );
  });
});