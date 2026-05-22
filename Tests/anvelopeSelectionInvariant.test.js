/**
 * Regression: dev probe "vreau ceva pentru anvelope" must not crash on
 * INVALID STATE: clarification missingSlot mismatch (interactionRef.slots empty).
 * @jest-environment node
 */

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Produs pentru anvelope.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn(() => ({ reply: "", products: [] }))
}));

const fs = require("fs");
const path = require("path");
const { handleChat } = require("../services/chatService");

function loadCatalog() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "products.json"), "utf8")
  );
}

describe("selection probe — vreau ceva pentru anvelope", () => {
  const products = loadCatalog();

  it("returns a clarification question without invariant crash", async () => {
    const sessionId = `anvelope-probe-${Date.now()}`;
    const result = await handleChat(
      "vreau ceva pentru anvelope",
      "C1",
      products,
      sessionId
    );
    const message = String(result?.message || result?.reply || "").trim();
    expect(message.length).toBeGreaterThan(0);
    expect(message.toLowerCase()).not.toContain("invalid state");
  });
});
