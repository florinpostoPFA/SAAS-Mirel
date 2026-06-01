"use strict";

jest.mock("../services/logger", () => ({
  logInfo: jest.fn()
}));

const logger = require("../services/logger");
const {
  buildHandoffPayload,
  logHandoffPayloadSafe
} = require("../services/handoff/handoffPayloadLogger");

describe("handoffPayloadLogger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds JSON-serializable payload with required fields", () => {
    const payload = buildHandoffPayload(
      {
        slots: { context: null, object: "wheels" },
        turnHistory: [{ role: "user", text: "hi" }],
        decisionHistory: [{ action: "clarification" }]
      },
      { type: "phone", value: "+40744123456" },
      "trace-1",
      { handoffReason: "T1", sessionId: "s1", turnCount: 1 }
    );
    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(payload).toMatchObject({
      traceId: "trace-1",
      contactType: "phone",
      contactValue: "+40744123456",
      handoffReason: "T1",
      sessionId: "s1",
      slots: { context: null, object: "wheels" }
    });
    expect(Array.isArray(payload.lastTurns)).toBe(true);
    expect(Array.isArray(payload.decisionHistory)).toBe(true);
    expect(payload.timestamp).toBeTruthy();
  });

  it("emits HUMAN_HANDOFF_PAYLOAD_LOGGED", () => {
    logHandoffPayloadSafe({ slots: {} }, null, "t2", { handoffReason: "T2" });
    expect(logger.logInfo).toHaveBeenCalledWith(
      "HUMAN_HANDOFF_PAYLOAD_LOGGED",
      expect.objectContaining({ traceId: "t2", handoffReason: "T2" })
    );
  });

  it("emits HUMAN_HANDOFF_LOG_FAILED on serialization failure", () => {
    const slots = {};
    slots.self = slots;
    logHandoffPayloadSafe({ slots }, null, "t3");
    expect(logger.logInfo).toHaveBeenCalledWith(
      "HUMAN_HANDOFF_LOG_FAILED",
      expect.objectContaining({ traceId: "t3" })
    );
  });
});
