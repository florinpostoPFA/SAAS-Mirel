const { normalizeTagList, dropStrictFilterNoise } = require("../services/tagNormalization");
const { inferDeterministicTags } = require("../scripts/autoTagProducts");

describe("tag normalization", () => {
  it("canonicalizes object/surface synonyms to strict-filter tags", () => {
    const normalized = normalizeTagList(["geamuri", "parbriz", "sticla", "oglinda", "jante", "piele", "textil"]);
    expect(normalized).toContain("glass");
    expect(normalized).toContain("wheels");
    expect(normalized).toContain("leather");
    expect(normalized).toContain("textile");
  });

  it("drops generic noise in strict overlap checks", () => {
    const reduced = dropStrictFilterNoise(["interior", "cleaning", "glass"]);
    expect(reduced).toEqual(["glass"]);
  });

  it("auto-tag inference uses canonical wheel/glass tags for Romanian synonyms", () => {
    const tags = inferDeterministicTags({
      name: "Cleaner pentru jante si parbriz",
      description: ""
    });
    expect(tags).toContain("wheels");
    expect(tags).toContain("glass");
  });
});
