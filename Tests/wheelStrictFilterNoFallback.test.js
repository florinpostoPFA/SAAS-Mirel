jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/logger", () => ({
  logInfo: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const fs = require("fs");
const path = require("path");
const { logInfo } = require("../services/logger");
const { askLLM } = require("../services/llm");
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");

const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "products.json"), "utf8")
);

function lastLogEntry() {
  const calls = appendInteractionLine.mock.calls;
  return calls[calls.length - 1]?.[0] || null;
}

async function assertWheelFlowNoFallback(message) {
  const sessionId = `wheel-no-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  askLLM.mockResolvedValue("Recomand produsele potrivite pentru jante.");

  const res = await handleChat(message, "C1", catalog, sessionId);
  const entry = lastLogEntry();

  const isFlowDecision =
    entry?.decision?.action === "flow" ||
    entry?.decision?.flowId === "wheel_tire_deep_clean" ||
    String(entry?.outputType || "").toLowerCase() === "flow";
  expect(isFlowDecision).toBe(true);
  if (entry?.decision?.flowId) {
    expect(entry.decision.flowId).toBe("wheel_tire_deep_clean");
  }

  const productsLength = Array.isArray(res?.products) ? res.products.length : 0;
  expect(productsLength).toBeGreaterThan(0);

  const usedWipeoutFallback = logInfo.mock.calls.some(
    (c) => c[0] === "PRODUCT_FILTER_WIPEOUT_FALLBACK"
  );
  expect(usedWipeoutFallback).toBe(false);
  expect(String(entry?.productsReason || "")).not.toBe("filtered_out_fallback_to_raw");
}

describe("Wheel strict filter does not wipe out", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("vreau sa curat jantele returns flow products without fallback", async () => {
    await assertWheelFlowNoFallback("vreau sa curat jantele");
  });

  it("solutie pentru jante returns flow products without fallback", async () => {
    await assertWheelFlowNoFallback("solutie pentru jante");
  });
});
