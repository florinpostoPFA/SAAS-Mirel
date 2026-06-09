"use strict";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue(
    "Îți recomand un produs potrivit, aplicat pe suprafață rece conform etichetei."
  )
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn(() => ({ reply: "", products: [] }))
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat, __test } = require("../services/chatService");
const {
  applyHardFilter,
  resolveHardFilterRequiredAny,
  resolveHardFilterRequiredAllCombos
} = __test;

const EXTERIOR_PAINT_RULE = {
  allow: [
    "paint", "shampoo", "prewash", "bug_remover", "microfiber", "drying_towel", "cleaner",
    "wax", "sealant", "protection"
  ],
  requiredAny: ["shampoo", "prewash", "bug_remover"],
  requiredAllCombos: [["paint", "cleaner"]],
  exclude: ["textile", "leather", "interior"]
};

const WAX_SKUS = [
  {
    id: "G7016",
    name: "Ceara auto lichida Gold Class Carnauba Plus Premium Meguiar's, 473ml",
    tags: ["exterior", "paint", "protection", "wax"],
    stock: 5,
    manufacturerId: 13
  },
  {
    id: "319001",
    name: "Pw ProtectorWax Koch Chemie, 1L",
    tags: ["exterior", "paint", "protection", "wax"],
    stock: 5,
    manufacturerId: 13
  },
  {
    id: "422OZ32",
    name: "Ceara auto lichida 3D Poxy Montan Wax, 946ml",
    tags: ["exterior", "paint", "protection", "wax", "wet_look"],
    stock: 5,
    manufacturerId: 63
  },
  {
    id: "ADB000125",
    name: "Ceara auto lichida ADBL Synthetic Spray Wax 500ml",
    tags: ["exterior", "paint", "protection", "wax", "ready_to_use"],
    stock: 5,
    manufacturerId: 92
  }
];

const WAX_NO_PAINT_TAG = {
  id: "WAXNP1",
  name: "Pure sealant wax exterior",
  tags: ["exterior", "protection", "wax", "sealant"],
  stock: 5,
  manufacturerId: 13
};

const SHAMPOO_SKU = {
  id: "206010",
  name: "Sampon auto Koch Chemie 206010",
  tags: ["exterior", "paint", "cleaning", "shampoo", "concentrate"],
  stock: 5,
  manufacturerId: 13
};

const SHAMPOO_SKU_B = {
  id: "77702750",
  name: "Sampon auto cu nano protectie Nano Magic Shampoo Koch Chemie, 750ml",
  tags: ["exterior", "paint", "cleaning", "shampoo", "ph_neutral", "concentrate"],
  stock: 5,
  manufacturerId: 13
};

const PROTECT_SLOTS = {
  context: "exterior",
  surface: "paint",
  object: "caroserie",
  action: "protect"
};

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

describe("F47b — wax allow + requiredAllCombos gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "1";
  });

  describe("resolveHardFilterRequiredAllCombos", () => {
    it("returns paint+cleaner combo only for cleaning intent on exterior|paint", () => {
      expect(
        resolveHardFilterRequiredAllCombos(
          "exterior|paint",
          EXTERIOR_PAINT_RULE,
          { ...PROTECT_SLOTS, action: "clean" },
          ["cleaning"]
        )
      ).toEqual([["paint", "cleaner"]]);

      expect(
        resolveHardFilterRequiredAllCombos(
          "exterior|paint",
          EXTERIOR_PAINT_RULE,
          PROTECT_SLOTS,
          ["protection", "wax"]
        )
      ).toEqual([]);
    });
  });

  describe("applyHardFilter — allow + combo gates", () => {
    it("accepts wax SKU without paint tag via wax allow lane on protect intent", () => {
      const result = applyHardFilter(
        [WAX_NO_PAINT_TAG, SHAMPOO_SKU],
        PROTECT_SLOTS,
        ["protection", "wax"]
      );

      expect(result.products.map((p) => p.id)).toContain("WAXNP1");
      expect(result.products.map((p) => p.id)).not.toContain("206010");
      expect(result.meta.requiredAllCombos).toEqual([]);
    });

    it("rejects wax on clean intent via requiredAllCombos paint+cleaner", () => {
      const result = applyHardFilter(
        [WAX_SKUS[0], SHAMPOO_SKU],
        { context: "exterior", surface: "paint", action: "clean" },
        ["cleaning"]
      );

      expect(result.products.map((p) => p.id)).toContain("206010");
      expect(result.products.map((p) => p.id)).not.toContain("G7016");
    });
  });

  describe("E2E", () => {
    it("AC1 — 2-turn wax returns wax SKU with productsReason=strict", async () => {
      const sid = `f47b-wax2-${Date.now()}`;
      const catalog = [...WAX_SKUS, SHAMPOO_SKU, SHAMPOO_SKU_B];

      await handleChat("vreau sa dau cu ceara la exterior", "C1", catalog, sid);
      const result = await handleChat("vopsea", "C1", catalog, sid);
      const log = lastLog();

      expect(result.products?.length).toBeGreaterThan(0);
      const ids = result.products.map((p) => p.id);
      expect(ids.some((id) => ["G7016", "319001", "422OZ32", "ADB000125"].includes(id))).toBe(true);
      expect(log.output?.productsReason).toBe("strict");
      expect(log.decision?.action).toMatch(/recommend|selection/);
    });

    it("AC2 — 3-turn wax returns wax SKU at T3 (F46 carryover preserved)", async () => {
      const sid = `f47b-wax3-${Date.now()}`;
      const catalog = [...WAX_SKUS.slice(0, 2), SHAMPOO_SKU, SHAMPOO_SKU_B];

      await handleChat("vreau sa dau cu ceara la exterior", "C1", catalog, sid);
      let result = await handleChat("vopsea", "C1", catalog, sid);
      let log = lastLog();

      const t2Wax =
        /recommend|selection/.test(String(log.decision?.action || "")) &&
        (result.products || []).some((p) => /ceara|wax|carnauba|protector/i.test(String(p.name)));

      if (!t2Wax) {
        result = await handleChat("tratament complet", "C1", catalog, sid);
        log = lastLog();
      }

      expect(result.products?.length).toBeGreaterThan(0);
      const names = result.products.map((p) => String(p.name).toLowerCase()).join(" ");
      expect(names).toMatch(/ceara|wax|carnauba|protector/i);
      expect(log.output?.productsReason).toBe("strict");
      expect((log.intent?.tags || []).map(String)).toEqual(expect.arrayContaining(["wax"]));
    });

    it("AC3 — shampoo regression stays on shampoo lane", async () => {
      const sid = `f47b-wash-${Date.now()}`;
      const catalog = [WAX_SKUS[0], SHAMPOO_SKU, SHAMPOO_SKU_B];
      const result = await handleChat(
        "vreau sampon auto pentru spalare exterior vopsea",
        "C1",
        catalog,
        sid
      );

      expect(result.products?.length).toBeGreaterThan(0);
      const names = result.products.map((p) => String(p.name).toLowerCase()).join(" ");
      expect(names).toMatch(/sampon|shampoo/i);
      expect(names).not.toMatch(/ceara|carnauba/i);
    });
  });
});
