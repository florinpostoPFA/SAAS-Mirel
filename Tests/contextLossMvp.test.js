"use strict";

const m = require("../services/contextLossMvp");

describe("contextLossMvp.validateContextForFlow", () => {
  const mk = (surfaceValue, status) =>
    m.buildConversationContextFromSession(
      { surface: surfaceValue },
      { surface: status === "confirmed" ? "confirmed" : "unknown" },
      1,
      {}
    );

  it("ok when surface confirmed and matches surfaceMustBe", () => {
    const r = m.validateContextForFlow("wheel_cleaning", mk("wheels", "confirmed"));
    expect(r).toEqual({ ok: true });
  });

  it("missing surface when value present but not confirmed", () => {
    const r = m.validateContextForFlow("wheel_cleaning", mk("wheels", "inferred"));
    expect(r.ok).toBe(false);
    expect(r.missingSlots).toContain("surface");
  });

  it("invalid when confirmed surface conflicts with flow", () => {
    const r = m.validateContextForFlow("wheel_cleaning", mk("paint", "confirmed"));
    expect(r.ok).toBe(false);
    expect(r.invalidReasons.some(x => x.includes("surface_mismatch"))).toBe(true);
  });

  it("allows wheel_tire_deep_clean when confirmed surface is tires", () => {
    const ctx = m.buildConversationContextFromSession(
      { surface: "tires" },
      { surface: "confirmed" },
      1,
      {}
    );
    expect(m.validateContextForFlow("wheel_tire_deep_clean", ctx).ok).toBe(true);
  });
});

describe("contextLossMvp.detectContextLoss", () => {
  it("repeat_clarification when same slot re-asked within 3 turns and surface not confirmed", () => {
    const ctx = m.buildConversationContextFromSession(
      { surface: "wheels" },
      { surface: "unknown" },
      5,
      {
        historySignals: {
          lastClarificationSlot: "surface",
          lastClarificationTurn: 4,
          repeatedSlotAsksCount: 1
        }
      }
    );
    const d = m.detectContextLoss({
      ctx,
      slotName: "surface",
      routingTurnIndex: 5,
      message: "nu stiu",
      surfaceSlotConfirmed: false
    });
    expect(d).toEqual({ contextLossDetected: true, reason: "repeat_clarification" });
  });

  it("no repeat when last clarification was more than 3 turns ago", () => {
    const ctx = m.buildConversationContextFromSession(
      { surface: "wheels" },
      { surface: "unknown" },
      10,
      {
        historySignals: {
          lastClarificationSlot: "surface",
          lastClarificationTurn: 1
        }
      }
    );
    const d = m.detectContextLoss({
      ctx,
      slotName: "surface",
      routingTurnIndex: 10,
      message: "merge?",
      surfaceSlotConfirmed: false
    });
    expect(d.contextLossDetected).toBe(false);
  });

  it("inconsistency when confirmed wheels and message strongly signals paint", () => {
    const ctx = m.buildConversationContextFromSession(
      { surface: "wheels" },
      { surface: "confirmed" },
      3,
      {}
    );
    const d = m.detectContextLoss({
      ctx,
      slotName: "surface",
      routingTurnIndex: 3,
      message: "vreau polish pe caroserie",
      surfaceSlotConfirmed: true
    });
    expect(d).toEqual({ contextLossDetected: true, reason: "inconsistency" });
  });

  it("no inconsistency when evidence score is below threshold", () => {
    const ctx = m.buildConversationContextFromSession(
      { surface: "wheels" },
      { surface: "confirmed" },
      3,
      {}
    );
    const d = m.detectContextLoss({
      ctx,
      slotName: "surface",
      routingTurnIndex: 3,
      message: "ok",
      surfaceSlotConfirmed: true
    });
    expect(d.contextLossDetected).toBe(false);
  });
});

describe("contextLossMvp.maybeAutoConfirmSurfaceFromMessage", () => {
  it("confirms surface when keywords align with inferred slot", () => {
    const slotMeta = { context: "unknown", surface: "unknown", object: "unknown" };
    m.maybeAutoConfirmSurfaceFromMessage("cum curat jantele", { surface: "wheels" }, slotMeta);
    expect(slotMeta.surface).toBe("confirmed");
  });

  it("does not confirm on weak / empty message", () => {
    const slotMeta = { context: "unknown", surface: "unknown", object: "unknown" };
    m.maybeAutoConfirmSurfaceFromMessage("merge?", { surface: "wheels" }, slotMeta);
    expect(slotMeta.surface).not.toBe("confirmed");
  });

  it("confirms from object pin when follow-up has no surface keywords", () => {
    const slotMeta = { context: "unknown", surface: "unknown", object: "unknown" };
    m.maybeAutoConfirmSurfaceFromMessage(
      "interior",
      { context: "interior", object: "glass" },
      slotMeta
    );
    expect(slotMeta.surface).toBe("confirmed");
  });
});

describe("contextLossMvp.recordClarificationEmitMvp", () => {
  it("increments consecutiveTriggers on recovery", () => {
    const s = { conversationContextMvp: { historySignals: {}, recovery: { active: false } } };
    m.recordClarificationEmitMvp(s, "surface", 2, {
      clarificationType: "recovery",
      contextLossDetected: true,
      reason: "repeat_clarification"
    });
    expect(s.conversationContextMvp.recovery.active).toBe(true);
    expect(s.conversationContextMvp.recovery.consecutiveTriggers).toBe(1);
    m.recordClarificationEmitMvp(s, "surface", 3, {
      clarificationType: "recovery",
      contextLossDetected: true,
      reason: "repeat_clarification"
    });
    expect(s.conversationContextMvp.recovery.consecutiveTriggers).toBe(2);
  });

  it("resets recovery on normal clarification", () => {
    const s = {
      conversationContextMvp: {
        historySignals: {},
        recovery: { active: true, consecutiveTriggers: 2 }
      }
    };
    m.recordClarificationEmitMvp(s, "surface", 4, {
      clarificationType: "normal",
      contextLossDetected: false
    });
    expect(s.conversationContextMvp.recovery.active).toBe(false);
    expect(s.conversationContextMvp.recovery.consecutiveTriggers).toBe(0);
  });
});
