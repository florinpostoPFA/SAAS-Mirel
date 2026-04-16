const {
  extractJSON,
  parseTagsFromResponse,
  sanitizeTags
} = require("../scripts/autoTagProducts");

describe("autoTagProducts parsing", () => {
  it("cleans a markdown fenced JSON array", () => {
    const response = "```json\n[\"cleaning\", \"interior\"]\n```";

    expect(extractJSON(response)).toBe("[\"cleaning\", \"interior\"]");
  });

  it("parses tags when the JSON array is wrapped in prose", () => {
    const response = "Here are the best tags:\n```json\n[\"cleaning\", \"interior\"]\n```\nUse these.";

    expect(parseTagsFromResponse(response)).toEqual(["cleaning", "interior"]);
  });

  it("sanitizes parsed tags to the allowed normalized list", () => {
    expect(sanitizeTags(["Cleaning", "Interior", "not-allowed"]))
      .toEqual(["cleaning", "interior"]);
  });
});