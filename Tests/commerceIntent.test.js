const { hasExplicitCommerceProductIntent } = require("../services/commerceIntentSignals");

describe("commerce intent expansion (EPIC 3.1)", () => {
  test.each([
    "cat costa pentru jante?",
    "ai ceva bun pentru bord?",
    "recomanda-mi ceva pentru tapiterie",
    "ce folosesc pentru mocheta?"
  ])("matches commerce phrase: %s", (message) => {
    expect(hasExplicitCommerceProductIntent(message)).toBe(true);
  });

  test("does not mark neutral informational as commerce", () => {
    expect(hasExplicitCommerceProductIntent("ce este detailingul auto")).toBe(false);
  });
});

