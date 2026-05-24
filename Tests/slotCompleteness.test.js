"use strict";

const {
  getMissingSlot,
  inferContextFromSlots
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

  it("exterior wheels need surface when absent", () => {
    expect(
      getMissingSlot({
        context: "exterior",
        object: "jante"
      })
    ).toBe("surface");
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
