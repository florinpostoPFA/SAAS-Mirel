"use strict";

const { inferSlotsFromMessage } = require("../services/slotInferenceFromMessage");

describe("F12 — token rules emit object for faruri", () => {
  it("cum curat farurile? infers context, surface, object", () => {
    const r = inferSlotsFromMessage({
      message: "cum curat farurile?",
      currentSlots: { context: "exterior", surface: "glass", object: "caroserie" },
      slotMeta: { context: "confirmed", surface: "stale", object: "stale" }
    });
    const objectMatch = r.matches.find((m) => m.slotKey === "object");
    expect(objectMatch).toBeDefined();
    expect(objectMatch.slotValue).toBe("glass");
    expect(r.matches.some((m) => m.slotKey === "surface" && m.slotValue === "glass")).toBe(true);
  });

  it("curatat farurile infers object when slots empty", () => {
    const r = inferSlotsFromMessage({
      message: "curatat farurile",
      currentSlots: {},
      slotMeta: {}
    });
    expect(r.matches.some((m) => m.slotKey === "object" && m.slotValue === "glass")).toBe(true);
    expect(r.tokenInferenceApplied).toBe(true);
  });
});
