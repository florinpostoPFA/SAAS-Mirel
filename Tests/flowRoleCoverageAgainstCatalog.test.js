const fs = require("fs");
const path = require("path");

const products = require("../data/products.json");
const { resolveProductsForRole } = require("../services/flowExecutor");

function collectRolesReferencedByFlows() {
  const flowsDir = path.join(__dirname, "..", "flows");
  const flowFiles = fs.readdirSync(flowsDir).filter((file) => file.endsWith(".json"));
  const roles = new Set();

  for (const file of flowFiles) {
    const flow = JSON.parse(fs.readFileSync(path.join(flowsDir, file), "utf8"));
    const steps = Array.isArray(flow?.steps) ? flow.steps : [];

    for (const step of steps) {
      const stepRoles = Array.isArray(step?.roles)
        ? step.roles
        : Array.isArray(step?.productRoles)
          ? step.productRoles
          : [];

      for (const role of stepRoles) {
        roles.add(role);
      }
    }
  }

  return Array.from(roles).sort();
}

describe("Flow role coverage against catalog", () => {
  it("every role referenced by flows resolves to at least one product in data/products.json", () => {
    const rolesReferencedByFlows = collectRolesReferencedByFlows();

    const rolesWithZeroMatchingProducts = rolesReferencedByFlows
      .filter((role) => {
        const resolved = resolveProductsForRole(role, products);
        return !Array.isArray(resolved) || resolved.length < 1;
      })
      .sort();

    if (rolesWithZeroMatchingProducts.length > 0) {
      throw new Error(
        [
          `rolesWithZeroMatchingProducts: ${JSON.stringify(rolesWithZeroMatchingProducts)}`,
          `totalRolesChecked: ${rolesReferencedByFlows.length}`,
          `totalProductsLoaded: ${Array.isArray(products) ? products.length : 0}`
        ].join("\n")
      );
    }

    expect(rolesWithZeroMatchingProducts).toEqual([]);
  });
});
