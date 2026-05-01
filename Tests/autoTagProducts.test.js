const { inferDeterministicTags } = require("../scripts/autoTagProducts");

describe("inferDeterministicTags", () => {
  it("tags wheel/rim products with wheels when name contains Jante", () => {
    const tags = inferDeterministicTags({
      name: "Cleaner Jante Pro",
      description: ""
    });
    expect(tags).toContain("wheels");
  });

  it("tags tire products with tires (plural) when name contains anvelope", () => {
    const tags = inferDeterministicTags({
      name: "Dressing pentru anvelope",
      description: ""
    });
    expect(tags).toContain("tires");
  });

  it("never emits singular tag tire; English tire keyword maps to tires", () => {
    const tags = inferDeterministicTags({
      name: "Black tire dressing",
      description: ""
    });
    expect(tags).toContain("tires");
    expect(tags).not.toContain("tire");
  });
});
