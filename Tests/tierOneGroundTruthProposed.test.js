const fs = require("fs");
const path = require("path");
const { loadTagVocabulary } = require("../scripts/autoTagProducts");

const FIXTURE_PATH = path.join(__dirname, "tierOneGroundTruth.proposed.json");
const REQUIRED_TAG_KEYS = ["location", "surface", "purpose", "product_type"];
const REQUIRED_ENTRY_KEYS = [
  "_source_knowledge_id",
  "magento_id",
  "sku",
  "manufacturer",
  "manufacturerId",
  "rationale"
];

function collectTagValues(expectedTags) {
  const values = [];
  for (const [key, val] of Object.entries(expectedTags)) {
    if (key === "surface" && Array.isArray(val)) {
      values.push(...val);
    } else if (typeof val === "string") {
      values.push(val);
    }
  }
  return values;
}

describe("tierOneGroundTruth.proposed.json", () => {
  let doc;
  let allowedTags;

  beforeAll(() => {
    doc = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
    allowedTags = loadTagVocabulary().allowedTags;
  });

  it("has 5 categories with expected product counts after dedup", () => {
    const expectedCounts = {
      tires: 5,
      wheels: 5,
      interior_plastic: 5,
      leather: 5,
      glass: 5
    };
    expect(Object.keys(doc.categories)).toHaveLength(5);
    for (const [name, cat] of Object.entries(doc.categories)) {
      expect(cat.products).toHaveLength(expectedCounts[name]);
    }
  });

  it("entries have required metadata and v1.1 tag categories", () => {
    const tierOne = new Set(["13", "39", "44", "70", "92"]);
    let count = 0;

    for (const [categoryName, category] of Object.entries(doc.categories)) {
      for (const product of category.products) {
        count += 1;
        for (const key of REQUIRED_ENTRY_KEYS) {
          expect(product).toHaveProperty(key);
          expect(product[key]).toBeTruthy();
        }
        expect(product.name).toBeTruthy();
        expect(tierOne.has(String(product.manufacturerId))).toBe(true);

        const tags = product.expected_tags;
        for (const key of REQUIRED_TAG_KEYS) {
          expect(tags).toHaveProperty(key);
        }
        expect(typeof tags.location).toBe("string");
        expect(Array.isArray(tags.surface)).toBe(true);
        expect(tags.surface.length).toBeGreaterThanOrEqual(1);
        expect(tags.surface.length).toBeLessThanOrEqual(3);
        expect(typeof tags.purpose).toBe("string");
        expect(typeof tags.product_type).toBe("string");

        for (const tag of collectTagValues(tags)) {
          expect(allowedTags.has(tag)).toBe(true);
        }
      }
    }
    expect(count).toBe(25);
  });
});
