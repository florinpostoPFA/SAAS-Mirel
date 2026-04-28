const fs = require("fs");
const path = require("path");

const productRoles = require("../data/product_roles.json");
const { executeFlow } = require("../services/flowExecutor");

describe("Flow role integrity", () => {
  it("all flow step roles are defined in product role registry", () => {
    const flowsDir = path.join(__dirname, "..", "flows");
    const flowFiles = fs.readdirSync(flowsDir).filter((file) => file.endsWith(".json"));
    const missing = [];

    for (const file of flowFiles) {
      const flow = JSON.parse(fs.readFileSync(path.join(flowsDir, file), "utf8"));
      const steps = Array.isArray(flow?.steps) ? flow.steps : [];
      for (const step of steps) {
        const roles = Array.isArray(step?.roles)
          ? step.roles
          : Array.isArray(step?.productRoles)
            ? step.productRoles
            : [];
        for (const role of roles) {
          if (!productRoles[role]) {
            missing.push({
              file,
              flowId: flow?.flowId || null,
              stepId: step?.id || null,
              role
            });
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("Decontamination flow fallback safety", () => {
  it("decontamination_basics returns paint-safe product candidates when roles are configured", () => {
    const flow = require("../flows/decontamination_basics.json");
    const catalog = [
      {
        id: "iron1",
        name: "Iron Remover Exterior",
        tags: ["exterior", "decontamination", "iron_remover", "cleaner"],
        searchText: "iron remover fallout cleaner"
      },
      {
        id: "clay1",
        name: "Clay Bar Kit",
        tags: ["exterior", "decontamination", "clay", "clay_bar"],
        searchText: "argila clay bar decontaminare mecanica"
      },
      {
        id: "glass1",
        name: "Laveta fina pentru sticla",
        tags: ["glass", "microfiber"],
        searchText: "laveta geamuri"
      }
    ];

    const out = executeFlow(
      flow,
      catalog,
      { context: "exterior", surface: "paint", object: "caroserie" },
      { responseLocale: "ro" }
    );

    expect(Array.isArray(out.products)).toBe(true);
    expect(out.products.length).toBeGreaterThan(0);
    expect(out.products.some((p) => p.id === "iron1" || p.id === "clay1")).toBe(true);
  });
});
