const { classifyInteraction } = require("../services/logClassification");

describe("classifyInteraction (Epic 1.1)", () => {
  test("low_signal takes priority", () => {
    const a = classifyInteraction({
      decision: { action: "recommend" },
      products: [],
      pendingQuestion: null,
      message: "vreau produs pentru jante",
      lowSignalDetected: true,
      clarificationEscalated: false,
      clarificationAttemptCount: 0,
      queryType: "selection",
      finalOutputType: "recommendation",
      productsReason: null
    });
    expect(a.failureType).toBe("low_signal");
    expect(a.frictionPoint).toBe("low_signal_detected");
    expect(a.conversionSuccess).toBe(false);
  });

  test("clarification_loop when escalated", () => {
    const a = classifyInteraction({
      decision: { action: "clarification" },
      products: [],
      pendingQuestion: { slot: "object" },
      message: "nu stiu",
      lowSignalDetected: false,
      clarificationEscalated: true,
      clarificationAttemptCount: 1,
      queryType: "procedural",
      finalOutputType: "question",
      productsReason: null
    });
    expect(a.failureType).toBe("clarification_loop");
    expect(a.conversionIntent).toBe(true);
    expect(a.conversionSuccess).toBe(false);
  });

  test("clarification_loop when repeated attempts", () => {
    const a = classifyInteraction({
      decision: { action: "clarification" },
      products: [],
      pendingQuestion: { slot: "surface" },
      message: "interior",
      clarificationEscalated: false,
      clarificationAttemptCount: 2,
      queryType: "procedural",
      finalOutputType: "question",
      productsReason: null
    });
    expect(a.failureType).toBe("clarification_loop");
  });

  test("wrong_flow when flow decision but output type differs", () => {
    const a = classifyInteraction({
      decision: { action: "flow", flowId: "x" },
      products: [{ id: "1" }],
      pendingQuestion: null,
      message: "cum curat tapiteria",
      clarificationEscalated: false,
      clarificationAttemptCount: 0,
      queryType: "procedural",
      finalOutputType: "recommendation",
      productsReason: null
    });
    expect(a.failureType).toBe("wrong_flow");
    expect(a.frictionPoint).toBe("flow_output_type_mismatch");
  });

  test("no_products for recommend with empty products", () => {
    const a = classifyInteraction({
      decision: { action: "recommend" },
      products: [],
      pendingQuestion: null,
      message: "ce imi recomanzi pentru geamuri",
      queryType: "selection",
      finalOutputType: "recommendation",
      productsReason: null
    });
    expect(a.failureType).toBe("no_products");
    expect(a.conversionIntent).toBe(true);
    expect(a.conversionSuccess).toBe(false);
  });

  test("no_products when productsReason is no_matching_products", () => {
    const a = classifyInteraction({
      decision: { action: "knowledge" },
      products: [],
      pendingQuestion: null,
      message: "info",
      queryType: "informational",
      finalOutputType: "knowledge",
      productsReason: "no_matching_products"
    });
    expect(a.failureType).toBe("no_products");
  });

  test("conversionSuccess on recommend with products", () => {
    const a = classifyInteraction({
      decision: { action: "recommend" },
      products: [{ id: "p1" }],
      pendingQuestion: null,
      message: "recomandare anvelope",
      queryType: "selection",
      finalOutputType: "recommendation",
      productsReason: null
    });
    expect(a.failureType).toBeNull();
    expect(a.conversionSuccess).toBe(true);
  });

  test("successful flow output", () => {
    const a = classifyInteraction({
      decision: { action: "flow", flowId: "f1" },
      products: [],
      pendingQuestion: null,
      message: "cum spal mocheta",
      queryType: "procedural",
      finalOutputType: "flow",
      productsReason: null
    });
    expect(a.failureType).toBeNull();
    expect(a.conversionSuccess).toBe(true);
  });
});
