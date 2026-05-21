/**
 * @jest-environment node
 */

const { wheelTireTagBoost } = require("../services/wheelTireSemantics");
const { stripInferredMaterialTags } = require("../services/materialTagGuard");
const { applyDeterministicTagFallback } = require("../services/chatService").__test;

describe("material tag guard — wheel queries", () => {
  test("generic wheel cleaning query does not include metal", () => {
    const msg = "recomanda-mi o solutie pentru curatat jantele";
    const boost = wheelTireTagBoost(msg);
    expect(boost).toContain("wheels");
    expect(boost).toContain("cleaning");
    expect(boost).not.toContain("metal");

    const merged = stripInferredMaterialTags(msg, [
      "cleaning",
      "exterior",
      "wheels",
      "metal"
    ]);
    expect(merged).not.toContain("metal");
  });

  test("ce produs pentru jante murdare includes wheels via fallback", () => {
    const tags = applyDeterministicTagFallback("ce produs pentru jante murdare", []);
    expect(tags).toContain("wheels");
    expect(tags).not.toContain("metal");
  });

  test("explicit aluminum wheel query keeps metal", () => {
    const msg = "solutie pentru jante din aluminiu";
    const boost = wheelTireTagBoost(msg);
    expect(boost).toContain("metal");

    const merged = stripInferredMaterialTags(msg, [
      "cleaning",
      "exterior",
      "wheels",
      "metal"
    ]);
    expect(merged).toContain("metal");
  });
});
