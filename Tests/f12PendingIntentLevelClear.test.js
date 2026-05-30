"use strict";

process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.TIER_ONE_GATE_ENABLED = "0";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog.js", () => ({
  appendInteractionLine: jest.fn(),
  enrichInteractionExportRow: (e) => e,
  INTERACTION_JSONL_SCHEMA_VERSION: 2,
  LOG_DIR: "/tmp"
}));

const { __test: t } = require("../services/chatService");
const { loadSession, persistSession, resetAllSessions } = require("../services/sessionLifecycle");

function armIntentLevelPending(session) {
  session.pendingQuestion = {
    slot: "intent_level",
    source: "low_signal",
    type: "intent_level",
    active: true,
    attemptCount: 0,
    turnsSinceArmed: 0
  };
}

describe("F12 — pending intent_level clear on token match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAllSessions();
  });

  it("clears intent_level pending when message has farurile token", () => {
    const sessionId = `f12-pending-${Date.now()}`;
    const session = loadSession(sessionId);
    armIntentLevelPending(session);
    session.state = "IDLE";
    persistSession(sessionId, session);

    expect(
      t.tryClearIntentLevelPendingForTokenSignal(session, "curatat farurile", sessionId)
    ).toBe(true);
    expect(session.pendingQuestion).toBeNull();
  });

  it("preserves intent_level pending on da", () => {
    const sessionId = `f12-pending-da-${Date.now()}`;
    const session = loadSession(sessionId);
    armIntentLevelPending(session);
    persistSession(sessionId, session);

    expect(t.tryClearIntentLevelPendingForTokenSignal(session, "da", sessionId)).toBe(false);
    expect(session.pendingQuestion?.slot).toBe("intent_level");
  });

  it("does not clear non-intent_level pending", () => {
    const sessionId = `f12-pending-ctx-${Date.now()}`;
    const session = loadSession(sessionId);
    session.pendingQuestion = {
      slot: "context",
      source: "clarification",
      active: true
    };
    persistSession(sessionId, session);

    expect(
      t.tryClearIntentLevelPendingForTokenSignal(session, "curatat farurile", sessionId)
    ).toBe(false);
    expect(session.pendingQuestion?.slot).toBe("context");
  });
});
