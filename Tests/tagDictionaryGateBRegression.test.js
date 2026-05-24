/**
 * Gate B regression — five previously failing probe patterns with PR #11-style product tags.
 * @jest-environment node
 */

const { detectTagsByRules } = require("../services/tagService");
const { __test } = require("../services/chatService");
const productRoles = require("../data/product_roles.json");

const TIER_ONE_MFG = "70";

const GATE_B_FIXTURES = [
  {
    id: "leather-03",
    query: "ce balsam Koch Chemie pentru piele auto",
    roleId: "leather_protectant",
    product: {
      id: "77709500",
      name: "Koch Chemie Leather Care",
      manufacturerId: TIER_ONE_MFG,
      tags: [
        "leather_natural",
        "leather_synthetic",
        "conditioning",
        "leather_conditioner",
        "ready_to_use",
        "interior"
      ]
    }
  },
  {
    id: "tires-03",
    query: "ce produs ADBL aveti pentru dressing anvelope",
    roleId: "tire_dressing",
    product: {
      id: "adb-tire-1",
      name: "ADBL Black Tyre Dressing",
      manufacturerId: "13",
      tags: ["tires", "dressing", "tire_dressing", "protection", "exterior", "ready_to_use"]
    }
  },
  {
    id: "wheels-02",
    query: "ce produs Koch Chemie aveti pentru jante cu indicator rosu",
    roleId: "wheel_cleaner",
    product: {
      id: "kc-iron",
      name: "Koch Chemie Reactive Wheel Cleaner",
      manufacturerId: TIER_ONE_MFG,
      tags: ["wheels", "decontamination", "iron_remover", "exterior", "acidic"]
    }
  },
  {
    id: "glass-03",
    query: "solutie Ewocar pentru curatare geamuri fara dungi",
    roleId: "glass_cleaner",
    product: {
      id: "ew-glass",
      name: "Ewocar Glass Cleaner",
      manufacturerId: "92",
      tags: ["glass", "glass_cleaner", "cleaning", "exterior", "ready_to_use"]
    }
  },
  {
    id: "interior_plastic-03",
    query: "ce produs ADBL pentru protectie bord si plastic interior",
    roleId: "interior_plastic_inline",
    roleConfig: {
      matchTags: ["trim_dressing", "plastic_interior", "plastic"],
      matchText: ["plastic interior", "bord", "dressing interior"]
    },
    product: {
      id: "adb-trim",
      name: "ADBL Interior Trim Dressing",
      manufacturerId: "13",
      tags: ["plastic_interior", "trim_dressing", "protection", "interior", "conditioning"]
    }
  }
];

describe("tagDictionary Gate B regression (inline PR #11 tags)", () => {
  it.each(GATE_B_FIXTURES)(
    "$id — findProductsByRoleConfig returns tier-1 candidate",
    ({ roleId, roleConfig, product }) => {
      const role = roleConfig || productRoles[roleId];
      expect(role).toBeDefined();
      const matches = __test.findProductsByRoleConfig(role, [product], roleId);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((p) => String(p.id) === String(product.id))).toBe(true);
    }
  );

  it.each(GATE_B_FIXTURES)(
    "$id — rule tags intersect expanded leather/surface vocab",
    ({ query, product }) => {
      const detected = detectTagsByRules(query, []);
      const productTags = product.tags.map((t) => String(t).toLowerCase());
      const hit = detected.some((t) => productTags.includes(String(t).toLowerCase()));
      const expandedHit = detected.some((t) =>
        product.tags.some((pt) =>
          require("../services/tagDictionary").productTagsSatisfyTag([pt], t)
        )
      );
      expect(hit || expandedHit).toBe(true);
    }
  );

  it.each(GATE_B_FIXTURES)(
    "$id — filterProducts keeps SKU when surface slot set",
    ({ product, roleId }) => {
      const surfaceByRole = {
        leather_protectant: "piele",
        tire_dressing: "tires",
        wheel_cleaner: "wheels",
        glass_cleaner: "glass",
        interior_plastic_inline: "plastic"
      };
      const surface = surfaceByRole[roleId];
      if (!surface) return;
      const context =
        roleId === "leather_protectant" || roleId === "interior_plastic_inline"
          ? "interior"
          : "exterior";
      const filtered = __test.filterProducts([product], {
        context,
        surface
      });
      expect(filtered.some((p) => p.id === product.id)).toBe(true);
    }
  );
});
