const { applyProductTagOverrides } = require("../services/tagNormalization");
const { autoTagProduct } = require("../services/autoTagService");

describe("deterministic tag overrides", () => {
  it("applies forcedTags after deterministic/auto tagging", () => {
    const product = {
      id: "sku-test-1",
      name: "Universal cleaner",
      description: "curatare rapida",
      forcedTags: ["glass", "jante", "piele"]
    };

    const autoTags = autoTagProduct(product);
    const merged = applyProductTagOverrides(autoTags, product);

    expect(merged).toContain("glass");
    expect(merged).toContain("wheels");
    expect(merged).toContain("leather");
  });
});
