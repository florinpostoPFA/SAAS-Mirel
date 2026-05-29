const {
  analyzeSafetyQuery,
  isProductRecommendationQuery
} = require("../services/safetyQueryService");

describe("safety routing — product recommendation exclusion (F4 patch 4)", () => {
  it("does not treat product recommendation as safety", () => {
    expect(isProductRecommendationQuery("care produs e bun pentru jante")).toBe(true);
    const analysis = analyzeSafetyQuery("Care produs e bun pentru jante?");
    expect(analysis.triggered).toBe(false);
    expect(analysis.reason).toBe("product_recommendation_not_safety");
  });

  it("still triggers safety for compatibility questions", () => {
    const analysis = analyzeSafetyQuery("Pot folosi APC pe piele naturala?");
    expect(analysis.triggered).toBe(true);
    expect(analysis.reason).not.toBe("product_recommendation_not_safety");
  });
});
