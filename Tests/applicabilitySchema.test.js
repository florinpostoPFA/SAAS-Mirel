/**
 * @jest-environment node
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

const PRODUCTS_PATH = resolve(__dirname, '..', 'data', 'products.json');

function loadProducts() {
  return JSON.parse(readFileSync(PRODUCTS_PATH, 'utf-8'));
}

// ─── Inline validator (mirrors scripts/mergeApplicability.mjs) ───

const FINISH_ENUM = new Set(['mat', 'gloss', 'satin', 'natural']);
const EFFECT_ENUM = new Set([
  'cleaner', 'protectant', 'sealant', 'coating', 'polish',
  'decontaminant', 'dressing', 'wax', 'detailer', 'compound', 'cloth'
]);
const MATERIAL_ENUM = new Set([
  'paint', 'leather', 'textile', 'alcantara', 'glass', 'plastic', 'metal', 'rubber'
]);
const USE_CASE_ENUM = new Set([
  'interior_textile_cleaning', 'interior_leather_care', 'interior_plastic_care',
  'interior_glass', 'interior_general_clean', 'exterior_wash',
  'exterior_paint_polish', 'exterior_paint_protection', 'exterior_decontamination',
  'exterior_glass', 'wheels_cleaning', 'wheels_protection', 'tires_cleaning',
  'tires_dressing', 'engine_bay_cleaning', 'ceramic_application', 'tools_care'
]);
const FLOW_ENUM = new Set([
  'exterior_wash_beginner', 'interior_clean_basic', 'glass_clean_basic',
  'bug_removal_quick', 'wheel_tire_deep_clean', 'tool_care_towel',
  'decontamination_basics', 'protection_prep_basic', 'interior_quick_maintenance',
  'textile_cleaning_basic', 'leather_program_basic', 'engine_bay_safety_basic',
  'spot_correction_escalation', 'leather_ink_removal'
]);

function validateApplicability(record) {
  const errors = [];

  if (record.finish !== null && record.finish !== undefined) {
    if (!FINISH_ENUM.has(record.finish)) errors.push(`finish: invalid "${record.finish}"`);
  }
  if (!EFFECT_ENUM.has(record.effect)) errors.push(`effect: invalid "${record.effect}"`);
  if (!Array.isArray(record.material_compatibility) || record.material_compatibility.length === 0) {
    errors.push('material_compatibility: must be non-empty array');
  } else {
    for (const v of record.material_compatibility) {
      if (!MATERIAL_ENUM.has(v)) errors.push(`material_compatibility: invalid "${v}"`);
    }
  }
  if (!Array.isArray(record.use_case) || record.use_case.length === 0) {
    errors.push('use_case: must be non-empty array');
  } else {
    for (const v of record.use_case) {
      if (!USE_CASE_ENUM.has(v)) errors.push(`use_case: invalid "${v}"`);
    }
  }
  if (!Array.isArray(record.flow)) {
    errors.push('flow: must be array');
  } else {
    for (const v of record.flow) {
      if (!FLOW_ENUM.has(v)) errors.push(`flow: invalid "${v}"`);
    }
  }
  if (!Array.isArray(record.customer_language)) {
    errors.push('customer_language: must be array');
  } else if (record.customer_language.length < 6 || record.customer_language.length > 8) {
    errors.push(`customer_language: length ${record.customer_language.length} not in [6,8]`);
  } else {
    for (const v of record.customer_language) {
      if (typeof v !== 'string' || v.trim().length === 0) {
        errors.push('customer_language: contains non-string or empty');
        break;
      }
    }
  }
  if (record.dilution !== null && record.dilution !== undefined) {
    if (!Array.isArray(record.dilution)) {
      errors.push('dilution: must be null or array');
    } else {
      for (const entry of record.dilution) {
        if (!entry || typeof entry.ratio !== 'string' || entry.ratio.trim().length === 0) {
          errors.push(`dilution: missing or empty ratio`);
        }
        if (!entry || typeof entry.use_case !== 'string' || entry.use_case.trim().length === 0) {
          errors.push(`dilution: missing use_case`);
        }
      }
    }
  }
  return errors.length === 0 ? null : errors;
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
