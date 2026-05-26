const { resolveFlow, hasCeramicCoatingIntent } = require("../services/flowResolver");

describe("ceramic coating queries route to knowledge, not decontamination flow", () => {
  test("hasCeramicCoatingIntent detects ceramic keywords", () => {
    expect(hasCeramicCoatingIntent("cum se face stratul ceramic pe vopsea?")).toBe(true);
    expect(hasCeramicCoatingIntent("cum se aplica ceramica auto?")).toBe(true);
    expect(hasCeramicCoatingIntent("vreau un coating ceramic")).toBe(true);
    expect(hasCeramicCoatingIntent("protectie ceramica pentru masina")).toBe(true);
  });

  test("hasCeramicCoatingIntent does not trigger for non-ceramic messages", () => {
    expect(hasCeramicCoatingIntent("cum se curata geamurile?")).toBe(false);
    expect(hasCeramicCoatingIntent("vreau solutie pentru jante")).toBe(false);
    expect(hasCeramicCoatingIntent("decontaminare vopsea")).toBe(false);
  });

  test("'cum se face stratul ceramic pe vopsea?' returns knowledge_override, not decontamination_basics", () => {
    const result = resolveFlow({
      intent: "product_guidance",
      message: "cum se face stratul ceramic pe vopsea?",
      slots: { context: "exterior", surface: "paint" }
    });
    expect(result).not.toBeNull();
    expect(result.type).toBe("knowledge_override");
    expect(result.flowId).toBeNull();
  });

  test("'cum se aplica ceramica auto?' returns knowledge_override", () => {
    const result = resolveFlow({
      intent: "product_guidance",
      message: "cum se aplica ceramica auto?",
      slots: { context: "exterior", surface: "paint" }
    });
    expect(result).not.toBeNull();
    expect(result.type).toBe("knowledge_override");
    expect(result.flowId).toBeNull();
  });

  test("REGRESSION: glass flow still resolves for glass queries", () => {
    const result = resolveFlow({
      intent: "product_guidance",
      message: "cum se curata geamurile?",
      slots: { context: "exterior", surface: "glass", object: "glass" }
    });
    expect(result).not.toBeNull();
    expect(result.flowId).toBe("glass_clean_basic");
  });

  test("REGRESSION: wheel flow still resolves for wheel queries", () => {
    const result = resolveFlow({
      intent: "product_guidance",
      message: "vreau sa curat jantele",
      slots: { context: "exterior", surface: "wheels", object: "wheels" }
    });
    expect(result).not.toBeNull();
    expect(result.flowId).toBe("wheel_tire_deep_clean");
  });
});
