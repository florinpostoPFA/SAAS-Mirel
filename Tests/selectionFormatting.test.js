jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

const { __test } = require("../services/chatService");

const {
  formatSelectionResponse,
  buildMicroExplanation,
  isCleaningProduct
} = __test;

describe("Selection response clarity", () => {
  it("includes why-this-product explanation for textile cleaner", () => {
    const why = buildMicroExplanation({
      name: "Cleaner Textil",
      tags: ["textile", "cleaner", "interior_cleaner"]
    });

    expect(why).toMatch(/pentru curatare sigura a textilelor din interior/i);
  });

  it("adds usage context only when selection includes cleaning products", () => {
    const withCleaning = formatSelectionResponse([
      { name: "Cleaner Textil", tags: ["textile", "cleaner"] }
    ], {});
    const withoutCleaning = formatSelectionResponse([
      { name: "Laveta", tags: ["microfiber", "tool"] }
    ], {});

    expect(withCleaning).toContain(
      "Cum se foloseste: aplica pe suprafata si sterge cu laveta curata."
    );
    expect(withoutCleaning).not.toContain(
      "Cum se foloseste: aplica pe suprafata si sterge cu laveta curata."
    );
  });

  it("caps rendered product bullets to max 3", () => {
    const text = formatSelectionResponse([
      { name: "P1", tags: ["textile", "cleaner"] },
      { name: "P2", tags: ["textile", "cleaner"] },
      { name: "P3", tags: ["microfiber", "tool"] },
      { name: "P4", tags: ["textile", "cleaner"] }
    ], {});

    const bulletCount = (String(text).match(/^- /gm) || []).length;
    expect(bulletCount).toBeLessThanOrEqual(3);
  });

  it("classifies cleaning products via deterministic tags", () => {
    expect(isCleaningProduct({ tags: ["shampoo"] })).toBe(true);
    expect(isCleaningProduct({ tags: ["microfiber", "tool"] })).toBe(false);
  });
});
