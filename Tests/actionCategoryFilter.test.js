const {
  selectProducts,
  evaluateRoles,
  passesActionCategoryGate,
  filterByActionCategory
} = require("../services/productSelectionService");
const { dropStrictFilterNoise } = require("../services/tagNormalization");
const { extractActionCategoryTags } = require("../services/clarificationFirstPolicy");
const { handleChat } = require("../services/chatService");

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { appendInteractionLine } = require("../services/interactionLog");

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

const WAX_PRODUCT = {
  id: "wax-1",
  name: "Ceara auto lichida Gold Class Carnauba Plus, 473ml",
  tags: ["exterior", "paint", "wax", "protection"],
  stock: 5,
  manufacturerId: "13"
};

const GLASS_CLEANER = {
  id: "gc-1",
  name: "Solutie curatare sticla Speed Glass Cleaner Koch Chemie, 750ml",
  tags: ["exterior", "glass", "glass_cleaner", "cleaning"],
  stock: 5,
  manufacturerId: "13"
};

const LEATHER_CLEANER = {
  id: "lc-1",
  name: "Solutie curatare piele Leather Cleaner Koch Chemie, 500ml",
  tags: ["leather", "leather_cleaner", "cleaner", "cleaning", "interior"],
  stock: 5,
  manufacturerId: "13"
};

const LEATHER_HYDRATION = {
  id: "77709500",
  name: "Solutie hidratare piele Protect Leather Care Koch Chemie, 500ml",
  description: "Hidratare si protectie dupa curatare.",
  tags: ["leather", "leather_conditioner", "protection", "interior"],
  stock: 5,
  manufacturerId: "13"
};

describe("F36-2b action category filter unit", () => {
  it("actionFilter_strictTagFilter_actionTagSurvives — cleaning not stripped (Gap A)", () => {
    expect(dropStrictFilterNoise(["interior", "cleaning", "wax"])).toEqual(["cleaning", "wax"]);
    expect(extractActionCategoryTags(["interior", "cleaning", "leather"])).toContain("cleaning");
  });

  it("actionFilter_waxGate_excludesGlassCleaner (Gap B)", () => {
    expect(passesActionCategoryGate(WAX_PRODUCT, ["wax"])).toBe(true);
    expect(passesActionCategoryGate(GLASS_CLEANER, ["wax"])).toBe(false);
    const filtered = filterByActionCategory([GLASS_CLEANER, WAX_PRODUCT], ["wax"]);
    expect(filtered.map((p) => p.id)).toEqual(["wax-1"]);
  });

  it("actionFilter_cleaningGate_excludesHydrationOnly (Gap B)", () => {
    expect(passesActionCategoryGate(LEATHER_CLEANER, ["cleaning"])).toBe(true);
    expect(passesActionCategoryGate(LEATHER_HYDRATION, ["cleaning"])).toBe(false);
  });

  it("actionFilter_noActionTag_noChange — regression without action tags", () => {
    const ev = evaluateRoles(GLASS_CLEANER, {
      tags: ["exterior", "glass"],
      slots: {},
      constraints: { strictTagFilter: false, actionTags: [] }
    });
    expect(ev.ok).toBe(true);
  });

  it("selectProducts with wax action returns wax SKU only", () => {
    const r = selectProducts({
      tags: ["exterior", "wax"],
      message: "vreau ceara la exterior",
      catalog: [GLASS_CLEANER, WAX_PRODUCT],
      limit: 2,
      constraints: { strictTagFilter: true, actionTags: ["wax"] }
    });
    expect(r.chosen.map((p) => p.id)).toEqual(["wax-1"]);
  });
});

describe("F36-2b action category filter E2E", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "0";
  });

  it("actionFilter_emptyAfterFilter_routesToF39", async () => {
    const sid = `f36b-f39-${Date.now()}`;
    const reply = await handleChat(
      "recomanda o solutie pentru un scaun de piele murdar",
      "C1",
      [LEATHER_HYDRATION],
      sid
    );
    const log = lastLog();
    const msg = String(reply.message || reply.reply || "");
    expect(log.decision.action).toBe("clarification");
    expect(["zero_results", "both", "slots_missing"]).toContain(log.clarificationGateReason);
    expect(msg).toMatch(/potrivire exactă|extind căutarea|marca/i);
  });
});
