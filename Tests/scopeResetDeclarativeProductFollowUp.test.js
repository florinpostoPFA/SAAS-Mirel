"use strict";

const {
  isDeclarativeProductRecommendationFollowUp,
  isInterrogativeFollowUpMessage
} = require("../services/chatService").__test;

describe("scope_reset declarative product follow-up (F6)", () => {
  it("detects declarative product recommendation phrasing", () => {
    expect(
      isDeclarativeProductRecommendationFollowUp(
        "Recomanda un produs bun pentru protejarea vopselei"
      )
    ).toBe(true);
    expect(isDeclarativeProductRecommendationFollowUp("Care e cel mai bun?")).toBe(false);
    expect(isInterrogativeFollowUpMessage("Care e cel mai bun?")).toBe(true);
  });
});
