"use strict";

const {
  inferSlotsFromMessage,
  applyTokenInferenceToSessionSlots
} = require("../services/slotInferenceFromMessage");

describe("slotInference action nouns (F6 patch A)", () => {
  function sessionWithEmptySlots() {
    return {
      slots: {},
      slotMeta: { context: "unknown", surface: "unknown", object: "unknown" },
      objective: { slots: {} }
    };
  }

  it.each([
    ["protejez vopseaua", "protect"],
    ["protejeaza vopsea", "protect"],
    ["pentru protejarea vopselei", "protect"],
    ["protejare vopsea auto", "protect"],
    ["protectia vopselei", "protect"]
  ])("infers action:%s from %j", (message, expectedAction) => {
    const inferred = inferSlotsFromMessage({
      message,
      currentSlots: {},
      slotMeta: { context: "unknown", surface: "unknown", object: "unknown" }
    });
    expect(inferred.slotUpdates.action).toBe(expectedAction);

    const sessionContext = sessionWithEmptySlots();
    applyTokenInferenceToSessionSlots({ message, sessionContext });
    expect(sessionContext.slots.action).toBe(expectedAction);
  });

  it("does not infer protect from unrelated nouns", () => {
    const inferred = inferSlotsFromMessage({
      message: "recomanda detergent pentru scaune",
      currentSlots: {},
      slotMeta: { context: "unknown", surface: "unknown", object: "unknown" }
    });
    expect(inferred.slotUpdates.action ?? null).toBeNull();
  });
});
