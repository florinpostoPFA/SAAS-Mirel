"use strict";

const { getMissingSlot } = require("../services/slotCompleteness");

describe("slotCompleteness.getMissingSlot", () => {
  it("requires context then object", () => {
    expect(getMissingSlot({})).toBe("context");
    expect(getMissingSlot({ context: "interior" })).toBe("object");
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
});
