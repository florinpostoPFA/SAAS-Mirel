const fs = require("fs");
const path = require("path");
const { loadTagVocabulary, VOCABULARY_PATH } = require("../scripts/autoTagProducts");

describe("tagVocabularyLoad", () => {
  it("loads Tests/tagVocabulary.json from repo", () => {
    expect(fs.existsSync(VOCABULARY_PATH)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(VOCABULARY_PATH, "utf-8"));
    expect(raw.vocabulary).toBeDefined();
  });

  it("flattens v1.1 vocabulary to 62 allowed tag names", () => {
    const { allowedTags } = loadTagVocabulary();
    expect(allowedTags.size).toBe(62);
    expect(allowedTags.has("coating_safe")).toBe(true);
    expect(allowedTags.has("leather_natural")).toBe(true);
    expect(allowedTags.has("wet_look")).toBe(true);
    expect(allowedTags.has("tire_dressing")).toBe(true);
  });

  it("keeps per-category metadata for prompt building", () => {
    const { categoryMeta } = loadTagVocabulary();
    expect(categoryMeta.location.max_tags).toBe(1);
    expect(categoryMeta.surface.tags.some((t) => t.name === "tires")).toBe(true);
    expect(categoryMeta.purpose.tags.some((t) => t.name === "decontamination")).toBe(true);
  });
});
