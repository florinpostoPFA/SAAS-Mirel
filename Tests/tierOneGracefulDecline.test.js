/**
 * Step 3 — tier-1 graceful Romanian decline (productsReason=tier_one_unavailable).
 * @jest-environment node
 */

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/logger", () => ({
  logInfo: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const { info } = require("../services/logger");
const { __test } = require("../services/chatService");
const productRoles = require("../data/product_roles.json");

describe("tier-1 graceful decline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("tier-1 candidate survives gate (no decline)", () => {
    const preGate = [{ id: "koch", manufacturerId: "13" }, { id: "other", manufacturerId: "999" }];
    const postGate = __test.applyTierOneManufacturerGate(preGate);
    expect(postGate.length).toBe(1);
    expect(postGate[0].manufacturerId).toBe("13");
    expect(__test.isTierOneGateWipe(preGate, postGate)).toBe(false);
  });

  test("all non-tier-1 candidates wiped → tier_one_unavailable decline shape", async () => {
    const preGate = [
      { id: "a", manufacturerId: "999" },
      { id: "b", manufacturerId: "1000" }
    ];
    const postGate = __test.applyTierOneManufacturerGate(preGate);
    expect(postGate).toEqual([]);
    expect(__test.isTierOneGateWipe(preGate, postGate)).toBe(true);
    expect(__test.classifyEmptySelectionReason(preGate, postGate)).toBe(
      __test.PRODUCTS_REASON_TIER_ONE_UNAVAILABLE
    );

    const result = await __test.returnSelectionFailSafe(
      { sessionContext: { responseLocale: "ro" }, message: "test query" },
      "sess-tier-one-decline",
      { action: "recommend", flowId: null, missingSlot: null },
      { context: "exterior", surface: "tires", object: "anvelope" },
      {
        reply: __test.TIER_ONE_UNAVAILABLE_COPY_RO,
        productsReason: __test.PRODUCTS_REASON_TIER_ONE_UNAVAILABLE
      }
    );

    expect(result.products || []).toEqual([]);
    expect(result.productsReason).toBe(__test.PRODUCTS_REASON_TIER_ONE_UNAVAILABLE);
    expect(result.reply.startsWith(__test.TIER_ONE_UNAVAILABLE_COPY_RO)).toBe(true);
  });

  test("pre-gate already empty keeps no_matching_products (not tier_one_unavailable)", () => {
    expect(__test.isTierOneGateWipe([], [])).toBe(false);
    expect(__test.classifyEmptySelectionReason([], [])).toBe("no_matching_products");
  });

  test("ROLE_CONFIG_TEXT_FALLBACK logs non-null roleId", () => {
    const products = [{ id: "td-empty", name: "Luciu anvelope ZviZZer Wet Gel", tags: [] }];
    __test.findProductsByRoleConfig(productRoles.tire_dressing, products, "tire_dressing");

    const fallbackLog = info.mock.calls.find(
      (call) => call[1] === "ROLE_CONFIG_TEXT_FALLBACK"
    );
    expect(fallbackLog).toBeDefined();
    expect(fallbackLog[2].roleId).toBe("tire_dressing");
  });
});
