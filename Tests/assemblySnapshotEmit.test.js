"use strict";

const fs = require("fs");
const path = require("path");

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue(
    "Îți recomand un produs potrivit pentru curățarea jantelor, aplicat pe suprafață rece."
  )
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn(() => ({ reply: "", products: [] }))
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { handleChat } = require("../services/chatService");

function captureV2Rows() {
  const rows = [];
  jest.spyOn(console, "log").mockImplementation((line) => {
    if (typeof line === "string" && line.startsWith("{")) {
      try {
        rows.push(JSON.parse(line));
      } catch (_) {
        /* ignore non-json */
      }
    }
  });
  return rows;
}

describe("F45 ASSEMBLY_SNAPSHOT emission", () => {
  let rows;
  let prevNodeEnv;

  beforeEach(() => {
    prevNodeEnv = process.env.NODE_ENV;
    rows = captureV2Rows();
    process.env.TIER_ONE_GATE_ENABLED = "0";
  });

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
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

  it("emits ASSEMBLY_SNAPSHOT on recommend path under prod-equivalent config", async () => {
    process.env.NODE_ENV = "production";
    process.env.TIER_ONE_GATE_ENABLED = "1";
    const products = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "data", "products.json"), "utf8")
    );
    const sid = `f45-recommend-prod-${Date.now()}`;
    await handleChat("ce produs pentru jante murdare", "C1", products, sid);

    const snaps = rows.filter((r) => r.event === "ASSEMBLY_SNAPSHOT");
    const summaries = rows.filter((r) => r.event === "TURN_SUMMARY");
    expect(snaps.length).toBe(1);
    expect(summaries.length).toBe(1);
    expect(snaps[0].env).toBe("prod");
    expect(snaps[0].meta.responsePath).toBe("recommendation");
    expect(snaps[0].meta.productsCount).toBeGreaterThanOrEqual(1);
    expect(snaps[0].traceId).toBeTruthy();
  });
});
