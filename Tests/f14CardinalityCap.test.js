"use strict";

const { __test } = require("../services/chatService");
const { formatSelectionResponse, RECOMMEND_MAX_ALTERNATIVES } = __test;

describe("F14 2-alt cardinality cap", () => {
  it("returns at most 2 products from a 5-product mock list", () => {
    const products = [1, 2, 3, 4, 5].map((n) => ({
      id: `p${n}`,
      name: `Product ${n}`,
      tags: ["interior"],
      selectionMeta: {}
    }));
    const out = formatSelectionResponse(products, { locale: "ro" });
    expect(__test.RECOMMEND_MAX_ALTERNATIVES).toBe(2);
    expect(RECOMMEND_MAX_ALTERNATIVES).toBe(2);
    const mentions = (out.match(/Product \d/g) || []).length;
    expect(mentions).toBeLessThanOrEqual(2);
    expect(mentions).toBeGreaterThan(0);
  });
});
