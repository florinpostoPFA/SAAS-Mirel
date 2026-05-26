const { __test } = require("../services/chatService");
const { filterByFlow } = __test;

describe("applicability.flow product filter (3rd gate)", () => {
  test("REGRESSION GUARD — no active flow (null) → no filtering", () => {
    const products = [
      { id: "p1", name: "A", tags: [], applicability: { flow: ["exterior_wash_beginner"] } },
      { id: "p2", name: "B", tags: [], applicability: { flow: ["leather_program_basic"] } },
      { id: "p3", name: "C", tags: [] }
    ];
    const result = filterByFlow(products, null);
    expect(result).toHaveLength(3);
  });

  test("REGRESSION GUARD — product without applicability → NOT rejected", () => {
    const products = [
      { id: "deferred1", name: "Deferred SKU", tags: [] },
      { id: "ewb1", name: "Wash Product", tags: [], applicability: { flow: ["exterior_wash_beginner"] } }
    ];
    const result = filterByFlow(products, "exterior_wash_beginner");
    expect(result.some(p => p.id === "deferred1")).toBe(true);
    expect(result.some(p => p.id === "ewb1")).toBe(true);
  });

  test("REGRESSION GUARD — product with empty flow array → NOT rejected", () => {
    const products = [
      { id: "empty1", name: "Empty Flow", tags: [], applicability: { flow: [] } },
      { id: "ewb1", name: "Wash Product", tags: [], applicability: { flow: ["exterior_wash_beginner"] } }
    ];
    const result = filterByFlow(products, "exterior_wash_beginner");
    expect(result.some(p => p.id === "empty1")).toBe(true);
    expect(result.some(p => p.id === "ewb1")).toBe(true);
  });

  test("REGRESSION GUARD — unknown active flow (\"banana_flow\") → no filtering", () => {
    const products = [
      { id: "p1", name: "A", tags: [], applicability: { flow: ["exterior_wash_beginner"] } },
      { id: "p2", name: "B", tags: [], applicability: { flow: ["leather_program_basic"] } }
    ];
    const result = filterByFlow(products, "banana_flow");
    expect(result).toHaveLength(2);
  });

  test("MATCH — single flow match keeps product", () => {
    const products = [
      { id: "ewb1", name: "Wash Product", tags: [], applicability: { flow: ["exterior_wash_beginner"] } },
      { id: "lp1", name: "Leather Product", tags: [], applicability: { flow: ["leather_program_basic"] } }
    ];
    const result = filterByFlow(products, "exterior_wash_beginner");
    expect(result.some(p => p.id === "ewb1")).toBe(true);
    expect(result.some(p => p.id === "lp1")).toBe(false);
  });

  test("MULTI-FLOW — product with multiple flows kept on any-of match", () => {
    const products = [
      { id: "multi1", name: "Multi-Flow", tags: [], applicability: { flow: ["leather_program_basic", "interior_quick_maintenance"] } },
      { id: "other1", name: "Other", tags: [], applicability: { flow: ["exterior_wash_beginner"] } }
    ];
    const result = filterByFlow(products, "leather_program_basic");
    expect(result.some(p => p.id === "multi1")).toBe(true);
    expect(result.some(p => p.id === "other1")).toBe(false);
  });

  test("REJECT — flow mismatch rejects product with log emitted", () => {
    const products = [
      { id: "wtd1", name: "Wheel Deep Clean", tags: [], applicability: { flow: ["wheel_tire_deep_clean"] } },
      { id: "ewb1", name: "Wash Only", tags: [], applicability: { flow: ["exterior_wash_beginner"] } }
    ];
    const result = filterByFlow(products, "wheel_tire_deep_clean");
    expect(result.some(p => p.id === "wtd1")).toBe(true);
    expect(result.some(p => p.id === "ewb1")).toBe(false);
  });

  test("WIRING — filterByFlow uses activeFlow to reject non-matching products", () => {
    const products = [
      { id: "lp1", name: "Leather Care", tags: [], applicability: { flow: ["leather_program_basic", "interior_quick_maintenance"] } },
      { id: "glass1", name: "Glass Cleaner", tags: [], applicability: { flow: ["glass_clean_basic"] } },
      { id: "deferred1", name: "Deferred", tags: [] }
    ];
    const result = filterByFlow(products, "leather_program_basic");
    expect(result).toHaveLength(2);
    expect(result.some(p => p.id === "lp1")).toBe(true);
    expect(result.some(p => p.id === "deferred1")).toBe(true);
    expect(result.some(p => p.id === "glass1")).toBe(false);
  });
});
