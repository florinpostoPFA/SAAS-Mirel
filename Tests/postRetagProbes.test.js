/**
 * Gate B smoke tests — CLI structure only (do not assert all-PASS pre-retag).
 * @jest-environment node
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { evaluateProbe } = require("../scripts/runPostRetagProbes");

const CLI_PATH = path.join(__dirname, "../scripts/runPostRetagProbes.js");
const CORPUS_PATH = path.join(__dirname, "postRetagProbes.corpus.json");

describe("Gate B post-retag probes", () => {
  it("corpus meets Step 1.5 coverage rules", () => {
    const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
    const probes = corpus.probes;
    expect(probes.length).toBeGreaterThanOrEqual(15);
    expect(probes.length).toBeLessThanOrEqual(21);

    const categories = ["tires", "wheels", "interior_plastic", "leather", "glass"];
    for (const cat of categories) {
      expect(probes.filter((p) => p.category === cat).length).toBeGreaterThanOrEqual(3);
    }

    const brands = ["Koch Chemie", "Gtechniq", "ZviZZer", "Ewocar", "ADBL"];
    for (const brand of brands) {
      expect(probes.some((p) => p.brand === brand)).toBe(true);
    }

    expect(probes.filter((p) => p.brand === "ZviZZer").length).toBeGreaterThanOrEqual(3);
  });

  it("evaluateProbe enforces four Gate B assertions", () => {
    const pass = evaluateProbe({
      productsLength: 2,
      products: [{ manufacturerId: "13" }, { manufacturerId: "99" }],
      productsReason: "strict"
    });
    expect(pass.status).toBe("PASS");

    const fail = evaluateProbe({
      productsLength: 0,
      products: [],
      productsReason: "no_matching_products"
    });
    expect(fail.status).toBe("FAIL");
    expect(fail.fail.length).toBeGreaterThanOrEqual(2);
  });

  it("CLI runs without crash and prints per-probe lines + summary (smoke)", () => {
    const result = spawnSync(process.execPath, [CLI_PATH], {
      encoding: "utf-8",
      cwd: path.join(__dirname, ".."),
      timeout: 300000
    });

    expect(result.error).toBeUndefined();
    expect(result.stdout).toMatch(/=== Gate B summary ===/);
    expect(result.stdout).toMatch(/^total: \d+$/m);

    const probeLines = result.stdout
      .split("\n")
      .filter((line) => /^\[(PASS|FAIL|WARN)\]/.test(line));
    expect(probeLines.length).toBeGreaterThanOrEqual(15);
    expect(probeLines.length).toBeLessThanOrEqual(21);

    const passMatch = result.stdout.match(/^pass: (\d+)$/m);
    const failMatch = result.stdout.match(/^fail: (\d+)$/m);
    expect(passMatch).toBeTruthy();
    expect(failMatch).toBeTruthy();

    // Pre-retag: failures expected; CLI still exits 1 when any FAIL
    expect([0, 1]).toContain(result.status);
  }, 300000);
});
