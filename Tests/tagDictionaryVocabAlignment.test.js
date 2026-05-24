/**
 * Structural invariant: surface slots in tagDictionary are supersets of tagVocabulary surface values.
 * @jest-environment node
 */

const tagDictionary = require("../services/tagDictionary");
const tagVocabulary = require("./tagVocabulary.json");

const SURFACE_SLOT_TO_VOCAB = tagDictionary.SURFACE_SLOT_TO_VOCAB;

describe("tagDictionary vocab alignment", () => {
  const surfaceVocabNames = tagVocabulary.vocabulary.surface.tags.map((t) => t.name);

  it("maps every surface vocab tag to a dictionary slot", () => {
    const covered = new Set();
    for (const tags of Object.values(SURFACE_SLOT_TO_VOCAB)) {
      tags.forEach((t) => covered.add(t));
    }
    for (const name of surfaceVocabNames) {
      expect(covered.has(name)).toBe(true);
    }
  });

  it.each(Object.entries(SURFACE_SLOT_TO_VOCAB))(
    "slot %s array is a superset of its vocab values",
    (slot, vocabTags) => {
      const keywords = tagDictionary[slot];
      expect(Array.isArray(keywords)).toBe(true);
      const keywordSet = new Set(keywords.map((k) => String(k).toLowerCase()));
      for (const vocabTag of vocabTags) {
        expect(keywordSet.has(vocabTag)).toBe(true);
      }
    }
  );

  it("exposes expansion helpers for retrieval", () => {
    expect(typeof tagDictionary.expandTagForProductMatch).toBe("function");
    expect(typeof tagDictionary.productTagsSatisfyTag).toBe("function");
    expect(tagDictionary.productTagsSatisfyTag(["leather_natural", "conditioning"], "leather")).toBe(
      true
    );
  });
});
