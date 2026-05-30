"use strict";

const productRoles = require("../data/product_roles.json");
const { __test: { findProductsByRoleConfig } } = require("../services/chatService");

const GLASS_PRODUCT = {
  id: "glass-stub-1",
  name: "Solutie geamuri Koch",
  tags: ["glass", "glass_cleaner", "exterior", "cleaner"],
  searchText: "solutie curatare geam parbriz sticla faruri",
  manufacturerId: "13"
};

describe("F12 — glass_cleaner role matchText (faruri)", () => {
  it("matches glass_cleaner role for cum curat farurile?", () => {
    const roleConfig = productRoles.glass_cleaner;
    expect(roleConfig).toBeDefined();
    expect(roleConfig.matchText).toContain("faruri");

    const candidates = findProductsByRoleConfig(roleConfig, [GLASS_PRODUCT], "glass_cleaner");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((p) => p.id === "glass-stub-1")).toBe(true);
  });
});
