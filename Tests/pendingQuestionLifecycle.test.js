"use strict";

const {
  evaluatePendingQuestionStaleness,
  matchesExplicitCancel
} = require("../services/pendingQuestionLifecycle");
const { buildPendingQuestionState } = require("../services/clarificationEscalationService");

describe("pendingQuestionLifecycle (F7)", () => {
  it("buildPendingQuestionState sets turnsSinceArmed to 0 on fresh arm", () => {
    const pq = buildPendingQuestionState(null, { slot: "surface" });
    expect(pq.turnsSinceArmed).toBe(0);
  });

  it("preserves turnsSinceArmed when same slot is re-armed", () => {
    const p0 = buildPendingQuestionState(null, { slot: "object" });
    p0.turnsSinceArmed = 2;
    const p1 = buildPendingQuestionState(p0, { slot: "object", question: "again" });
    expect(p1.turnsSinceArmed).toBe(2);
  });

  it("expires when turnsSinceArmed >= maxTurns", () => {
    const sessionContext = {
      pendingQuestion: { slot: "object", turnsSinceArmed: 3 },
      slots: { context: "interior", object: "scaun" }
    };
    const result = evaluatePendingQuestionStaleness(sessionContext, "hello", {
      maxTurns: 3
    });
    expect(result).toEqual({ stale: true, reason: "turn_count_exceeded" });
  });

  it("does not expire when within maxTurns and no topic shift", () => {
    const sessionContext = {
      pendingQuestion: { slot: "object", turnsSinceArmed: 1 },
      slots: { context: "interior", object: "scaun" }
    };
    const result = evaluatePendingQuestionStaleness(sessionContext, "scaun", {
      maxTurns: 3,
      getSingleTokenBinding: () => ({ slot: "object", value: "scaun" }),
      evaluateSessionReset: () => ({ reset: false })
    });
    expect(result).toEqual({ stale: false });
  });

  it("expires on topic_shift via isOffTopicForPending", () => {
    const sessionContext = {
      pendingQuestion: { slot: "intent_level", turnsSinceArmed: 1 },
      slots: { context: "interior", object: "scaun" }
    };
    const result = evaluatePendingQuestionStaleness(
      sessionContext,
      "cat costa abonamentul",
      {
        maxTurns: 3,
        getSingleTokenBinding: () => null,
        isOffTopicForPending: () => true
      }
    );
    expect(result).toEqual({ stale: true, reason: "topic_shift" });
  });

  it("expires on topic_shift when reset eval fires and no slot binding", () => {
    const sessionContext = {
      pendingQuestion: { slot: "intent_level", turnsSinceArmed: 1 },
      slots: { context: "interior", object: "scaun", surface: "textile" }
    };
    const result = evaluatePendingQuestionStaleness(
      sessionContext,
      "cat costa abonamentul",
      {
        maxTurns: 3,
        getSingleTokenBinding: () => null,
        evaluateSessionReset: () => ({ reset: true, reasonCode: "reset.new_root_query" })
      }
    );
    expect(result).toEqual({ stale: true, reason: "topic_shift" });
  });

  it("does not expire interrogative follow-up with session slots (F5 regression)", () => {
    const sessionContext = {
      pendingQuestion: { slot: "intent_level", turnsSinceArmed: 2 },
      slots: { context: "exterior", action: "protect", object: "caroserie" }
    };
    const result = evaluatePendingQuestionStaleness(sessionContext, "De ce?", {
      maxTurns: 3,
      getSingleTokenBinding: () => null,
      evaluateSessionReset: () => ({ reset: false }),
      isInterrogativeFollowUp: (msg) => String(msg).toLowerCase().includes("de ce")
    });
    expect(result).toEqual({ stale: false });
  });

  it("explicit_cancel list is empty by default", () => {
    expect(matchesExplicitCancel("lasa")).toBe(false);
  });
});

jest.mock("../services/llm", () => ({ askLLM: jest.fn().mockResolvedValue("stub") }));
jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn().mockResolvedValue({ reply: "stub", products: [] })
}));
jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn(),
  enrichInteractionExportRow: (e) => e,
  INTERACTION_JSONL_SCHEMA_VERSION: 2,
  LOG_DIR: "/tmp"
}));

const { runConvo } = require("./_phaseA_harness");

describe("F7 diagnostic integration", () => {
  it("expires stale pending before T4 routes to new topic", async () => {
    const messages = [
      "interior scaune textile",
      "cat costa abonamentul",
      "bună ziua",
      "vreau sa cumpar o solutie pentru anvelope"
    ];
    const { perTurn } = await runConvo(messages, {
      runLabel: "F7-int",
      sessionId: `f7-int-${Date.now()}`,
      captureTraces: false
    });

    expect(perTurn[0].pendingQuestion?.slot).toBeTruthy();
    expect(perTurn[1].pendingQuestion).toBeNull();
    expect(perTurn[3].sessionSlots.object).toBe("anvelope");
    expect(perTurn[3].sessionSlots.context).toBe("exterior");
  });
});
