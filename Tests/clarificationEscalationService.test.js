/**
 * @jest-environment node
 */

const {
  buildPendingQuestionState,
  evaluateClarificationEscalation,
  UNKNOWN_VALUE,
  STILL_UNKNOWN_VALUE
} = require("../services/clarificationEscalationService");

describe("clarificationEscalationService", () => {
  test("attemptCount increments on no_slot and escalates to chips on second failure", () => {
    const p0 = buildPendingQuestionState(null, { slot: "surface" });
    const first = evaluateClarificationEscalation({
      pendingQuestion: p0,
      userMessage: "nu stiu",
      isNewRootRequest: false,
      chipSelection: null,
      contextHint: "interior",
      slotFilled: false
    });
    expect(first.kind).toBe("normal");
    expect(first.pendingQuestion.attemptCount).toBe(1);
    expect(first.telemetry.clarificationFailureReason).toBe("no_slot");

    const second = evaluateClarificationEscalation({
      pendingQuestion: first.pendingQuestion,
      userMessage: "inca nu stiu",
      isNewRootRequest: false,
      chipSelection: null,
      contextHint: "interior",
      slotFilled: false
    });
    expect(second.kind).toBe("chips");
    expect(second.pendingQuestion.attemptCount).toBe(2);
    expect(second.ui.type).toBe("chips");
    expect(second.telemetry.clarificationEscalated).toBe(true);
  });

  test("counter resets when missingSlot changes or pending recreated", () => {
    const s1 = buildPendingQuestionState(null, { slot: "surface" });
    const s2 = { ...s1, attemptCount: 2, escalated: true, lastFailureReason: "repeat" };
    const sameSlot = buildPendingQuestionState(s2, { slot: "surface" });
    expect(sameSlot.attemptCount).toBe(2);

    const changedSlot = buildPendingQuestionState(s2, { slot: "object" });
    expect(changedSlot.attemptCount).toBe(0);
    expect(changedSlot.escalated).toBe(false);
    expect(changedSlot.lastFailureReason).toBeNull();
  });

  test("__UNKNOWN__ triggers narrow chips once", () => {
    const p = { slot: "surface", attemptCount: 2, escalated: true, escalationStep: "chips" };
    const out = evaluateClarificationEscalation({
      pendingQuestion: p,
      userMessage: "nu sunt sigur",
      isNewRootRequest: false,
      chipSelection: UNKNOWN_VALUE,
      contextHint: "interior",
      slotFilled: false
    });
    expect(out.kind).toBe("chips_narrow");
    expect(out.ui.chipSetId).toBe("surface_narrow_v1");
    expect(out.pendingQuestion.escalationStep).toBe("chips_narrow");
  });

  test("__STILL_UNKNOWN__ exits with deterministic message and no loop", () => {
    const p = { slot: "surface", attemptCount: 2, escalated: true, escalationStep: "chips_narrow" };
    const out = evaluateClarificationEscalation({
      pendingQuestion: p,
      userMessage: "tot nu stiu",
      isNewRootRequest: false,
      chipSelection: STILL_UNKNOWN_VALUE,
      contextHint: "interior",
      slotFilled: false
    });
    expect(out.kind).toBe("exit_unknown");
    expect(out.reply).toMatch(/poza|material/i);
    expect(out.pendingQuestion.active).toBe(false);
  });

  test("off-topic while pending increments attempt and escalates", () => {
    const p0 = buildPendingQuestionState(null, { slot: "object" });
    const first = evaluateClarificationEscalation({
      pendingQuestion: p0,
      userMessage: "vreau cod de reducere",
      isNewRootRequest: true,
      chipSelection: null,
      contextHint: "exterior",
      slotFilled: false
    });
    expect(first.pendingQuestion.attemptCount).toBe(1);
    expect(first.telemetry.clarificationFailureReason).toBe("off_topic");

    const second = evaluateClarificationEscalation({
      pendingQuestion: first.pendingQuestion,
      userMessage: "ce e apc",
      isNewRootRequest: true,
      chipSelection: null,
      contextHint: "exterior",
      slotFilled: false
    });
    expect(second.kind).toBe("chips");
    expect(second.telemetry.clarificationFailureReason).toBe("off_topic");
  });

  test("repeat detection increments attemptCount with repeat reason", () => {
    const p0 = buildPendingQuestionState(null, { slot: "context" });
    const first = evaluateClarificationEscalation({
      pendingQuestion: p0,
      userMessage: "nu stiu",
      isNewRootRequest: false,
      chipSelection: null,
      contextHint: null,
      slotFilled: false
    });
    const second = evaluateClarificationEscalation({
      pendingQuestion: first.pendingQuestion,
      userMessage: "nu stiu",
      isNewRootRequest: false,
      chipSelection: null,
      contextHint: null,
      slotFilled: false
    });
    expect(second.telemetry.clarificationFailureReason).toBe("repeat");
    expect(second.pendingQuestion.attemptCount).toBe(2);
  });
});

