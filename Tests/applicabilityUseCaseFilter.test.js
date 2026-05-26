const { __test } = require("../services/chatService");
const { filterByUseCase, mapRoleToUseCase } = __test;

describe("applicability.use_case product filter", () => {
  test("REGRESSION GUARD — no role resolved (null) → no filtering", () => {
    const products = [
      { id: "p1", name: "A", tags: [], applicability: { use_case: ["wheels_cleaning"] } },
      { id: "p2", name: "B", tags: [], applicability: { use_case: ["tires_dressing"] } },
      { id: "p3", name: "C", tags: [] }
    ];
    const result = filterByUseCase(products, null);
    expect(result).toHaveLength(3);
  });

  test("REGRESSION GUARD — product without applicability → NOT rejected", () => {
    const products = [
      { id: "deferred1", name: "Deferred SKU", tags: [] },
      { id: "wc1", name: "Wheel Cleaner", tags: [], applicability: { use_case: ["wheels_cleaning"] } }
    ];
    const result = filterByUseCase(products, "wheel_cleaner");
    expect(result.some(p => p.id === "deferred1")).toBe(true);
    expect(result.some(p => p.id === "wc1")).toBe(true);
  });

  test("REGRESSION GUARD — product with empty use_case array → NOT rejected", () => {
    const products = [
      { id: "empty1", name: "Empty UC", tags: [], applicability: { use_case: [] } },
      { id: "wc1", name: "Wheel Cleaner", tags: [], applicability: { use_case: ["wheels_cleaning"] } }
    ];
    const result = filterByUseCase(products, "wheel_cleaner");
    expect(result.some(p => p.id === "empty1")).toBe(true);
    expect(result.some(p => p.id === "wc1")).toBe(true);
  });

  test("REGRESSION GUARD — unknown role (\"banana\") → no filtering", () => {
    const products = [
      { id: "p1", name: "A", tags: [], applicability: { use_case: ["wheels_cleaning"] } },
      { id: "p2", name: "B", tags: [], applicability: { use_case: ["exterior_wash"] } }
    ];
    const result = filterByUseCase(products, "banana");
    expect(result).toHaveLength(2);
  });

  test("SKIP — role=\"glass_cleaner\" maps to null → no filtering", () => {
    const products = [
      { id: "ig1", name: "Interior Glass", tags: [], applicability: { use_case: ["interior_glass"] } },
      { id: "eg1", name: "Exterior Glass", tags: [], applicability: { use_case: ["exterior_glass"] } }
    ];
    expect(mapRoleToUseCase("glass_cleaner")).toBeNull();
    const result = filterByUseCase(products, "glass_cleaner");
    expect(result).toHaveLength(2);
  });

  test("SKIP — role=\"microfiber\" maps to null → no filtering (accessory)", () => {
    const products = [
      { id: "any1", name: "Any Product", tags: [], applicability: { use_case: ["exterior_wash"] } },
      { id: "any2", name: "Another", tags: [], applicability: { use_case: ["tools_care"] } }
    ];
    expect(mapRoleToUseCase("microfiber")).toBeNull();
    const result = filterByUseCase(products, "microfiber");
    expect(result).toHaveLength(2);
  });

  test("DIRECT MAPPING — wheel_cleaner → wheels_cleaning: match kept, mismatch rejected", () => {
    const products = [
      { id: "wc1", name: "Wheel Cleaner", tags: [], applicability: { use_case: ["wheels_cleaning"] } },
      { id: "wp1", name: "Wheel Sealant", tags: [], applicability: { use_case: ["wheels_protection"] } }
    ];
    expect(mapRoleToUseCase("wheel_cleaner")).toBe("wheels_cleaning");
    const result = filterByUseCase(products, "wheel_cleaner");
    expect(result.some(p => p.id === "wc1")).toBe(true);
    expect(result.some(p => p.id === "wp1")).toBe(false);
  });

  test("AMBIGUOUS-RESOLVED — bug_remover → exterior_decontamination: match kept, mismatch rejected", () => {
    const products = [
      { id: "dc1", name: "Decontaminant", tags: [], applicability: { use_case: ["exterior_decontamination"] } },
      { id: "ew1", name: "Shampoo", tags: [], applicability: { use_case: ["exterior_wash"] } }
    ];
    expect(mapRoleToUseCase("bug_remover")).toBe("exterior_decontamination");
    const result = filterByUseCase(products, "bug_remover");
    expect(result.some(p => p.id === "dc1")).toBe(true);
    expect(result.some(p => p.id === "ew1")).toBe(false);
  });

  test("MULTI-USE_CASE — leather_cleaner → interior_leather_care: multi-tagged product kept", () => {
    const products = [
      { id: "lc1", name: "Leather+Plastic Care", tags: [], applicability: { use_case: ["interior_leather_care", "interior_plastic_care"] } },
      { id: "tc1", name: "Textile Only", tags: [], applicability: { use_case: ["interior_textile_cleaning"] } }
    ];
    expect(mapRoleToUseCase("leather_cleaner")).toBe("interior_leather_care");
    const result = filterByUseCase(products, "leather_cleaner");
    expect(result.some(p => p.id === "lc1")).toBe(true);
    expect(result.some(p => p.id === "tc1")).toBe(false);
  });
});
