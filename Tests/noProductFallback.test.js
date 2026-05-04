const { selectProducts } = require("../services/productSelectionService");

describe("EPIC 2.1 no-product fallback", () => {
  test("relaxed retry ignores object filter when initial pass is empty", () => {
    const catalog = [
      {
        id: "apc-1",
        name: "APC Interior Safe",
        description: "Curatare universala blanda.",
        tags: ["apc", "interior", "cleaning"],
        stock: 10
      }
    ];

    const result = selectProducts({
      tags: ["glass"],
      message: "ce produs pentru geamuri",
      slots: { object: "glass", context: "exterior" },
      catalog,
      limit: 1,
      constraints: {
        strictTagFilter: true,
        fallbackStrategy: "relaxed_roles"
      }
    });

    expect(result.chosen.length).toBe(1);
    expect(result.chosen[0].id).toBe("apc-1");
    expect(result.chosen[0].selectionMeta.fallback).toBe("relaxed_roles");
  });

  test("when no role pass and relaxed is disabled, fallback suggests generic APC", () => {
    const catalog = [
      {
        id: "safe-apc",
        name: "APC Universal Cleaner",
        description: "All purpose cleaner safe pe suprafete variate.",
        tags: ["apc", "cleaning"],
        stock: 5
      }
    ];

    const result = selectProducts({
      tags: ["glass"],
      message: "ce produs pentru geamuri",
      slots: { object: "glass" },
      catalog,
      limit: 1,
      constraints: {
        strictTagFilter: true,
        fallbackStrategy: "none"
      }
    });

    expect(result.chosen.length).toBe(1);
    expect(result.chosen[0].id).toBe("safe-apc");
    expect(result.chosen[0].selectionMeta.fallback).toBe("safe_generic_apc");
    expect(result.chosen[0].reasons).toContain("fallback:safe_generic_apc");
  });
});

