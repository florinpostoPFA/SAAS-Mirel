const {
  selectProducts,
  evaluateRoles,
  passesSlotObjectRole,
  stableProductId
} = require("../services/productSelectionService");

const catalog = [
  {
    id: "p1",
    name: "Wheel cleaner pro",
    tags: ["exterior", "wheel_cleaner", "cleaning"],
    price: 50,
    conversionRate: 0.1
  },
  {
    id: "p2",
    name: "Interior APC",
    tags: ["interior", "cleaning", "apc"],
    price: 40,
    conversionRate: 0.2
  },
  {
    id: "p3",
    name: "Tire shine only",
    tags: ["tire", "exterior"],
    price: 30,
    conversionRate: 0.05
  }
];

describe("productSelectionService", () => {
  it("role gate removes interior-incompatible tire product for interior tags", () => {
    const r = selectProducts({
      tags: ["interior", "cleaning"],
      message: "curat piele",
      catalog,
      limit: 3,
      constraints: { strictTagFilter: false }
    });
    const ids = r.chosen.map((c) => stableProductId(c));
    expect(ids).toContain("p2");
    expect(ids).not.toContain("p3");
  });

  it("slot object jante excludes interior-only SKU", () => {
    const r = selectProducts({
      tags: ["cleaning"],
      message: "jante",
      slots: { object: "jante", context: "exterior" },
      catalog,
      limit: 3,
      constraints: { strictTagFilter: false }
    });
    expect(r.chosen.some((c) => String(c.id) === "p2")).toBe(false);
    expect(r.chosen.some((c) => String(c.id) === "p1")).toBe(true);
  });

  it("ranking order is stable across runs (tie-break by productId)", () => {
    const flat = [
      { id: "b", name: "B", tags: ["exterior"], price: 10, conversionRate: 0 },
      { id: "a", name: "A", tags: ["exterior"], price: 10, conversionRate: 0 }
    ];
    const r1 = selectProducts({
      tags: ["exterior"],
      message: "x",
      catalog: flat,
      limit: 2,
      constraints: { strictTagFilter: false, ranking: true }
    });
    const r2 = selectProducts({
      tags: ["exterior"],
      message: "x",
      catalog: flat,
      limit: 2,
      constraints: { strictTagFilter: false, ranking: true }
    });
    expect(r1.chosen.map((c) => c.id).join(",")).toBe(r2.chosen.map((c) => c.id).join(","));
    expect(r1.chosen[0].id).toBe("a");
  });

  it("hybrid: roles then rank — higher conversion wins among eligible", () => {
    const c = [
      { id: "low", name: "Ext A", tags: ["exterior", "cleaning"], conversionRate: 0.01 },
      { id: "high", name: "Ext B", tags: ["exterior", "cleaning"], conversionRate: 0.5 }
    ];
    const r = selectProducts({
      tags: ["exterior", "cleaning"],
      message: "exterior cleaning",
      catalog: c,
      limit: 2,
      constraints: { strictTagFilter: false }
    });
    expect(r.chosen[0].id).toBe("high");
  });

  it("fallback catalog order when no role pass", () => {
    const impossible = [{ id: "z", name: "Z", tags: ["only_tire"], stock: 0 }];
    const r = selectProducts({
      tags: ["interior"],
      message: "x",
      catalog: impossible,
      limit: 1,
      constraints: { strictTagFilter: false, fallbackStrategy: "relaxed_roles" }
    });
    expect(r.chosen.length).toBe(1);
    expect(r.chosen[0].selectionMeta.fallback).toBe("catalog_order");
  });

  it("ranking disabled uses stable id ordering among candidates", () => {
    const r = selectProducts({
      tags: ["exterior"],
      message: "x",
      catalog: [
        { id: "m", name: "M", tags: ["exterior"] },
        { id: "n", name: "N", tags: ["exterior"] }
      ],
      limit: 2,
      constraints: { strictTagFilter: false, ranking: false }
    });
    expect(r.chosen.map((c) => c.id).join(",")).toBe("m,n");
  });

  it("evaluateRoles documents tag_overlap when strict", () => {
    const ev = evaluateRoles(catalog[1], {
      tags: ["interior"],
      slots: {},
      constraints: { strictTagFilter: true, applyInteriorExteriorFilter: true, applySlotObjectFilter: true }
    });
    expect(ev.ok).toBe(true);
    expect(ev.roleMatches).toContain("tag_overlap");
  });

  it("passesSlotObjectRole false for glass slot on wheel-only product", () => {
    const ok = passesSlotObjectRole(catalog[0], { object: "glass" });
    expect(ok).toBe(false);
  });
});
