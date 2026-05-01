const {
  SURFACE_AUDIT_RULES,
  SURFACE_AUDIT_THRESHOLDS,
  loadProducts,
  runSurfaceCoverageAudit,
  formatAuditReport,
  checkThresholds,
  assertCriticalSkuDeterministicCoverage
} = require("../scripts/tag-coverage-audit");

describe("Surface tag coverage audit (offline)", () => {
  it("keeps text-surface mismatch counts under configured thresholds", () => {
    const products = loadProducts();
    const audit = runSurfaceCoverageAudit(products);
    const failures = checkThresholds(audit);

    // Always print compact report to make regressions obvious in CI logs.
    // eslint-disable-next-line no-console
    console.log(formatAuditReport(audit));

    for (const surface of Object.keys(SURFACE_AUDIT_RULES)) {
      expect(audit.summary[surface] || 0).toBeLessThanOrEqual(SURFACE_AUDIT_THRESHOLDS[surface]);
    }
    expect(failures).toEqual([]);
  });

  it("ensures critical SKU G9524 deterministically infers wheels", () => {
    const products = loadProducts();
    const critical = assertCriticalSkuDeterministicCoverage(products);
    expect(critical.ok).toBe(true);
  });
});
