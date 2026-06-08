"use strict";

const { classifyInteraction, evaluateConversionAlignment } = require("../services/logClassification");

const LEATHER_CLEANER = {
  id: "lc-1",
  name: "Solutie curatare piele Leather Cleaner Koch Chemie, 500ml",
  tags: ["leather", "leather_cleaner", "cleaner", "cleaning", "interior"]
};

const LEATHER_HYDRATION = {
  id: "77709500",
  name: "Solutie hidratare piele Protect Leather Care Koch Chemie, 500ml",
  tags: ["leather", "leather_conditioner", "protection", "interior"]
};

describe("F37 conversionAligned telemetry", () => {
  it("cleaning intent with hydration products → mismatched, conversionAligned false", () => {
    const analysis = classifyInteraction({
      decision: { action: "recommend" },
      products: [LEATHER_HYDRATION],
      intentTags: ["interior", "leather", "cleaning"],
      finalOutputType: "recommendation",
      queryType: "selection"
    });
    expect(analysis.conversionSuccess).toBe(true);
    expect(analysis.conversionAligned).toBe(false);
    expect(analysis.conversionAlignment.actionMatchType).toBe("mismatched");
    expect(analysis.conversionAlignment.matchedProductCount).toBe(0);
    expect(analysis.frictionPoint).toBe("wrong_action");
  });

  it("cleaning intent with cleaner products → matched, conversionAligned true", () => {
    const analysis = classifyInteraction({
      decision: { action: "recommend" },
      products: [LEATHER_CLEANER],
      intentTags: ["cleaning", "leather"],
      finalOutputType: "recommendation",
      queryType: "selection"
    });
    expect(analysis.conversionAligned).toBe(true);
    expect(analysis.conversionAlignment.actionMatchType).toBe("matched");
    expect(analysis.conversionAlignment.matchedProductCount).toBeGreaterThan(0);
  });

  it("no action signal → intent_no_signal, conversionAligned follows legacy shape", () => {
    const analysis = classifyInteraction({
      decision: { action: "recommend" },
      products: [LEATHER_CLEANER],
      intentTags: ["interior", "leather"],
      finalOutputType: "recommendation",
      queryType: "selection"
    });
    expect(analysis.conversionAlignment.actionMatchType).toBe("intent_no_signal");
    expect(analysis.conversionAligned).toBe(analysis.conversionSuccess);
  });

  it("partial match when multiple action tags and subset satisfied", () => {
    const align = evaluateConversionAlignment(
      [LEATHER_CLEANER],
      ["cleaning", "wax"],
      null
    );
    expect(align.actionMatchType).toBe("partial");
    expect(align.tagsMatched).toContain("cleaning");
    expect(align.tagsUnmatched).toContain("wax");
  });
});
