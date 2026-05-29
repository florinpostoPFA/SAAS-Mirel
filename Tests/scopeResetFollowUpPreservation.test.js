const { __test } = require("../services/chatService");

const {
  isInterrogativeFollowUpMessage,
  hasExplicitTopicShiftOnNewTurn
} = __test;

describe("scope_reset follow-up detection (F4 patch 3)", () => {
  it("detects interrogative follow-ups", () => {
    expect(isInterrogativeFollowUpMessage("Care e cel mai bun?")).toBe(true);
    expect(isInterrogativeFollowUpMessage("cum aplic")).toBe(true);
    expect(isInterrogativeFollowUpMessage("Recomanda detergent")).toBe(false);
  });

  it("detects topic shift when object changes", () => {
    const prev = { context: "interior", object: "scaun", surface: "textile", action: "clean" };
    expect(hasExplicitTopicShiftOnNewTurn("Care produs e bun pentru jante?", prev)).toBe(true);
    expect(hasExplicitTopicShiftOnNewTurn("Care e cel mai bun?", prev)).toBe(false);
  });
});
