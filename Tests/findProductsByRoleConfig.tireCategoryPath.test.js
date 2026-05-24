/**
 * Step 5f — categoryPath tire guard (role resolution + slot filter).
 * @jest-environment node
 */
const productRoles = require("../data/product_roles.json");
const {
  USE_CATEGORYPATH_TIRE_GUARD,
  matchesTireCategoryPath,
  productPassesTireCategoryPathGuard,
  applyTireCategoryPathPoolGuard
} = require("../services/categoryPathTireGuard");
const { extractSlotsFromMessage, __test } = require("../services/chatService");

const tireDressingRole = productRoles.tire_dressing;
const wheelCleanerRole = productRoles.wheel_cleaner;

const tirePath =
  "Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri";
const interiorPath =
  "Categorii produse / Produse Interior Auto / Interior / Curățarea interioarelor auto";

const tireProduct = {
  id: "G7516",
  name: "Gel luciu anvelope Endurance Tire Gel, 473ml",
  tags: [],
  categoryPath: tirePath
};

const interiorProduct = {
  id: "G13616",
  name: "Solutie detailing interior Quick Interior Detailer",
  tags: [],
  categoryPath: interiorPath
};

const tireNameOnlyProduct = {
  id: "td-empty",
  name: "Luciu anvelope ZviZZer Wet Gel",
  tags: [],
  categoryPath: ""
};

describe("categoryPathTireGuard module", () => {
  test("matchesTireCategoryPath on main tire leaf", () => {
    expect(matchesTireCategoryPath(tireProduct)).toBe(true);
    expect(matchesTireCategoryPath(interiorProduct)).toBe(false);
  });

  test("empty categoryPath passes product guard (fallback)", () => {
    expect(productPassesTireCategoryPathGuard(tireNameOnlyProduct)).toBe(true);
  });
});

describe("findProductsByRoleConfig + tire categoryPath guard", () => {
  const originalFlag = USE_CATEGORYPATH_TIRE_GUARD;

  afterEach(() => {
    require("../services/categoryPathTireGuard").USE_CATEGORYPATH_TIRE_GUARD = originalFlag;
  });

  test("tire role + tire-path product → in candidate pool", () => {
    const matches = __test.findProductsByRoleConfig(
      tireDressingRole,
      [tireProduct, interiorProduct],
      "tire_dressing"
    );
    expect(matches.some((p) => p.id === "G7516")).toBe(true);
    expect(matches.some((p) => p.id === "G13616")).toBe(false);
  });

  test("tire role + non-tire-path product → not in pool", () => {
    const matches = __test.findProductsByRoleConfig(
      tireDressingRole,
      [interiorProduct],
      "tire_dressing"
    );
    expect(matches.length).toBe(0);
  });

  test("non-tire role → pool guard does not activate", () => {
    const pool = applyTireCategoryPathPoolGuard(
      [tireProduct, interiorProduct],
      { roleId: "wheel_cleaner" }
    );
    expect(pool.length).toBe(2);
  });

  test("tire role + empty categoryPath → name matchText fallback preserved", () => {
    const matches = __test.findProductsByRoleConfig(
      tireDressingRole,
      [tireNameOnlyProduct],
      "tire_dressing"
    );
    expect(matches.some((p) => p.id === "td-empty")).toBe(true);
  });

  test("flag off → tire-path filter not applied", () => {
    require("../services/categoryPathTireGuard").USE_CATEGORYPATH_TIRE_GUARD = false;
    const pool = applyTireCategoryPathPoolGuard(
      [tireProduct, interiorProduct],
      { roleId: "tire_dressing" }
    );
    expect(pool.length).toBe(2);
  });
});

describe("filterProducts tire surface + categoryPath", () => {
  test("drops interior-path SKU for anvelope slots even if description mentions cauciuc", () => {
    const slots = __test.inferWheelsSurfaceFromObject(
      extractSlotsFromMessage("vreau ceva pentru anvelope")
    );
    const interiorRubber = {
      id: "G13616",
      name: "Solutie detailing interior Quick Interior Detailer",
      description: "Curata plastic, piele, vinil, cauciuc, metal — produs interior.",
      tags: [],
      categoryPath: interiorPath
    };
    const after = __test.filterProducts([interiorRubber], slots);
    expect(after.length).toBe(0);
  });

  test("keeps tire-path SKU for anvelope slots", () => {
    const slots = __test.inferWheelsSurfaceFromObject(
      extractSlotsFromMessage("vreau ceva pentru anvelope")
    );
    const after = __test.filterProducts([tireProduct], slots);
    expect(after.length).toBe(1);
    expect(after[0].id).toBe("G7516");
  });
});
