"use strict";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn(() => ({ reply: "", products: [] }))
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");
const { isSlotKnown } = require("../services/slotMetaGate");

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

const LEATHER_CLEANER = {
  id: "lc-777",
  name: "Solutie curatare piele Leather Cleaner Koch Chemie, 500ml",
  tags: ["leather", "leather_cleaner", "cleaner", "cleaning", "interior"],
  stock: 5,
  manufacturerId: "13"
};

const TEXTILE_PRODUCT = {
  id: "textile-1",
  name: "Textile Upholstery Cleaner",
  tags: ["textile", "textile_cleaner", "interior", "cleaning"],
  stock: 5,
  manufacturerId: "13"
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
  }
];

const SHAMPOO_SKU = {
  id: "206010",
  name: "Sampon auto Koch Chemie 206010",
  tags: ["exterior", "paint", "cleaning", "shampoo", "concentrate"],
  stock: 5,
  manufacturerId: 13
};

describe("F48b — selection slot-gap gate (leather/cotiera)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "1";
  });

  it("predicate — surface confirmed + non-empty slot is known", () => {
    expect(
      isSlotKnown({ surface: "confirmed", action: "carried" }, "surface", { surface: "piele" })
    ).toBe(true);
  });

  it("AC1 — leather 2-turn does not re-ask surface at T2 (prod 7925b3bb class)", async () => {
    const sid = `f48b-leather2-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, TEXTILE_PRODUCT];

    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    const result = await handleChat("cotiera", "C1", catalog, sid);
    const log = lastLog();

    expect(log.decision?.missingSlot).not.toBe("surface");
    expect(log.decision?.reasonCode).not.toBe("routing.clarification.slot");
    expect(log.slotMeta?.surface).toMatch(/confirmed|inferred|carried/);
    expect(log.slots?.surface).toBe("piele");
    expect(log.slots?.object).toBe("cotiera");
    expect(String(result?.message || "")).not.toMatch(/textil\s+,\s+piele\s+,\s+plastic|suprafata.*textil.*piele/i);
  });

  it("AC2 — wax 2-turn still recommends (F48 regression guard)", async () => {
    const sid = `f48b-wax2-${Date.now()}`;
    const catalog = [...WAX_SKUS, SHAMPOO_SKU];

    await handleChat("vreau sa dau cu ceara la exterior", "C1", catalog, sid);
    const result = await handleChat("vopsea", "C1", catalog, sid);
    const log = lastLog();

    const gotProducts =
      /recommend|selection/.test(String(log.decision?.action || "")) &&
      (result.products || []).length > 0;
    const notSurfaceClarify =
      log.decision?.missingSlot !== "surface" ||
      log.decision?.reasonCode !== "routing.clarification.slot";

    expect(gotProducts || notSurfaceClarify).toBe(true);
  });

  it("AC4 — surface re-ask suppressed when slotMeta.surface=confirmed and slots.surface set", async () => {
    const sid = `f48b-gate-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, TEXTILE_PRODUCT];

    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    const log = lastLog();
    await handleChat("cotiera", "C1", catalog, sid);
    const t2Log = lastLog();

    expect(log.slotMeta?.surface).toBe("confirmed");
    expect(t2Log.slots?.surface).toBe("piele");
    expect(t2Log.decision?.missingSlot).not.toBe("surface");
    expect(t2Log.decision?.reasonCode).not.toBe("routing.clarification.slot");
  });
});
