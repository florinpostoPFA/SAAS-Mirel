const fs = require("fs");
const path = require("path");

const { executeFlow } = require("../services/flowExecutor");
const {
  inferWheelsSurfaceFromObject,
  filterProducts,
  applyFlowProductFilterWithNoWipeout
} = require("../services/chatService").__test;

function flowHasProductRoles(flow) {
  const steps = Array.isArray(flow?.steps) ? flow.steps : [];
  return steps.some((step) => {
    const roles = Array.isArray(step?.roles)
      ? step.roles
      : Array.isArray(step?.productRoles)
        ? step.productRoles
        : [];
    return roles.length > 0;
  });
}

function buildSlotVariants(flow) {
  const id = flow.flowId;
  const t = flow.triggers || {};

  if (id === "wheel_tire_deep_clean") {
    return [
      { context: "exterior", object: "jante", surface: "wheels" },
      { context: "exterior", object: "anvelope", surface: "tires" }
    ];
  }

  if (t.contexts?.includes("interior")) {
    const surf = (t.surfaces && t.surfaces[0]) || "textile";
    const obj = t.objects && t.objects[0];
    return [{ context: "interior", surface: surf, ...(obj ? { object: obj } : {}) }];
  }

  if (t.contexts?.includes("exterior")) {
    if (id === "glass_clean_basic" || id === "bug_removal_quick") {
      return [{ context: "exterior", surface: "glass", object: "geam" }];
    }
    if (id === "decontamination_basics") {
      return [{ context: "exterior", surface: "paint", object: "caroserie" }];
    }
    if (id === "protection_prep_basic") {
      return [{ context: "exterior", surface: "paint", object: "caroserie" }];
    }
    if (id === "spot_correction_escalation") {
      return [
        { context: "exterior", surface: "paint", object: "caroserie" },
        { context: "exterior", surface: "glass", object: "parbriz" }
      ];
    }
    if (id === "engine_bay_safety_basic") {
      return [{ context: "exterior", object: "motor" }];
    }
    return [{ context: "exterior" }];
  }

  return [{}];
}

describe("inferWheelsSurfaceFromObject", () => {
  it("maps anvelope to tires, not wheels, when surface is missing", () => {
    expect(inferWheelsSurfaceFromObject({ object: "anvelope", surface: null })).toEqual(
      expect.objectContaining({ object: "anvelope", surface: "tires" })
    );
  });

  it("maps jante to wheels when surface is missing", () => {
    expect(inferWheelsSurfaceFromObject({ object: "jante", surface: null })).toEqual(
      expect.objectContaining({ object: "jante", surface: "wheels" })
    );
  });

  it("does not override an existing surface", () => {
    expect(
      inferWheelsSurfaceFromObject({ object: "anvelope", surface: "wheels" })
    ).toEqual(expect.objectContaining({ surface: "wheels" }));
  });
});

describe("Flow products are not wiped out by filterProducts / safeguard", () => {
  const flowsDir = path.join(__dirname, "..", "flows");
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "products.json"), "utf8"));

  const flowFiles = fs.readdirSync(flowsDir).filter((f) => f.endsWith(".json"));

  it("every flow with product roles: executeFlow + post-filter leaves candidates when executor found any", () => {
    const failures = [];

    for (const file of flowFiles) {
      const flow = JSON.parse(fs.readFileSync(path.join(flowsDir, file), "utf8"));
      if (!flowHasProductRoles(flow)) continue;

      const variants = buildSlotVariants(flow);
      const flowId = flow.flowId || file;

      for (const slots of variants) {
        const { products: raw } = executeFlow(flow, catalog, slots, { responseLocale: "ro" });
        if (!Array.isArray(raw) || raw.length === 0) continue;

        const strictAfter = filterProducts(raw, slots);
        const outcome = applyFlowProductFilterWithNoWipeout(raw, slots, { flowId });

        if (outcome.products.length === 0) {
          failures.push({
            flowId,
            slots,
            before: raw.length,
            afterStrict: strictAfter.length,
            afterSafeguard: outcome.products.length
          });
          continue;
        }

        expect(strictAfter.length > 0 || outcome.fallbackUsed).toBe(true);
      }
    }

    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.error("FLOW_FILTER_WIPEOUT_FAILURES", JSON.stringify(failures, null, 2));
    }
    expect(failures).toEqual([]);
  });
});
