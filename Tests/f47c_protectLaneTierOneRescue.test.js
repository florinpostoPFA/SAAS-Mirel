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
const { analyzeProductMatch } = require("../services/search");

const TIER_ONE_IDS = [13, 39, 44, 70, 92];
const LANE_TAGS = ["exterior", "paint", "wax", "protection"];
const CATALOG_DESC =
  "Ceara auto lichida pentru vopsea exterior, protectie si luciu de durata.";

const MEGUIARS_WAX_A = {
  id: "MEG-WAX-A",
  name: "Meguiar's Ultimate Liquid Wax A",
  tags: LANE_TAGS,
  short_description: CATALOG_DESC,
  stock: 5,
  manufacturerId: 9,
  conversionRate: 0.99
};

const MEGUIARS_WAX_B = {
  id: "MEG-WAX-B",
  name: "Meguiar's Ultimate Liquid Wax B",
  tags: LANE_TAGS,
  short_description: CATALOG_DESC,
  stock: 5,
  manufacturerId: 9,
  conversionRate: 0.98
};

const TIER1_WAX_A = {
  id: "319001",
  name: "Pw ProtectorWax Koch Chemie, 1L",
  tags: LANE_TAGS,
  short_description: CATALOG_DESC,
  stock: 5,
  manufacturerId: 13,
  conversionRate: 0.7
};

const TIER1_WAX_B = {
  id: "ADB000125",
  name: "Ceara auto lichida ADBL Synthetic Spray Wax 500ml",
  tags: [...LANE_TAGS, "ready_to_use"],
  short_description: CATALOG_DESC,
  stock: 5,
  manufacturerId: 92,
  conversionRate: 0.65
};

const TIER1_WAX_C = {
  id: "422OZ32",
  name: "Ceara auto lichida 3D Poxy Montan Wax, 946ml",
  tags: [...LANE_TAGS, "wet_look"],
  short_description: CATALOG_DESC,
  stock: 5,
  manufacturerId: 39,
  conversionRate: 0.6
};

const SHAMPOO_SKU = {
  id: "206010",
  name: "Sampon auto Koch Chemie 206010",
  tags: ["exterior", "paint", "cleaning", "shampoo", "concentrate"],
  short_description: "Sampon auto concentrat pentru spalare exterior vopsea, spuma activa.",
  stock: 5,
  manufacturerId: 13
};

const SHAMPOO_SKU_B = {
  id: "ADB000134",
  name: "Sampon auto ADBL Snowball 1L",
  tags: ["exterior", "paint", "cleaning", "shampoo", "ph_neutral"],
  short_description: "Sampon auto pH neutru pentru spalare exterior vopsea, formula Snowball.",
  stock: 5,
  manufacturerId: 92
};

const LEATHER_CLEANER = {
  id: "lc-777",
  name: "Solutie curatare piele Leather Cleaner Koch Chemie, 500ml",
  tags: ["leather", "leather_cleaner", "cleaner", "cleaning", "interior"],
  short_description: "Solutie curatare piele pentru interior auto, formula delicata pentru piele.",
  stock: 5,
  manufacturerId: 13
};

const WAX_CATALOG = [
  MEGUIARS_WAX_A,
  MEGUIARS_WAX_B,
  TIER1_WAX_A,
  TIER1_WAX_B,
  TIER1_WAX_C,
  SHAMPOO_SKU,
  SHAMPOO_SKU_B
];

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

function hasLaneProtectTag(tags) {
  const normalized = (tags || []).map((t) => String(t).toLowerCase());
  return normalized.includes("paint") && normalized.some((t) => ["wax", "sealant", "protection"].includes(t));
}

