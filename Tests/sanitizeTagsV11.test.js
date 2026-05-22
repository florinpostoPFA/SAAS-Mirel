const { sanitizeTags, loadTagVocabulary } = require("../scripts/autoTagProducts");

describe("sanitizeTags v1.1", () => {
  const { allowedTags } = loadTagVocabulary();

  it("keeps in-vocabulary tags", () => {
    const { tags, droppedUnknownTags } = sanitizeTags(
      ["exterior", "tires", "tire_dressing", "protection", "wet_look"],
      allowedTags
    );
    expect(tags).toEqual(
      expect.arrayContaining(["exterior", "tires", "tire_dressing", "protection", "wet_look"])
    );
    expect(droppedUnknownTags).toEqual([]);
  });

  it("drops legacy v0 tags and reports them in droppedUnknownTags", () => {
    const { tags, droppedUnknownTags } = sanitizeTags(
      ["interior", "plastic", "dressing", "cleaning", "mat"],
      allowedTags
    );
    expect(tags).toEqual(["interior", "cleaning"]);
    expect(droppedUnknownTags).toEqual(expect.arrayContaining(["plastic", "dressing", "mat"]));
  });

  it("removes cleaning when polish is present", () => {
    const { tags } = sanitizeTags(["polish", "cleaning", "paint"], allowedTags);
    expect(tags).toContain("polish");
    expect(tags).not.toContain("cleaning");
  });

  it("allows at most one purpose tag", () => {
    const { tags } = sanitizeTags(
      ["protection", "coating", "exterior", "sealant"],
      allowedTags
    );
    const purposes = tags.filter((t) =>
      ["cleaning", "decontamination", "polish", "protection", "coating", "conditioning", "restoration", "neutralization"].includes(t)
    );
    expect(purposes.length).toBe(1);
  });
});
