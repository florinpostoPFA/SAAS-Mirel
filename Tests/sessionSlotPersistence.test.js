"use strict";

const chatService = require("../services/chatService");
const { applyDeterministicSessionResetInPlace } = chatService.__test;
const { applyTokenInferenceToSessionSlots } = require("../services/slotInferenceFromMessage");

describe("session slot persistence (F34)", () => {
  it("persists_context_surface_object_across_turns_without_reprompt", () => {
    const sessionContext = {
      slots: { context: "interior", surface: "leather", object: "scaun_auto" },
      slotMeta: { context: "confirmed", surface: "confirmed", object: "confirmed" }
    };
    const interactionRef = {};

    applyTokenInferenceToSessionSlots({
      message: "am noroi pe el",
      sessionContext,
      interactionRef
    });

    expect(sessionContext.slots.context).toBe("interior");
    expect(sessionContext.slots.surface).toBe("leather");
    expect(sessionContext.slots.object).toBe("scaun_auto");
    expect((interactionRef.tokenInferenceTelemetry || {}).tokenInferenceApplied).toBe(false);
  });

  it("merges_new_slot_on_top_of_existing_slot_set", () => {
    const sessionContext = {
      slots: { context: "interior", surface: "textile", object: "scaun_auto" },
      slotMeta: { context: "confirmed", surface: "confirmed", object: "confirmed", action: "unknown" }
    };

    applyTokenInferenceToSessionSlots({
      message: "vreau sa curat",
      sessionContext
    });

    expect(sessionContext.slots.context).toBe("interior");
    expect(sessionContext.slots.surface).toBe("textile");
    expect(sessionContext.slots.object).toBe("scaun_auto");
    expect(sessionContext.slots.action).toBe("clean");
  });

  it("no_token_match_does_not_null_existing_slots", () => {
    const sessionContext = {
      slots: { context: "interior", surface: "leather", object: "scaun_auto" },
      slotMeta: { context: "confirmed", surface: "confirmed", object: "confirmed" }
    };
    const interactionRef = {};

    applyTokenInferenceToSessionSlots({
      message: "hmm ok",
      sessionContext,
      interactionRef
    });

    expect(sessionContext.slots.context).toBe("interior");
    expect(sessionContext.slots.surface).toBe("leather");
    expect(sessionContext.slots.object).toBe("scaun_auto");
    expect(interactionRef.tokenInferenceTelemetry?.tokenInferenceSkippedReasons).toContain("no_token_match");
  });

  it("validator_or_explicit_reset_is_only_slot_nullification_path", () => {
    const sessionContext = {
      slots: { context: "interior", surface: "leather", object: "scaun_auto", action: "clean" },
      slotMeta: { context: "confirmed", surface: "confirmed", object: "confirmed", action: "confirmed" }
    };
    const interactionRef = {};

    applyTokenInferenceToSessionSlots({
      message: "ce recomanzi?",
      sessionContext,
      interactionRef
    });

    expect(sessionContext.slots.surface).toBe("leather");
    expect(sessionContext.slots.object).toBe("scaun_auto");

    applyDeterministicSessionResetInPlace(
      sessionContext,
      "f34-explicit-reset",
      "reset.new_root_query",
      "vreau sa spal masina complet"
    );
    expect(sessionContext.slots.surface ?? null).toBeNull();
    expect(sessionContext.slots.object ?? null).toBeNull();
  });

  it("leather_seat_three_turn_continuity_no_reset_wipe", () => {
    const t1 = "Vreau să curăț scaunul de piele al mașinii mele.";
    const t2 = "murdaria grea, are noroi";
    const t3 = "interior, scaunul este la interior";
    const sessionContext = {
      slots: { context: "interior", surface: "leather", object: "scaun_auto", action: "clean" },
      pendingQuestion: null,
      pendingContexts: [],
      pendingSelection: true,
      pendingSelectionMissingSlot: "action",
      slotMeta: { context: "confirmed", surface: "confirmed", object: "confirmed", action: "confirmed" },
      state: "NEEDS_ACTION",
      lastHighLevelIntent: "knowledge"
    };

    expect(t1.length).toBeGreaterThan(0);
    const appliedT2 = applyDeterministicSessionResetInPlace(
      sessionContext,
      "f34-session",
      "reset.high_level_intent_shift",
      t2
    );
    expect(appliedT2).toBe(true);
    expect(sessionContext.slots.surface).toBe("leather");
    expect(sessionContext.slots.object).toBe("scaun_auto");

    const appliedT3 = applyDeterministicSessionResetInPlace(
      sessionContext,
      "f34-session",
      "reset.high_level_intent_shift",
      t3
    );
    expect(appliedT3).toBe(true);
    expect(sessionContext.slots.surface).toBe("leather");
    expect(sessionContext.slots.object).toBe("scaun_auto");
  });

  it("telemetry_splits_expected_guard_vs_anomalous_skip_with_legacy_field_preserved", () => {
    const sessionContext = {
      slots: { surface: "leather", object: "scaun_auto" },
      slotMeta: { context: "unknown", surface: "inferred", object: "inferred" }
    };
    const interactionRef = {};

    applyTokenInferenceToSessionSlots({
      message: "vreau sa curat pielea",
      sessionContext,
      interactionRef,
      options: { blockSurfaceObject: true }
    });

    const telemetry = interactionRef.tokenInferenceTelemetry || {};
    expect(telemetry.tokenInferenceSkippedReasons).toContain("stale_slot_present");
    expect(telemetry.tokenInferenceSkipExpectedGuards).toContain("stale_slot_present");
    expect(telemetry.tokenInferenceSkipAnomalous).not.toContain("stale_slot_present");
    expect(telemetry.tokenInferenceSkipCounts?.anomalous_skip).toBe(0);
    expect(telemetry.tokenInferenceSkipCounts).toMatchObject({
      expected_guard: expect.any(Number),
      anomalous_skip: expect.any(Number)
    });
  });
});
