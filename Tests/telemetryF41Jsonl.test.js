"use strict";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

function lastJsonlRow() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

describe("F41 token inference split keys in JSONL", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "0";
  });

  it("stale_slot_present skip path emits all four token-inference fields on JSONL row", async () => {
    const sessionId = `f41-jsonl-${Date.now()}`;
    await handleChat("vreau sa curat pielea", "C1", [], sessionId);
    const row = lastJsonlRow();
    expect(row).toBeTruthy();
    expect(Array.isArray(row.tokenInferenceSkippedReasons)).toBe(true);
    expect(Array.isArray(row.tokenInferenceSkipExpectedGuards)).toBe(true);
    expect(Array.isArray(row.tokenInferenceSkipAnomalous)).toBe(true);
    expect(row.tokenInferenceSkipCounts).toMatchObject({
      expected_guard: expect.any(Number),
      anomalous_skip: expect.any(Number)
    });
  });
});
