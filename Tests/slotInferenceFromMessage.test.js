"use strict";

const {
  inferSlotsFromMessage,
  normalizeMessageText,
  CANONICAL_SURFACE_VALUES,
  CANONICAL_ACTION_VALUES
} = require("../services/slotInferenceFromMessage");

function infer(message, slots = {}, slotMeta = {}) {
  return inferSlotsFromMessage({ message, currentSlots: slots, slotMeta });
}

describe("slotInferenceFromMessage — normalization", () => {
  test("normalizeMessageText strips Romanian diacritics", () => {
    expect(normalizeMessageText("întreținere caroseriei")).toBe("intretinere caroseriei");
  });
});

describe("slotInferenceFromMessage — unit (token categories)", () => {
  test("caroserie → paint + exterior", () => {
    const r = infer("cum curat caroseria exterioara");
    expect(r.slotUpdates.surface).toBe("paint");
    expect(r.slotUpdates.context).toBe("exterior");
    expect(r.tokenInferenceApplied).toBe(true);
  });

  test("hidrofob → exterior context (+ protect action diagonal)", () => {
    const r = infer("recomanda un produs hidrofob");
    expect(r.slotUpdates.context).toBe("exterior");
    expect(r.slotUpdates.action).toBe("protect");
  });

  test("scaun → textile (upholstery) + interior", () => {
    const r = infer("curat scaunele");
    expect(r.slotUpdates.surface).toBe("textile");
    expect(r.slotUpdates.context).toBe("interior");
    expect(r.slotUpdates.action).toBe("clean");
  });

  test("bord → plastic + interior", () => {
    const r = infer("solutie pentru bord");
    expect(r.slotUpdates.surface).toBe("plastic");
    expect(r.slotUpdates.context).toBe("interior");
  });

  test("intretinere → maintain action", () => {
    const r = infer("vreau intretinere rapida");
    expect(r.slotUpdates.action).toBe("maintain");
  });

  test("ceramic → exterior context + protect action", () => {
    const r = infer("coating ceramic pentru masina");
    expect(r.slotUpdates.context).toBe("exterior");
    expect(r.slotUpdates.action).toBe("protect");
  });

  test("lustruire → polish action", () => {
    const r = infer("am nevoie de lustruire");
    expect(r.slotUpdates.action).toBe("polish");
  });

  test("jante → wheels + exterior", () => {
    const r = infer("produse pentru jante");
    expect(r.slotUpdates.surface).toBe("wheels");
    expect(r.slotUpdates.context).toBe("exterior");
  });

  test("aspirare → interior context", () => {
    const r = infer("aspirare habitaclu");
    expect(r.slotUpdates.context).toBe("interior");
  });

  test("argila → exterior + decontaminate", () => {
    const r = infer("decontaminare cu argila");
    expect(r.slotUpdates.context).toBe("exterior");
    expect(r.slotUpdates.action).toBe("decontaminate");
  });
});

describe("slotInferenceFromMessage — traps", () => {
  test("piele din casa → OOD, not interior leather", () => {
    const r = infer("curata piele din casa");
    expect(r.slotUpdates.domain).toBe("out_of_domain");
    expect(r.slotUpdates.surface).toBeUndefined();
    expect(r.slotUpdates.context).toBeUndefined();
    expect(r.skippedReasons).toContain("domain_out_of_scope");
  });

  test("vopsea → exterior paint, not interior", () => {
    const r = infer("pe vopseaua de la exterior");
    expect(r.slotUpdates.surface).toBe("paint");
    expect(r.slotUpdates.context).toBe("exterior");
    expect(r.slotUpdates.context).not.toBe("interior");
  });

  test("geam din apartament → OOD, not exterior glass", () => {
    const r = infer("geam din apartament");
    expect(r.slotUpdates.domain).toBe("out_of_domain");
    expect(r.slotUpdates.surface).toBeUndefined();
    expect(r.skippedReasons).toContain("domain_out_of_scope");
  });
});

describe("slotInferenceFromMessage — slot fill policy", () => {
  test("does not overwrite confirmed fresh slot", () => {
    const r = infer(
      "hidrofob",
      { context: "interior" },
      { context: "confirmed" }
    );
    expect(r.slotUpdates.context).toBeUndefined();
    expect(r.skippedReasons).toContain("slot_already_fresh");
  });

  test("fills null slot when meta allows", () => {
    const r = infer("hidrofob", { context: null }, { context: "unknown" });
    expect(r.slotUpdates.context).toBe("exterior");
  });

  test("overwrites stale-marked slot", () => {
    const r = infer(
      "hidrofob",
      { context: "interior" },
      { context: "stale" }
    );
    expect(r.slotUpdates.context).toBe("exterior");
  });

  test("empty message → no_token_match", () => {
    const r = infer("   ");
    expect(r.tokenInferenceApplied).toBe(false);
    expect(r.skippedReasons).toContain("no_token_match");
  });
});

describe("slotInferenceFromMessage — load-time enums", () => {
  test("canonical surface enum includes CTO + exterior extensions", () => {
    expect(CANONICAL_SURFACE_VALUES).toEqual(
      expect.arrayContaining(["textile", "piele", "plastic", "alcantara", "paint", "glass"])
    );
  });

  test("canonical action enum matches ticket v0", () => {
    expect(CANONICAL_ACTION_VALUES).toEqual([
      "clean",
      "maintain",
      "decontaminate",
      "polish",
      "protect",
      "restore",
      "dress"
    ]);
  });
});
