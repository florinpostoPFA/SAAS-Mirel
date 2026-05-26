/**
 * @jest-environment node
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { validateApplicability } = require('../scripts/validateApplicability.cjs');

const PRODUCTS_PATH = resolve(__dirname, '..', 'data', 'products.json');

function loadProducts() {
  return JSON.parse(readFileSync(PRODUCTS_PATH, 'utf-8'));
}

// ─── Tests ───

describe('Applicability schema validation', () => {
  let products;
  beforeAll(() => { products = loadProducts(); });

  test('Pilot SKU — Boost+ (B00): effect is coating, no cloth/textile contamination', () => {
    const p = products.find(p => p.id === 'B00');
    expect(p).toBeDefined();
    expect(p.applicability).toBeDefined();
    expect(p.applicability.effect).toBe('coating');
    expect(p.applicability.effect).not.toBe('cloth');
    expect(p.applicability.material_compatibility).not.toContain('textile');
  });

  test('Pilot SKU — Hydro36 (HD-36): dilution null, flow includes protection_prep_basic, customer_language has ceramic phrasing', () => {
    const p = products.find(p => p.id === 'HD-36');
    expect(p).toBeDefined();
    expect(p.applicability).toBeDefined();
    expect(p.applicability.dilution).toBeNull();
    expect(p.applicability.flow).toContain('protection_prep_basic');
    const hasCeramic = p.applicability.customer_language.some(
      phrase => /ceramic|protec[tț]ie ceramic/i.test(phrase)
    );
    expect(hasCeramic).toBe(true);
  });

  test('Pilot SKU — Plast X (G12310): effect is polish, material includes plastic', () => {
    const p = products.find(p => p.id === 'G12310');
    expect(p).toBeDefined();
    expect(p.applicability).toBeDefined();
    expect(p.applicability.effect).toBe('polish');
    expect(p.applicability.material_compatibility).toContain('plastic');
  });

  test('Pilot SKU — Koch Chemie MZR (86001): material covers plastic/textile/rubber, dilution populated', () => {
    const p = products.find(p => p.id === '86001');
    expect(p).toBeDefined();
    expect(p.applicability).toBeDefined();
    expect(p.applicability.material_compatibility).toContain('plastic');
    expect(p.applicability.material_compatibility).toContain('textile');
    expect(p.applicability.material_compatibility).toContain('rubber');
    expect(Array.isArray(p.applicability.dilution)).toBe(true);
    expect(p.applicability.dilution.length).toBeGreaterThan(0);
    const hasExpectedRatio = p.applicability.dilution.some(
      d => d.ratio === '1:5' || d.ratio === '1:10'
    );
    expect(hasExpectedRatio).toBe(true);
  });

  test('Pilot SKU — Kenotek Coat It Force: use_case includes ceramic_application, no textile', () => {
    const p = products.find(p => p.id === '00.1137 + 00.1138' || p.id === 'FORCE2');
    expect(p).toBeDefined();
    expect(p.applicability).toBeDefined();
    expect(p.applicability.use_case).toContain('ceramic_application');
    expect(p.applicability.material_compatibility).not.toContain('textile');
  });

  test('Full schema sweep: all 1925 products with applicability pass validation', () => {
    const withApplicability = products.filter(p => p.applicability);
    expect(withApplicability.length).toBe(1925);

    const failures = [];
    for (const p of withApplicability) {
      const errs = validateApplicability(p.applicability);
      if (errs) failures.push({ id: p.id, errors: errs });
    }
    if (failures.length > 0) {
      console.error('Schema failures:', JSON.stringify(failures.slice(0, 5), null, 2));
    }
    expect(failures.length).toBe(0);
  });

  test('Absent applicability is allowed: at least one deferred SKU has no applicability field', () => {
    const withoutApplicability = products.filter(p => !p.applicability);
    expect(withoutApplicability.length).toBeGreaterThan(0);
    const sample = withoutApplicability[0];
    expect(sample.applicability).toBeUndefined();
  });
});
