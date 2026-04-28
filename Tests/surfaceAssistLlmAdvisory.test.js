const {
  userSignalsSurfaceMaterialUncertainty,
  parseLlmMaterialArray,
  matchPickFromLlmSuggestions,
  canonicalToCtoSurface
} = require("../services/surfaceAssistLlmAdvisory");

describe("surfaceAssistLlmAdvisory", () => {
  it("detects material uncertainty phrases", () => {
    expect(userSignalsSurfaceMaterialUncertainty("nu stiu")).toBe(true);
    expect(userSignalsSurfaceMaterialUncertainty("habar n-am")).toBe(true);
    expect(userSignalsSurfaceMaterialUncertainty("idk")).toBe(true);
    expect(userSignalsSurfaceMaterialUncertainty("piele")).toBe(false);
  });

  it("parses fenced JSON allowlist", () => {
    const out = parseLlmMaterialArray('```json\n["textile","leather"]\n```');
    expect(out).toEqual(["textile", "leather"]);
  });

  it("rejects non-allowlist items", () => {
    expect(parseLlmMaterialArray('["textile","chrome"]')).toBe(null);
  });

  it("maps canonical to CTO slot values", () => {
    expect(canonicalToCtoSurface("leather")).toBe("piele");
    expect(canonicalToCtoSurface("vinyl")).toBe("plastic");
  });

  it("matches numeric pick from suggestions", () => {
    const picked = matchPickFromLlmSuggestions("2", ["leather", "textile", "alcantara"], "ro");
    expect(picked).toBe("textile");
  });
});
