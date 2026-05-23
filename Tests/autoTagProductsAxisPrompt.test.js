const {
  buildPrompt,
  flattenAxisTagsObject,
  parseLlmTagResponse,
  validateAxisTagObject
} = require("../scripts/autoTagProducts");

describe("autoTagProducts per-axis prompt (Step 5b)", () => {
  it("buildPrompt requires per-axis JSON object, not flat array", () => {
    const prompt = buildPrompt({
      name: "Dressing luciu anvelope Adbl Black Water, 1L",
      description: "Tire dressing ready to use."
    });
    expect(prompt).toContain('"location": "<one tag>"');
    expect(prompt).toContain('"surface": ["<1–3 tags>"]');
    expect(prompt).not.toContain("max 5 tags total");
    expect(prompt).not.toContain("JSON array of tag name strings");
    expect(prompt).toContain("ALWAYS include `tires`");
    expect(prompt).toContain("Short description:");
    expect(prompt).toContain("iron_remover");
    expect(prompt).toContain("Few-shot examples");
  });

  it("flattenAxisTagsObject preserves flat-array downstream contract", () => {
    const flat = flattenAxisTagsObject({
      location: "exterior",
      surface: ["tires", "rubber"],
      purpose: "cleaning",
      product_type: "tire_cleaner",
      concentration: "ready_to_use"
    });
    expect(flat).toEqual([
      "exterior",
      "tires",
      "rubber",
      "cleaning",
      "tire_cleaner",
      "ready_to_use"
    ]);
  });

  it("validateAxisTagObject rejects missing required axes", () => {
    const result = validateAxisTagObject({
      location: "exterior",
      surface: ["tires"],
      purpose: "protection"
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/product_type/);
  });

  it("parseLlmTagResponse accepts per-axis JSON object", () => {
    const raw = JSON.stringify({
      location: "interior",
      surface: ["plastic_interior"],
      purpose: "conditioning",
      product_type: "trim_dressing",
      concentration: "ready_to_use"
    });
    const parsed = parseLlmTagResponse(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.flatTags).toEqual(
      expect.arrayContaining([
        "interior",
        "plastic_interior",
        "conditioning",
        "trim_dressing",
        "ready_to_use"
      ])
    );
  });

  it("parseLlmTagResponse rejects off-vocab tags", () => {
    const parsed = parseLlmTagResponse(
      JSON.stringify({
        location: "exterior",
        surface: ["tires"],
        purpose: "protection",
        product_type: "not_a_real_product_type"
      })
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/off-vocab/);
  });
});
