/**
 * Step 2 — findProductsByRoleConfig text-fallback for empty-tag rows.
 * @jest-environment node
 */

const { __test } = require("../services/chatService");
const productRoles = require("../data/product_roles.json");

const tireDressingRole = productRoles.tire_dressing;

describe("findProductsByRoleConfig empty-tag text-fallback", () => {
  test("tagged product satisfying requiredTags still passes (no regression)", () => {
    const products = [
      { id: "td-tagged", name: "Luciu anvelope X", tags: ["dressing", "tires"] }
    ];
    const matches = __test.findProductsByRoleConfig(tireDressingRole, products);
    expect(matches.some((p) => p.id === "td-tagged")).toBe(true);
  });

  test("empty tags + matchText hits name rescues product", () => {
    const products = [
      { id: "td-empty", name: "Luciu anvelope ZviZZer Wet Gel", tags: [] }
    ];
    const matches = __test.findProductsByRoleConfig(tireDressingRole, products);
    expect(matches.some((p) => p.id === "td-empty")).toBe(true);
  });

  test("tagged product missing requiredTags stays rejected despite matchText", () => {
    const products = [
      { id: "td-wrong-tag", name: "Luciu anvelope ZviZZer Wet Gel", tags: ["wash"] }
    ];
    const matches = __test.findProductsByRoleConfig(tireDressingRole, products);
    expect(matches.some((p) => p.id === "td-wrong-tag")).toBe(false);
  });

  test("empty tags without matchText configured does not rescue", () => {
    const roleNoMatchText = {
      requiredTags: ["dressing"],
      matchText: []
    };
    const products = [
      { id: "td-no-vocab", name: "Luciu anvelope ZviZZer Wet Gel", tags: [] }
    ];
    const matches = __test.findProductsByRoleConfig(roleNoMatchText, products);
    expect(matches.some((p) => p.id === "td-no-vocab")).toBe(false);
  });
});
