const fs = require("fs");
const path = require("path");
const {
  collectProductText,
  inferDeterministicTags
} = require("./autoTagProducts");

const PRODUCTS_PATH = path.join(__dirname, "../data/products.json");

const SURFACE_AUDIT_RULES = {
  wheels: ["janta", "jante", "rim", "rims", "wheel", "wheels"],
  tires: ["anvelopa", "anvelope", "tire", "tires"],
  glass: ["geam", "geamuri", "sticla", "glass", "windshield", "parbriz", "luneta"],
  paint: ["vopsea", "caroserie", "lac", "paint", "clearcoat"],
  leather: ["piele", "leather"],
  textile: ["textil", "material textil", "stofa", "stoffa", "fabric", "upholstery"],
  alcantara: ["alcantara"],
  plastic: ["plastic", "trim", "bord", "console"]
};

// Baseline thresholds from current catalog snapshot; fail only on regressions.
const SURFACE_AUDIT_THRESHOLDS = {
  wheels: 337,
  tires: 260,
  glass: 151,
  paint: 368,
  leather: 87,
  textile: 217,
  alcantara: 15,
  plastic: 125
};

function loadProducts() {
  const raw = fs.readFileSync(PRODUCTS_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function runSurfaceCoverageAudit(products) {
  const missesBySurface = Object.fromEntries(
    Object.keys(SURFACE_AUDIT_RULES).map((surface) => [surface, []])
  );

  for (const product of products) {
    const text = collectProductText(product);
    const tags = Array.isArray(product.tags)
      ? product.tags.map((t) => String(t || "").toLowerCase().trim())
      : [];

    for (const [surface, keywords] of Object.entries(SURFACE_AUDIT_RULES)) {
      const mentionsSurface = keywords.some((kw) => text.includes(String(kw).toLowerCase()));
      if (mentionsSurface && !tags.includes(surface)) {
        missesBySurface[surface].push(product);
      }
    }
  }

  const summary = Object.fromEntries(
    Object.entries(missesBySurface).map(([surface, list]) => [surface, list.length])
  );

  return { missesBySurface, summary };
}

function formatAuditReport(auditResult) {
  const lines = [];
  lines.push("SURFACE_TAG_COVERAGE_AUDIT");
  for (const surface of Object.keys(SURFACE_AUDIT_RULES)) {
    const misses = auditResult.missesBySurface[surface] || [];
    lines.push(`- ${surface}: misses=${misses.length}, threshold=${SURFACE_AUDIT_THRESHOLDS[surface]}`);
    for (const product of misses.slice(0, 10)) {
      const tags = Array.isArray(product.tags) ? product.tags.join(",") : "";
      lines.push(`  - ${product.id || "NO_ID"} | ${product.name || "NO_NAME"} | [${tags}]`);
    }
  }
  return lines.join("\n");
}

function checkThresholds(auditResult) {
  const failures = [];
  for (const [surface, threshold] of Object.entries(SURFACE_AUDIT_THRESHOLDS)) {
    const misses = auditResult.summary[surface] || 0;
    if (misses > threshold) {
      failures.push({ surface, misses, threshold });
    }
  }
  return failures;
}

function assertCriticalSkuDeterministicCoverage(products) {
  const sku = products.find((p) => String(p?.id || "") === "G9524");
  if (!sku) {
    return { ok: false, reason: "missing_sku" };
  }
  const inferred = inferDeterministicTags(sku);
  return { ok: inferred.includes("wheels"), reason: "deterministic_inference", inferred };
}

if (require.main === module) {
  const products = loadProducts();
  const audit = runSurfaceCoverageAudit(products);
  const failures = checkThresholds(audit);
  const critical = assertCriticalSkuDeterministicCoverage(products);

  console.log(formatAuditReport(audit));
  if (!critical.ok) {
    console.log("CRITICAL_SKU_CHECK_FAILED", critical);
  } else {
    console.log("CRITICAL_SKU_CHECK_OK", critical);
  }

  if (failures.length > 0 || !critical.ok) {
    if (failures.length > 0) {
      console.log("SURFACE_TAG_COVERAGE_THRESHOLD_FAILURES", failures);
    }
    process.exit(1);
  }
}

module.exports = {
  SURFACE_AUDIT_RULES,
  SURFACE_AUDIT_THRESHOLDS,
  loadProducts,
  runSurfaceCoverageAudit,
  formatAuditReport,
  checkThresholds,
  assertCriticalSkuDeterministicCoverage
};
