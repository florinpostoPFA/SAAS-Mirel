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
      { id: "td-tagged", name: "Luciu anvelope X", tags: ["tire_dressing", "tires"] }
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

  test("empty tags + customer_language match rescues product (via: customer_language)", () => {
    const coatingRole = {
      requiredTags: ["coating"],
      matchText: ["ceramic", "coating", "protecție ceramică"]
    };
    const products = [
      {
        id: "boost-mock",
        name: "GTechniq Boost+",
        category: "",
        searchText: "GTechniq Boost",
        tags: [],
        applicability: {
          customer_language: [
            "protecție ceramică care durează",
            "ceva care să țină 6 luni",
            "vreau ceva hidrofob",
            "ce pun peste ceramic",
            "boost pentru protecție",
            "vreau un strat suplimentar"
          ]
        }
      }
    ];
    const matches = __test.findProductsByRoleConfig(coatingRole, products);
    expect(matches.some((p) => p.id === "boost-mock")).toBe(true);
  });

  test("empty tags without applicability field still graceful (no rescue)", () => {
    const coatingRole = {
      requiredTags: ["coating"],
      matchText: ["ceramic", "coating"]
    };
    const products = [
      { id: "no-app", name: "Random Tool", category: "", searchText: "", tags: [] }
    ];
    const matches = __test.findProductsByRoleConfig(coatingRole, products);
    expect(matches.some((p) => p.id === "no-app")).toBe(false);
  });

  test("tagged product NOT rescued by customer_language alone", () => {
    const coatingRole = {
      requiredTags: ["coating"],
      matchText: ["ceramic", "coating", "protecție ceramică"]
    };
    const products = [
      {
        id: "tagged-wrong",
        name: "Some Product",
        category: "",
        searchText: "",
        tags: ["wash"],
        applicability: {
          customer_language: ["protecție ceramică care durează", "vreau ceramic", "hidrofob bun", "boost ceramic", "protectie lunga", "strat extra"]
        }
      }
    ];
    const matches = __test.findProductsByRoleConfig(coatingRole, products);
    expect(matches.some((p) => p.id === "tagged-wrong")).toBe(false);
  });
});
