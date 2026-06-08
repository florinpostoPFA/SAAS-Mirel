"use strict";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const loggingV2 = require("../services/loggingV2");
const { handleChat } = require("../services/chatService");

describe("F45 ASSEMBLY_SNAPSHOT emission", () => {
  let rows;

  beforeEach(() => {
    rows = [];
    jest.spyOn(console, "log").mockImplementation((line) => {
      if (typeof line === "string" && line.startsWith("{")) {
        try {
          rows.push(JSON.parse(line));
        } catch (_) {
          /* ignore non-json */
        }
      }
    });
    process.env.TIER_ONE_GATE_ENABLED = "0";
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  it("emits one ASSEMBLY_SNAPSHOT per turn with traceId envelope", async () => {
    const sid = `f45-emit-${Date.now()}`;
    await handleChat("vreau sa curat pielea", "C1", [], sid);
    const snaps = rows.filter((r) => r.event === "ASSEMBLY_SNAPSHOT");
    expect(snaps.length).toBe(1);
    expect(snaps[0].traceId).toBeTruthy();
    expect(snaps[0].meta.responsePath).toBeTruthy();
    expect(typeof snaps[0].meta.productsCount).toBe("number");
  });
});
