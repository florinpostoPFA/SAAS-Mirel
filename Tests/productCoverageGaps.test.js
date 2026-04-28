/**
 * @jest-environment node
 */

const { __test } = require("../services/chatService");
const productRoles = require("../data/product_roles.json");

const catalog = [
  { id: "lc1", name: "Leather cleaner", tags: ["leather", "cleaner", "cleaning", "interior"] },
  { id: "lp1", name: "Leather protectant", tags: ["leather", "protectant", "protection", "dressing", "interior"] },
  { id: "td1", name: "Tire dressing", tags: ["dressing", "tires", "rubber", "protection", "exterior"] },
  { id: "gc1", name: "Glass cleaner", tags: ["glass", "cleaner", "cleaning", "exterior"] },
  { id: "gr1", name: "Rain repellent", tags: ["glass", "sealant", "protection", "rain_repellent", "exterior"] },
  { id: "rs1", name: "Seal protectant", tags: ["rubber", "protectant", "protection", "sealant", "exterior"] },
  { id: "wc1", name: "Wheel cleaner", tags: ["wheel_cleaner", "wheels", "cleaning", "metal", "exterior"] }
];

describe("Product coverage gaps roles/mapping", () => {
  test("role mapping triggers per domain", () => {
    expect(__test.detectCoverageGapRole("Cu ce curăț scaunele de piele?", {}).role).toBe("leather_cleaner");
    expect(__test.detectCoverageGapRole("Vreau să protejez pielea mașinii", {}).role).toBe("leather_protectant");
    expect(__test.detectCoverageGapRole("Vreau un luciu de anvelope", {}).role).toBe("tire_dressing");
    expect(__test.detectCoverageGapRole("Dă-mi ceva pentru geamuri", {}).role).toBe("glass_cleaner");
    expect(__test.detectCoverageGapRole("Vreau ceva hidrofob pentru parbriz", {}).role).toBe("glass_rain_repellent");
    expect(__test.detectCoverageGapRole("Cu ce dau pe chedere să nu mai scârțâie?", {}).role).toBe("rubber_seal_protectant");
  });

  test("leather ambiguous returns deterministic targeted question", () => {
    const out = __test.detectCoverageGapRole("Piele scaune interior", {});
    expect(out.role).toBeNull();
    expect(String(out.ask || "").toLowerCase()).toMatch(/cureti|protejezi|hidratezi/);
  });

  test("strict->relaxed retry happens only for scoped roles", () => {
    const tire = __test.tryCoverageRoleRelaxedRetry("tire_dressing", productRoles.tire_dressing, catalog, {});
    expect(Array.isArray(tire)).toBe(true);
    expect(tire.some((p) => String(p.id) === "td1")).toBe(true);

    const unrelated = __test.tryCoverageRoleRelaxedRetry("wheel_cleaner", productRoles.wheel_cleaner, catalog, {});
    expect(Array.isArray(unrelated)).toBe(true);
    expect(unrelated.length).toBe(0);
  });

  test("fallback copy is deterministic per role", () => {
    expect(__test.roleCoverageFallbackQuestion("leather_cleaner").toLowerCase()).toMatch(/cureti|protejezi|hidratezi/);
    expect(__test.roleCoverageFallbackQuestion("tire_dressing").toLowerCase()).toMatch(/luciu|satinat|mat/);
    expect(__test.roleCoverageFallbackQuestion("glass_cleaner").toLowerCase()).toMatch(/interior|exterior/);
    expect(__test.roleCoverageFallbackQuestion("rubber_seal_protectant").toLowerCase()).toMatch(/scart|intretinere|protectie/);
  });

  test("smoke no regression: unrelated wheel intent remains unaffected", () => {
    const out = __test.detectCoverageGapRole("curatare jante", {});
    expect(out.role).toBeNull();
    expect(out.ask).toBeNull();
  });
});

