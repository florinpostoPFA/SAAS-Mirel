"use strict";

process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.TIER_ONE_GATE_ENABLED = "0";

jest.mock("../services/llm", () => ({ askLLM: jest.fn().mockResolvedValue("stub") }));
jest.mock("../services/flowExecutor", () => ({ executeFlow: jest.fn() }));

const { handleChat, __test } = require("../services/chatService");
const sessionLifecycle = require("../services/sessionLifecycle");
const { getSession, saveSession } = require("../services/sessionStore");

const WHEEL_CATALOG = [
  { id: "w1", name: "Wheel A", tags: ["wheels"], searchText: "jante roti curatare", manufacturerId: "13" },
  { id: "w2", name: "Wheel B", tags: ["wheels"], searchText: "roti jante spalare", manufacturerId: "13" }
];

describe("F14 §6 broadening offer", () => {
  beforeEach(() => sessionLifecycle.resetAllSessions());

  it("splitBroadeningTokens separates roti vs tractor", () => {
    const split = __test.splitBroadeningTokens(WHEEL_CATALOG, [
      { token: "roti" },
      { token: "tractor" }
    ]);
    expect(split.matchedTokens).toContain("roti");
    expect(split.unmatchedTokens).toContain("tractor");
  });

  it("tryEmitBroadeningOffer emits honest-gap template", () => {
    const sid = `f14-broad-unit-${Date.now()}`;
    const interactionRef = {
      message: "solutie doar pentru tractor",
      tokenInferenceTelemetry: {
        tokenInferenceMatches: [{ token: "roti" }, { token: "tractor" }]
      },
      productsCatalog: WHEEL_CATALOG
    };
    const out = __test.tryEmitBroadeningOffer(
      interactionRef,
      sid,
      interactionRef.message,
      WHEEL_CATALOG,
      { action: "selection" },
      {}
    );
    expect(out).toBeTruthy();
    expect(String(out.reply || out.message || "")).toMatch(
      /produse pentru 'roti'.*tractor/i
    );
    expect(getSession(sid).broadeningOffer?.matchedTokens).toContain("roti");
  });

  it("affirmative da continues after stashed broadening offer", async () => {
    const sid = `f14-broad-da-${Date.now()}`;
    const sess = getSession(sid);
    sess.broadeningOffer = { matchedTokens: ["roti"], unmatchedTokens: ["tractor"] };
    saveSession(sid, sess);
    const res = await handleChat("da", "C1", WHEEL_CATALOG, sid);
    expect(String(res.reply || res.message || "")).not.toMatch(/A apărut o eroare/i);
    expect(getSession(sid).broadeningOffer).toBeFalsy();
  });

  it("full-zero token list does not emit broadening from empty split", () => {
    const out = __test.tryEmitBroadeningOffer(
      { message: "roti de tractor", tokenInferenceTelemetry: { tokenInferenceMatches: [] }, productsCatalog: [] },
      "s-zero",
      "roti de tractor",
      [],
      { action: "selection" },
      {}
    );
    expect(out).toBeNull();
  });
});