function expectedScoreRank(ids, selectionTags, catalog) {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return [...ids]
    .map((id) => {
      const product = byId.get(id);
      return { id, score: analyzeProductMatch(product, selectionTags).score };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => row.id);
}

describe("F47c — protect lane tier-1 rescue (E3)", () => {
  let rescueSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "1";
    rescueSpy = jest.spyOn(__test.protectLaneTierOneRescue, "run");
  });

  afterEach(() => {
    rescueSpy.mockRestore();
  });

  it("wax 2-turn T2 returns tier-1 wax SKU with productsReason=strict", async () => {
    const sid = `f47c-wax2-${Date.now()}`;

    await handleChat("vreau sa dau cu ceara la exterior", "C1", WAX_CATALOG, sid);
    const result = await handleChat("vopsea", "C1", WAX_CATALOG, sid);
    const log = lastLog();

    expect(rescueSpy).toHaveBeenCalled();
    expect(result.products?.length).toBeGreaterThan(0);
    expect(log.output?.productsReason).toBe("strict");

    const returned = result.products[0];
    expect(TIER_ONE_IDS).toContain(Number(returned.manufacturerId));
    expect(hasLaneProtectTag(returned.tags)).toBe(true);
  });

  it("rescue pool returns score-ranked top-3 (not arbitrary order)", () => {
    const selectionTags = ["paint", "exterior", "wax"];
    const rescued = __test.rescueProtectLaneTierOneCandidates(
      WAX_CATALOG,
      selectionTags,
      PROTECT_SLOTS,
      ["protection", "wax"],
      "vopsea",
      {}
    );

    expect(rescued.length).toBeGreaterThan(0);
    expect(rescued.length).toBeLessThanOrEqual(3);

    const rescuedIds = rescued.map((p) => p.id);
    const scoreRankedIds = expectedScoreRank(rescuedIds, selectionTags, WAX_CATALOG);
    expect(rescuedIds).toEqual(scoreRankedIds);

    for (let i = 1; i < rescued.length; i++) {
      const prev = analyzeProductMatch(rescued[i - 1], selectionTags).score;
      const curr = analyzeProductMatch(rescued[i], selectionTags).score;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("cleaning lane probe — shampoo does not invoke rescue", async () => {
    const sid = `f47c-wash-${Date.now()}`;
    const catalog = [MEGUIARS_WAX_A, TIER1_WAX_A, SHAMPOO_SKU, SHAMPOO_SKU_B];

    const result = await handleChat(
      "vreau sampon auto pentru spalare exterior vopsea",
      "C1",
      catalog,
      sid
    );

    expect(rescueSpy).not.toHaveBeenCalled();
    expect(result.products?.length).toBeGreaterThan(0);
    const names = result.products.map((p) => String(p.name).toLowerCase()).join(" ");
    expect(names).toMatch(/sampon|shampoo/i);
    expect(names).not.toMatch(/ceara|carnauba/i);
  });

  it("leather lane probe — cotiera does not invoke rescue", async () => {
    const sid = `f47c-leather-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, TIER1_WAX_A];

    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    await handleChat("cotiera", "C1", catalog, sid);
    const log = lastLog();

    expect(rescueSpy).not.toHaveBeenCalled();
    expect(log.decision?.missingSlot).not.toBe("surface");
    expect(log.slots?.surface).toBe("piele");
  });

  it("non-protect exterior|paint (clean intent) does not invoke rescue", async () => {
    const sid = `f47c-clean-${Date.now()}`;
    const catalog = [MEGUIARS_WAX_A, TIER1_WAX_A, SHAMPOO_SKU, SHAMPOO_SKU_B];

    await handleChat(
      "vreau sampon auto pentru spalare exterior vopsea",
      "C1",
      catalog,
      sid
    );

    expect(rescueSpy).not.toHaveBeenCalled();
  });

  it("rescue invoked iff exterior|paint + protect + tier-one wipe", async () => {
    const sid = `f47c-spy-${Date.now()}`;

    await handleChat("vreau sa dau cu ceara la exterior", "C1", WAX_CATALOG, sid);
    await handleChat("vopsea", "C1", WAX_CATALOG, sid);

    expect(rescueSpy).toHaveBeenCalledTimes(1);
    expect(rescueSpy.mock.calls[0][0]).toBe(WAX_CATALOG);
    expect(rescueSpy.mock.calls[0][2]).toMatchObject({ action: "protect", surface: "paint" });
  });
});
