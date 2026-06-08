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
const { handleChat } = require("../services/chatService");
const { shouldArmCarryover } = require("../services/clarificationAnswerCarryover");
const logger = require("../services/logger");

const WAX_PRODUCT = {
  id: "wax-1",
  name: "Ceara auto lichida Gold Class Carnauba Plus Premium Meguiar's, 473ml",
  tags: ["exterior", "paint", "wax", "protection"],
  stock: 5,
  manufacturerId: 13
};

const SHAMPOO_A = {
  id: "shampoo-1",
  name: "Sampon Auto Snow Foam Koch Chemie, 1L",
  tags: ["exterior", "paint", "cleaning", "car_shampoo"],
  stock: 5,
  manufacturerId: 13
};

const SHAMPOO_B = {
  id: "shampoo-2",
  name: "Sampon auto Koch Chemie 206010",
  tags: ["exterior", "paint", "cleaning", "car_shampoo"],
  stock: 5,
  manufacturerId: 13
};

const LEATHER_CLEANER = {
  id: "lc-777",
  name: "Solutie curatare piele Leather Cleaner Koch Chemie, 500ml",
  tags: ["leather", "leather_cleaner", "cleaning", "interior"],
  stock: 5,
  manufacturerId: 13
};

const LEATHER_HYDRATION = {
  id: "lh-1",
  name: "Hidratare piele Leather Care Koch Chemie",
  tags: ["leather", "leather_conditioner", "protection", "interior"],
  stock: 5,
  manufacturerId: 13
};

const TEXTILE_PRODUCT = {
  id: "textile-1",
  name: "Textile Upholstery Cleaner",
  tags: ["textile", "textile_cleaner", "interior", "cleaning"],
  stock: 5,
  manufacturerId: 13
};

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

describe("F46 — intent_level carryover", () => {
  let carryoverEvents;

  beforeEach(() => {
    jest.clearAllMocks();
    carryoverEvents = [];
    jest.spyOn(logger, "logInfo").mockImplementation((tag) => {
      if (String(tag).startsWith("CLARIFICATION_CARRYOVER_")) {
        carryoverEvents.push(String(tag));
      }
    });
    process.env.TIER_ONE_GATE_ENABLED = "1";
  });

  afterEach(() => {
    logger.logInfo.mockRestore();
  });

  it("shouldArmCarryover includes intent_level", () => {
    expect(shouldArmCarryover({ slot: "intent_level", type: "intent_level" })).toBe(true);
    expect(shouldArmCarryover({ slot: "intent_level", type: "confirm_context" })).toBe(false);
  });

  it("AC1 — 3-turn wax: tratament complet returns wax SKU with carried tags", async () => {
    const sid = `f46-wax3-${Date.now()}`;
    const catalog = [WAX_PRODUCT, SHAMPOO_A, SHAMPOO_B];

    await handleChat("vreau sa dau cu ceara la exterior", "C1", catalog, sid);
    carryoverEvents.length = 0;
    let result = await handleChat("vopsea", "C1", catalog, sid);
    let waxLog = lastLog();
    // F47: wax may recommend at T2 once hard filter allows protect lane; carryover still arms on clarify.
    if (waxLog.decision?.missingSlot === "intent_level") {
      expect(carryoverEvents).toContain("CLARIFICATION_CARRYOVER_ARMED");
    }

    const t2Wax =
      /recommend|selection/.test(String(waxLog.decision?.action || "")) &&
      (result.products || []).some((p) => /ceara|wax|carnauba/i.test(String(p.name)));

    if (!t2Wax) {
      carryoverEvents.length = 0;
      result = await handleChat("tratament complet", "C1", catalog, sid);
      waxLog = lastLog();
      expect(carryoverEvents).toContain("CLARIFICATION_CARRYOVER_HYDRATED");
      expect(waxLog.slotMeta?.action).toBe("carried");
    }

    expect((waxLog.intent?.tags || []).map(String)).toEqual(expect.arrayContaining(["wax"]));
    expect(waxLog.output?.productsReason).toBe("strict");
    expect(waxLog.decision?.action).toMatch(/recommend|selection/);

    expect(result.products?.length).toBeGreaterThan(0);
    const names = result.products.map((p) => String(p.name).toLowerCase()).join(" ");
    expect(names).toMatch(/ceara|wax|carnauba/i);
    expect(names).not.toMatch(/sampon|shampoo|snow/i);
  });

  it("AC2 — 3-turn leather recommends at piele with carried tags (F48 skips coverage_role_goal)", async () => {
    const sid = `f46-leather4-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, LEATHER_HYDRATION, TEXTILE_PRODUCT];

    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    await handleChat("cotiera", "C1", catalog, sid);
    carryoverEvents.length = 0;
    const result = await handleChat("piele", "C1", catalog, sid);
    const t3Log = lastLog();

    expect(t3Log.decision?.reasonCode).not.toBe("routing.coverage_role_goal");
    expect(t3Log.decision?.action).toMatch(/recommend|selection/);
    expect((t3Log.intent?.tags || []).map(String)).toEqual(expect.arrayContaining(["leather"]));
    expect(["carried", "inferred"]).toContain(t3Log.slotMeta?.action);
    expect(t3Log.slots?.action).toBe("clean");

    if ((result.products || []).length > 0) {
      const names = result.products.map((p) => String(p.name).toLowerCase()).join(" ");
      expect(names).toMatch(/piele|leather/i);
      expect(names).not.toMatch(/textile|hidratare/i);
    }
  });
});
