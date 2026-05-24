"use strict";

const {
  getMissingSlot,
  inferContextFromSlots,
  inferSurfaceFromObject
} = require("../services/slotCompleteness");

describe("slotCompleteness.getMissingSlot", () => {
  it("requires context when no surface or object hints", () => {
    expect(getMissingSlot({})).toBe("context");
    expect(getMissingSlot({ context: "interior" })).toBe("object");
  });

  it("infers interior context from piele surface — no context clarification", () => {
    expect(getMissingSlot({ surface: "piele" })).toBeNull();
    expect(inferContextFromSlots("piele", null)).toBe("interior");
  });

  it("infers exterior context from jante surface — no context clarification", () => {
    expect(getMissingSlot({ surface: "jante" })).toBeNull();
    expect(inferContextFromSlots("jante", null)).toBe("exterior");
  });

  it("interior glass needs no surface", () => {
    expect(
      getMissingSlot({
        context: "interior",
        object: "geamuri"
      })
    ).toBeNull();
  });

  it("infers surface from object jante — no surface clarification", () => {
    expect(
      getMissingSlot({
        context: "exterior",
        object: "jante"
      })
    ).toBeNull();
    expect(inferSurfaceFromObject("jante")).toBe("jante");
  });

  it("infers surface from object anvelope — no surface clarification (tires-01)", () => {
    expect(
      getMissingSlot({
        context: "exterior",
        object: "anvelope"
      })
    ).toBeNull();
    expect(inferSurfaceFromObject("anvelope")).toBe("anvelope");
  });

  it("interior scaun needs CTO surface", () => {
    expect(
      getMissingSlot({
        context: "interior",
        object: "scaun"
      })
    ).toBe("surface");
    expect(
      getMissingSlot({
        context: "interior",
        object: "scaun",
        surface: "piele"
      })
    ).toBeNull();
  });

  it("explicit brand + piele surface is complete for selection routing", () => {
    expect(
      getMissingSlot({
        surface: "piele",
        brand: "Koch Chemie"
      })
    ).toBeNull();
  });
});
