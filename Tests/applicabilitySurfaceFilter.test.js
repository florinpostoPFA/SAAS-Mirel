/**
 * Wire applicability.material_compatibility into surface-slot product filtering.
 * @jest-environment node
 */

const { __test } = require("../services/chatService");
const { filterProducts, mapSlotSurfaceToCompatEnum } = __test;

describe("applicability.material_compatibility surface-slot filter", () => {
  // ─── Mapping tests ───

  test("MAPPING — piele maps to leather: keeps leather-compat product, rejects glass-only", () => {
    const products = [
      { id: "lc1", name: "Leather care", tags: ["leather"], applicability: { material_compatibility: ["leather", "textile"] } },
      { id: "gc1", name: "Glass cleaner", tags: ["leather"], applicability: { material_compatibility: ["glass"] } }
    ];
    const result = filterProducts(products, { surface: "piele" });
    expect(result.some(p => p.id === "lc1")).toBe(true);
    expect(result.some(p => p.id === "gc1")).toBe(false);
  });

  test("MAPPING — tires maps to rubber: keeps rubber-compat product, rejects paint-only", () => {
    const products = [
      { id: "td1", name: "Tire dressing", tags: ["tires"], applicability: { material_compatibility: ["rubber"] } },
      { id: "pp1", name: "Paint polish", tags: ["tires"], applicability: { material_compatibility: ["paint"] } }
    ];
    const result = filterProducts(products, { surface: "tires" });
    expect(result.some(p => p.id === "td1")).toBe(true);
    expect(result.some(p => p.id === "pp1")).toBe(false);
  });

  test("MAPPING — wheels no-ops: all products kept regardless of material_compatibility", () => {
    const products = [
      { id: "wc1", name: "Wheel cleaner", tags: ["wheels"], applicability: { material_compatibility: ["glass"] } },
      { id: "wc2", name: "Wheel sealant", tags: ["wheels"], applicability: { material_compatibility: ["metal"] } }
    ];
    const result = filterProducts(products, { surface: "wheels" });
    expect(result.some(p => p.id === "wc1")).toBe(true);
    expect(result.some(p => p.id === "wc2")).toBe(true);
  });

  test("DEFENSIVE — unknown slot value no-ops: all products kept", () => {
    const products = [
      { id: "x1", name: "Something", tags: ["exterior"], applicability: { material_compatibility: ["paint"] } },
      { id: "x2", name: "Another", tags: ["exterior"], applicability: { material_compatibility: ["glass"] } }
    ];
    const result = filterProducts(products, { surface: "banana" });
    expect(result.some(p => p.id === "x1")).toBe(true);
    expect(result.some(p => p.id === "x2")).toBe(true);
  });

  // ─── Graceful no-op for missing applicability ───

  test("GRACEFUL — product without applicability is kept (deferred SKU)", () => {
    const products = [
      { id: "d1", name: "Deferred product", tags: ["leather"] }
    ];
    const result = filterProducts(products, { surface: "piele" });
    expect(result.some(p => p.id === "d1")).toBe(true);
  });

  test("GRACEFUL — product with empty material_compatibility is kept", () => {
    const products = [
      { id: "e1", name: "Empty compat", tags: ["leather"], applicability: { material_compatibility: [] } }
    ];
    const result = filterProducts(products, { surface: "leather" });
    expect(result.some(p => p.id === "e1")).toBe(true);
  });
});
