const { spawnSync } = require("child_process");
const path = require("path");
const {
  diffExpectedVsActual,
  normalizeList
} = require("../scripts/runGroundTruthHarness");
const { loadTagVocabulary } = require("../scripts/autoTagProducts");

const HARNESS_SCRIPT = path.join(__dirname, "../scripts/runGroundTruthHarness.js");

describe("Gate A ground truth harness", () => {
  it("diff logic flags required mismatches and optional missing as WARN", () => {
    const { categoryMeta } = loadTagVocabulary();
    const categoryTagSets = {};
    for (const [cat, block] of Object.entries(categoryMeta)) {
      categoryTagSets[cat] = new Set(block.tags.map((t) => t.name));
    }

    const failResult = diffExpectedVsActual(
      {
        location: "exterior",
        surface: ["tires"],
        purpose: "protection",
        product_type: "tire_dressing",
        finish: "gloss"
      },
      ["exterior", "tires", "protection", "tire_cleaner"],
      categoryTagSets
    );
    expect(failResult.status).toBe("FAIL");
    expect(failResult.fail.some((m) => m.includes("product_type"))).toBe(true);

    const warnResult = diffExpectedVsActual(
      {
        location: "interior",
        surface: ["glass"],
        purpose: "cleaning",
        product_type: "glass_cleaner",
        coating_safety: "coating_safe"
      },
      ["interior", "glass", "cleaning", "glass_cleaner"],
      categoryTagSets
    );
    expect(warnResult.status).toBe("WARN");
    expect(warnResult.warn.some((m) => m.includes("coating_safety"))).toBe(true);
  });

  it("CLI exits non-zero on pre-retag catalog baseline (Gate A expected failure)", () => {
    const result = spawnSync(process.execPath, [HARNESS_SCRIPT], {
      encoding: "utf-8",
      cwd: path.join(__dirname, "..")
    });

    expect(result.stdout).toMatch(/=== Gate A summary ===/);
    expect(result.stdout).toMatch(/total: 25/);
    expect(result.status).not.toBe(0);
    expect(result.status).toBe(1);

    const passMatch = result.stdout.match(/^pass: (\d+)$/m);
    const failMatch = result.stdout.match(/^fail: (\d+)$/m);
    expect(passMatch).toBeTruthy();
    expect(failMatch).toBeTruthy();
    expect(Number(failMatch[1])).toBeGreaterThan(0);
  });
});
