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
const { mergeCarryoverTagsWithAnswer } = require("../services/clarificationAnswerCarryover");
const logger = require("../services/logger");

const WAX_PRODUCT = {
  id: "wax-1",
  name: "Ceara auto lichida Gold Class Carnauba Plus Premium Meguiar's, 473ml",
  tags: ["exterior", "paint", "wax", "protection"],
  stock: 5,
  manufacturerId: 13
};

const SHAMPOO = {
  id: "shampoo-1",
  name: "Sampon Auto Snow Foam Koch Chemie, 1L",
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

function logAt(turnIndex) {
  const call = appendInteractionLine.mock.calls[turnIndex];
  return call ? call[0] : null;
}

describe("Goal B — clarificationAnswerCarryover", () => {
  let logInfoSpy;
  let carryoverEvents;

  beforeEach(() => {
    jest.clearAllMocks();
    carryoverEvents = [];
    logInfoSpy = jest.spyOn(logger, "logInfo").mockImplementation((tag) => {
      if (String(tag).startsWith("CLARIFICATION_CARRYOVER_")) {
        carryoverEvents.push(String(tag));
      }
    });
    process.env.TIER_ONE_GATE_ENABLED = "1";
  });

  afterEach(() => {
    logInfoSpy.mockRestore();
  });

  it("mergeCarryoverTagsWithAnswer drops wax when answer signals cleaning only", () => {
    const merged = mergeCarryoverTagsWithAnswer({
      carryoverTags: ["exterior", "wax", "protection"],
      answerCoreTags: ["cleaning"],
      userMessage: "doar curat",
      slots: { action: "clean" }
    });
    expect(merged).toContain("cleaning");
    expect(merged).not.toContain("wax");
    expect(merged).toContain("exterior");
  });

  it("F42 AC7 — wax 2-turn: object answer preserves protect + wax tags", async () => {
    const sid = `goalb-wax-${Date.now()}`;
    const catalog = [WAX_PRODUCT, SHAMPOO];
    await handleChat("vreau sa dau cu ceara la exterior", "C1", catalog, sid);
    const t1Log = lastLog();
    expect(t1Log.decision?.missingSlot).toBe("object");

    await handleChat("vopseaua", "C1", catalog, sid);
    const log = lastLog();

    expect(log.slots?.action).toBe("protect");
    expect((log.intent?.tags || []).map(String)).toEqual(expect.arrayContaining(["wax"]));
    expect(log.slots?.object).toBe("caroserie");
    if (log.slotMeta?.action) {
      expect(log.slotMeta.action).toBe("carried");
    }
  });

  it("EPIC DoD leather 2-turn — cotiera preserves action clean and surface piele", async () => {
    const sid = `goalb-leather2-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, TEXTILE_PRODUCT];
    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    await handleChat("cotiera", "C1", catalog, sid);
    const log = lastLog();

    expect(log.slots?.action).toBe("clean");
    expect(log.slots?.surface).toBe("piele");
    expect(log.slots?.object).toBe("cotiera");
  });

  it("M1 — 3-turn chained clarify carryover propagation (§3)", async () => {
    const sid = `goalb-leather3-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, TEXTILE_PRODUCT];

    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    const t1Idx = appendInteractionLine.mock.calls.length - 1;
    expect(carryoverEvents).toContain("CLARIFICATION_CARRYOVER_ARMED");

    carryoverEvents.length = 0;

    await handleChat("cotiera", "C1", catalog, sid);
    const t2Log = logAt(t1Idx + 1);
    expect(t2Log.slots?.action).toBe("clean");
    expect(t2Log.slots?.surface).toBe("piele");
    expect(t2Log.slots?.object).toBe("cotiera");
    expect(t2Log.slotMeta?.action).toBe("carried");
    expect(carryoverEvents).toContain("CLARIFICATION_CARRYOVER_ARMED");
    expect(carryoverEvents).toContain("CLARIFICATION_CARRYOVER_HYDRATED");

    carryoverEvents.length = 0;

    await handleChat("piele", "C1", catalog, sid);
    const t3Log = lastLog();
    expect(t3Log.slots?.action).toBe("clean");
    expect(t3Log.slots?.surface).toBe("piele");
    expect(t3Log.slots?.object).toBe("cotiera");
    expect(carryoverEvents).toContain("CLARIFICATION_CARRYOVER_HYDRATED");
  });
});
