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
const { classifyInteraction } = require("../services/logClassification");

const { applyHardFilter, resolveHardFilterRequiredAny } = __test;

const EXTERIOR_PAINT_RULE = {
  allow: ["paint", "shampoo", "prewash", "bug_remover", "microfiber", "drying_towel", "cleaner"],
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

describe("F47 — exterior|paint protect/wax hard filter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "1";
  });

  describe("resolveHardFilterRequiredAny", () => {
    it("returns wax/sealant/protection for protect intent on exterior|paint", () => {
      expect(
        resolveHardFilterRequiredAny(
          "exterior|paint",
          EXTERIOR_PAINT_RULE,
          PROTECT_SLOTS,
          ["protection"]
        )
      ).toEqual(["wax", "sealant", "protection"]);
    });

    it("returns base shampoo requiredAny for clean intent", () => {
      expect(
        resolveHardFilterRequiredAny(
          "exterior|paint",
          EXTERIOR_PAINT_RULE,
          { ...PROTECT_SLOTS, action: "clean" },
          ["cleaning"]
        )
      ).toEqual(["shampoo", "prewash", "bug_remover"]);
    });

    it("returns base when cleaning action tag wins over protect slot", () => {
      expect(
        resolveHardFilterRequiredAny(
          "exterior|paint",
          EXTERIOR_PAINT_RULE,
          PROTECT_SLOTS,
          ["cleaning", "protection"]
        )
      ).toEqual(["shampoo", "prewash", "bug_remover"]);
    });
  });

  describe("applyHardFilter integration", () => {
    it("accepts wax SKUs on protect intent and rejects shampoo", () => {
      const candidates = [...WAX_SKUS, SHAMPOO_SKU];
      const result = applyHardFilter(candidates, PROTECT_SLOTS, ["protection", "wax"]);

      expect(result.meta.afterCount).toBeGreaterThanOrEqual(2);
      const ids = result.products.map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining(["G7016", "319001"]));
      expect(ids).not.toContain("206010");
    });

    it("keeps shampoo lane for clean intent on exterior|paint", () => {
      const candidates = [...WAX_SKUS.slice(0, 1), SHAMPOO_SKU, SHAMPOO_SKU_B];
      const result = applyHardFilter(
        candidates,
        { context: "exterior", surface: "paint", action: "clean" },
        ["cleaning"]
      );

      expect(result.products.map((p) => p.id)).toContain("206010");
      expect(result.products.map((p) => p.id)).not.toContain("G7016");
    });
  });

  describe("E2E", () => {
    it("AC2 — 3-turn wax returns wax SKU with strict match telemetry", async () => {
      const sid = `f47-wax3-${Date.now()}`;
      const catalog = [...WAX_SKUS.slice(0, 2), SHAMPOO_SKU, SHAMPOO_SKU_B];

      await handleChat("vreau sa dau cu ceara la exterior", "C1", catalog, sid);
      let result = await handleChat("vopsea", "C1", catalog, sid);
      let finalLog = lastLog();

      const t2Wax =
        /recommend|selection/.test(String(finalLog.decision?.action || "")) &&
        (result.products || []).some((p) => /ceara|wax|carnauba|protector/i.test(String(p.name)));

      if (!t2Wax) {
        result = await handleChat("tratament complet", "C1", catalog, sid);
        finalLog = lastLog();
      }

      expect(result.products?.length).toBeGreaterThan(0);
      const names = result.products.map((p) => String(p.name).toLowerCase()).join(" ");
      expect(names).toMatch(/ceara|wax|carnauba|protector/i);
      expect(names).not.toMatch(/sampon|shampoo|snow/i);

      expect(finalLog.output?.productsReason).toBe("strict");
      expect(finalLog.decision?.action).toMatch(/recommend|selection/);
      expect((finalLog.intent?.tags || []).map(String)).toEqual(
        expect.arrayContaining(["wax"])
      );

      const alignment = finalLog.analysis?.conversionAlignment;
      expect(alignment?.actionMatchType).not.toBe("mismatched");
      const tagsMatched = alignment?.tagsMatched || [];
      if (tagsMatched.length > 0) {
        expect(tagsMatched).toEqual(
          expect.arrayContaining([expect.stringMatching(/wax|protection/)])
        );
      }
    });

    it("AC3 — wash flow returns shampoo not wax", async () => {
      const sid = `f47-wash-${Date.now()}`;
      const catalog = [WAX_SKUS[0], SHAMPOO_SKU, SHAMPOO_SKU_B];
      const result = await handleChat(
        "vreau sampon auto pentru spalare exterior vopsea",
        "C1",
        catalog,
        sid
      );
      const log = lastLog();

      expect(result.products?.length).toBeGreaterThan(0);
      const names = result.products.map((p) => String(p.name).toLowerCase()).join(" ");
      expect(names).toMatch(/sampon|shampoo/i);
      expect(names).not.toMatch(/ceara|carnauba/i);

      const alignment = classifyInteraction({
        decision: log.decision,
        products: result.products,
        intentTags: log.intent?.tags || [],
        slots: log.slots,
        productsReason: log.output?.productsReason
      });
      expect(alignment.conversionAlignment.tagsMatched).toEqual(
        expect.arrayContaining(["cleaning"])
      );
    });
  });
});
