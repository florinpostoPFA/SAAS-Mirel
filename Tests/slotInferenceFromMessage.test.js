"use strict";

const {
  inferSlotsFromMessage,
  applyTokenInferenceToSessionSlots,
  normalizeMessageText,
  CANONICAL_SURFACE_VALUES,
  CANONICAL_ACTION_VALUES
} = require("../services/slotInferenceFromMessage");
const { getMissingSlot } = require("../services/slotCompleteness");
const { SLOT_INFERENCE_RULES } = require("../services/slotInferenceRules");

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

  test("scaun → textile + interior", () => {
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

  test("mohair in stare buna does not infer tar decontaminate action", () => {
    const r = infer("ce folosesc pe mohair pentru a-l pastra in stare buna?");
    expect(
      r.matches.some(
        (m) => String(m.token || "").toLowerCase() === "tar" && m.slotKey === "action"
      )
    ).toBe(false);
    expect(r.slotUpdates.action).not.toBe("decontaminate");
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

function simulatePipelineMissingSlot(message, priorSlots = {}) {
  const sessionContext = {
    slots: { ...priorSlots },
    slotMeta: { context: "unknown", surface: "unknown", object: "unknown" },
    objective: { slots: {} }
  };
  const interactionRef = {};
  applyTokenInferenceToSessionSlots({ message, sessionContext, interactionRef });
  return {
    missing: getMissingSlot(sessionContext.slots),
    slots: sessionContext.slots,
    telemetry: interactionRef.tokenInferenceTelemetry
  };
}

describe("slotInferenceFromMessage — friction turns replay (26.05 prod)", () => {
  const FRICTION_TURNS = [
    {
      id: 1,
      message: "recomandare de produse",
      rescued: false,
      note: "no context token — clarification acceptable"
    },
    {
      id: 2,
      message: "recomanda un produs hidrofob",
      rescued: true,
      avoidMissing: "context"
    },
    {
      id: 3,
      message: "recomanda-mi o solutie cu efect hidrofob",
      rescued: true,
      avoidMissing: "context"
    },
    {
      id: 4,
      message: "cum curat urmele de calcar de pe caroseria exterioara",
      rescued: true,
      avoidMissing: "surface"
    },
    {
      id: 5,
      message: "pe vopseaua de la exterior",
      rescued: true,
      avoidMissing: "surface"
    },
    {
      id: 6,
      message: "murdarie usoara",
      rescued: false,
      note: "carry-over out of scope for v0"
    }
  ];

  test("at least 4 of 6 friction turns avoid the targeted clarification slot", () => {
    let rescued = 0;
    for (const turn of FRICTION_TURNS) {
      const { missing } = simulatePipelineMissingSlot(turn.message);
      const ok = turn.rescued
        ? turn.avoidMissing
          ? missing !== turn.avoidMissing
          : missing === null
        : turn.avoidMissing
          ? missing === turn.avoidMissing
          : true;
      if (ok) rescued += 1;
    }
    expect(rescued).toBeGreaterThanOrEqual(4);
  });

  test.each(FRICTION_TURNS.filter((t) => t.rescued))(
    "friction turn $id rescues missing=$avoidMissing",
    (turn) => {
      const { missing } = simulatePipelineMissingSlot(turn.message);
      expect(missing).not.toBe(turn.avoidMissing);
    }
  );
});

describe("slotInferenceFromMessage — audit FN replay (action-verb audit v0)", () => {
  const AUDIT_FN_MESSAGES = [
    { message: "recomanda un produs hidrofob", expectAction: "protect" },
    { message: "recomanda-mi o solutie cu efect hidrofob", expectAction: "protect" },
    { message: "vreau hidrofob pe masina", expectAction: "protect" },
    { message: "ce ceara recomanzi", expectAction: "protect" },
    { message: "vreau ceramica auto", expectAction: "protect" },
    { message: "am nevoie de polish", expectAction: "polish" },
    { message: "lustruire faruri", expectAction: "polish" },
    { message: "intretinere rapida", expectAction: "maintain" },
    { message: "vreau sa protejez vopseaua", expectAction: "protect" },
    { message: "protectie ceramica", expectAction: "protect" }
  ];

  test("at least 7 of 10 audit FN messages infer the expected action verb", () => {
    let hits = 0;
    for (const row of AUDIT_FN_MESSAGES) {
      const { slots } = simulatePipelineMissingSlot(row.message);
      if (slots.action === row.expectAction) hits += 1;
    }
    expect(hits).toBeGreaterThanOrEqual(7);
  });
});

describe("slotInferenceFromMessage — load-time enums", () => {
  test("every rule surface is in the closed Roles Dictionary enum", () => {
    const surfaceSet = new Set(CANONICAL_SURFACE_VALUES);
    for (const rule of SLOT_INFERENCE_RULES) {
      const surface = rule.sets && rule.sets.surface;
      if (surface != null) {
        expect(surfaceSet.has(String(surface).toLowerCase())).toBe(true);
      }
    }
  });

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
