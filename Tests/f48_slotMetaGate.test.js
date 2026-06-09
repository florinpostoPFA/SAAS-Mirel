"use strict";

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
const { getSession, saveSession } = require("../services/sessionStore");
const { handleChat, __test } = require("../services/chatService");
const { returnSelectionFailSafe } = __test;
const {
  isSlotKnown,
  isActionKnown,
  deriveLeatherCoverageRoleFromAction
} = require("../services/slotMetaGate");

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

describe("F48 slotMeta gate predicates", () => {
  it("isSlotKnown accepts confirmed, inferred, carried with non-empty slot value", () => {
    expect(isSlotKnown({ surface: "confirmed" }, "surface", { surface: "piele" })).toBe(true);
    expect(isSlotKnown({ surface: "inferred" }, "surface", { surface: "piele" })).toBe(true);
    expect(isSlotKnown({ surface: "carried" }, "surface", { surface: "piele" })).toBe(true);
  });

  it("isSlotKnown rejects unknown, stale, empty value, or missing meta", () => {
    expect(isSlotKnown({ surface: "unknown" }, "surface", { surface: "piele" })).toBe(false);
    expect(isSlotKnown({ surface: "stale" }, "surface", { surface: "piele" })).toBe(false);
    expect(isSlotKnown({ surface: "confirmed" }, "surface", { surface: "" })).toBe(false);
    expect(isSlotKnown({}, "surface", { surface: "piele" })).toBe(false);
  });

  it("isActionKnown accepts slotMeta carried or concrete slots.action", () => {
    expect(isActionKnown({ action: "carried" }, { action: "clean" })).toBe(true);
    expect(isActionKnown({}, { action: "clean" })).toBe(true);
    expect(isActionKnown({}, { action: "unknown" })).toBe(false);
    expect(isActionKnown({}, {})).toBe(false);
  });

  it("deriveLeatherCoverageRoleFromAction maps clean and protect", () => {
    expect(deriveLeatherCoverageRoleFromAction({ action: "clean" })).toBe("leather_cleaner");
    expect(deriveLeatherCoverageRoleFromAction({ action: "protect" })).toBe("leather_protectant");
    expect(deriveLeatherCoverageRoleFromAction({ action: "wax" })).toBeNull();
  });
});

describe("F48 slotMeta gate — leather E2E", () => {
  it("3-turn vreau sa curat pielea → cotiera → piele recommends without coverage_role_goal", async () => {
    const sid = `f48-leather3-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, TEXTILE_PRODUCT];
    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    let result = await handleChat("cotiera", "C1", catalog, sid);
    let log = lastLog();
    if (!/recommend|selection/.test(String(log.decision?.action || ""))) {
      result = await handleChat("piele", "C1", catalog, sid);
      log = lastLog();
    }

    expect(log.decision.action).toMatch(/recommend|selection/);
    expect(log.decision.reasonCode).not.toBe("routing.coverage_role_goal");
    expect(log.decision.missingSlot).not.toBe("surface");
    expect(log.slots?.action).toBe("clean");
    expect(log.slots?.surface).toBe("piele");
    expect(log.slots?.object).toBe("cotiera");
    expect(log.pendingQuestion).toBeFalsy();
    expect(String(result?.message || "")).not.toMatch(/cureti|protejezi|hidratezi/i);
  });

  it("returnSelectionFailSafe skips f39_gate surface re-ask when slotMeta confirms surface (prod T2)", () => {
    const sid = `f48-failsafe-${Date.now()}`;
    const prodSlots = {
      context: "interior",
      surface: "piele",
      object: "cotiera",
      action: "clean"
    };
    const session = getSession(sid);
    session.slots = { ...prodSlots };
    session.slotMeta = { surface: "confirmed", action: "carried" };
    session.tags = ["interior", "leather", "leather_natural", "leather_synthetic", "cleaning"];
    session.responseLocale = "ro";
    saveSession(sid, session);
    const interactionRef = {
      message: "cotiera",
      sessionId: sid,
      traceId: "f48-trace",
      tags: ["interior", "leather", "cleaning"]
    };
    const result = returnSelectionFailSafe(
      interactionRef,
      sid,
      { action: "selection" },
      { context: "interior", object: "cotiera", action: "clean", surface: null },
      { productsReason: "no_matching_products" }
    );
    const decision = result?.decision || interactionRef?.decision;

    expect(decision?.reasonCode).not.toBe("routing.clarification.f39_gate");
    if (decision?.missingSlot === "surface") {
      expect(decision?.reasonCode).not.toBe("routing.clarification.f39_gate");
    }
  });
});
