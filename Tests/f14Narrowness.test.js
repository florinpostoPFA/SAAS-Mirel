"use strict";

process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.TIER_ONE_GATE_ENABLED = "0";

jest.mock("../services/llm", () => ({ askLLM: jest.fn().mockResolvedValue("stub") }));
jest.mock("../services/flowExecutor", () => ({ executeFlow: jest.fn() }));

const { handleChat, __test } = require("../services/chatService");
const sessionLifecycle = require("../services/sessionLifecycle");

const GLASS_CATALOG = Array.from({ length: 8 }, (_, i) => ({
  id: `g${i}`,
  name: `Glass ${i}`,
  tags: ["glass", "exterior"],
  searchText: "geam parbriz luneta oglinzi sticla curatare exterior",
  manufacturerId: "13"
}));

describe("F14 narrowness threshold", () => {
  beforeEach(() => sessionLifecycle.resetAllSessions());

  it("needsNarrowingClarification when pool wide and axis missing", () => {
    expect(__test.needsNarrowingClarification({}, 8)).toBe(true);
    expect(__test.needsNarrowingClarification({ surface: "glass", object: "geam" }, 8)).toBe(false);
    expect(__test.needsNarrowingClarification({ object: "geam" }, 3)).toBe(false);
    expect(__test.buildNarrownessClarificationMessage("vreau geamuri", {})).toMatch(
      /multe produse.*geamuri/i
    );
  });

  it("F11 wide retrieval pool triggers narrowness gate", () => {
    const attempt = __test.tryRetrieveBeforeClarifySelection(
      "geam parbriz luneta oglinzi sticla",
      GLASS_CATALOG,
      []
    );
    expect(attempt.candidates.length).toBeGreaterThan(__test.NARROWNESS_THRESHOLD);
    expect(__test.needsNarrowingClarification({}, attempt.candidates.length)).toBe(true);
  });

  it("narrow parbriz exterior → not narrowness dump gate", async () => {
    const sid = `f14-narrow-ok-${Date.now()}`;
    const res = await handleChat("vreau ceva pentru parbriz exterior", "C1", GLASS_CATALOG, sid);
    const reply = String(res.reply || res.message || "");
    expect(reply.toLowerCase()).not.toMatch(/multe produse pentru geamuri/i);
  });
});
