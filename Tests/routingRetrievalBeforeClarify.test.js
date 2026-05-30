"use strict";

const path = require("path");
const fs = require("fs");

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

const { handleChat, __test: t } = require("../services/chatService");
const { appendInteractionLine } = require("../services/interactionLog");
const logger = require("../services/logger");
const { loadFreshHandleChat } = require("./_phaseA_harness");
const sessionLifecycle = require("../services/sessionLifecycle");

const PROSOP_PRODUCT = {
  id: "EW-TW-stub",
  name: "Ewocar Twisted Loop Prosop Uscare",
  tags: [],
  manufacturerId: "13",
  searchText: "prosop de uscare auto microfibra twisted loop",
  applicability: {
    customer_language: ["vreau un prosop care sa capteze bine apa", "prosop uscare"]
  }
};

const FARURI_PRODUCT = {
  id: "PLAST-X-stub",
  name: "Meguiar's Plast X Polish Faruri",
  tags: [],
  manufacturerId: "13",
  searchText: "polish plastic restaurare faruri farurile headlight",
  applicability: {
    customer_language: ["restaurare faruri galbene", "polish faruri"]
  }
};

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

describe("F11 — routing retrieval before clarify", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionLifecycle.resetAllSessions();
  });

  it("tryRetrieveBeforeClarifySelection matches prosop in catalog text", () => {
    const r = t.tryRetrieveBeforeClarifySelection(
      "recomanda un prosop de uscare",
      [PROSOP_PRODUCT],
      ["cleaning"]
    );
    expect(r.decision).toBe("retrieve");
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.some((p) => String(p.id) === "EW-TW-stub")).toBe(true);
  });

  it("tryRetrieveBeforeClarifySelection matches faruri phrasing", () => {
    const r = t.tryRetrieveBeforeClarifySelection(
      "recomanda-mi o solutie pentru curatat farurile",
      [FARURI_PRODUCT],
      ["cleaning"]
    );
    expect(r.decision).toBe("retrieve");
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it("ambiguous input falls through when no catalog hit", () => {
    const r = t.tryRetrieveBeforeClarifySelection("un produs bun", [PROSOP_PRODUCT], []);
    expect(r.decision).toBe("fall_through_to_clarify");
    expect(r.candidates).toHaveLength(0);
  });

  it("procedural-only phrase (recomandare) does not retrieve", () => {
    const r = t.tryRetrieveBeforeClarifySelection(
      "vreau o recomandare de produs",
      [PROSOP_PRODUCT],
      []
    );
    expect(r.decision).toBe("fall_through_to_clarify");
    expect(r.candidates).toHaveLength(0);
  });

  it("Bug #3 replay — product response, not clarification", async () => {
    const handleChatFresh = loadFreshHandleChat();
    const sid = `f11-bug3-${Date.now()}`;
    const reply = await handleChatFresh(
      "recomanda un prosop de uscare",
      "C1",
      [PROSOP_PRODUCT],
      sid
    );
    const log = lastLog();
    expect(log.decision.action).not.toBe("clarification");
    expect(log.decision.reasonCode).toMatch(/retrieval_before_clarify|selection/);
    const productCount =
      (reply.products && reply.products.length) ||
      (log.output && log.output.products && log.output.products.length) ||
      0;
    expect(productCount).toBeGreaterThan(0);
    const msg = String(reply.message || reply.reply || "");
    expect(msg).not.toMatch(/\bIs it interior or exterior\b/i);
  });

  it("Bug #2 replay — product response for faruri phrasing", async () => {
    const handleChatFresh = loadFreshHandleChat();
    const sid = `f11-bug2-${Date.now()}`;
    const reply = await handleChatFresh(
      "recomanda-mi o solutie pentru curatat farurile",
      "C1",
      [FARURI_PRODUCT],
      sid
    );
    const log = lastLog();
    expect(log.decision.action).not.toBe("clarification");
    const msg = String(reply.message || reply.reply || "");
    expect(msg).not.toMatch(/interior.*exterior.*geamuri.*jante.*anvelope/i);
  });

  it("negative — no catalog hit still clarifies (context slot)", async () => {
    const handleChatFresh = loadFreshHandleChat();
    const sid = `f11-neg-${Date.now()}`;
    const reply = await handleChatFresh("vreau un articol bun", "C1", [PROSOP_PRODUCT], sid);
    const log = lastLog();
    expect(log.decision.action).toBe("clarification");
    expect(String(reply.message || reply.reply || "")).toMatch(/interior|exterior|suprafata/i);
  });
});
