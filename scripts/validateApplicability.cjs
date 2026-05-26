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
    if (!FINISH_ENUM.has(record.finish)) {
      errors.push(`finish: invalid value "${record.finish}"`);
    }
  }

  if (!EFFECT_ENUM.has(record.effect)) {
    errors.push(`effect: invalid value "${record.effect}"`);
  }

  if (!Array.isArray(record.material_compatibility) || record.material_compatibility.length === 0) {
    errors.push('material_compatibility: must be non-empty array');
  } else {
    for (const v of record.material_compatibility) {
      if (!MATERIAL_ENUM.has(v)) errors.push(`material_compatibility: invalid value "${v}"`);
    }
  }

  if (!Array.isArray(record.use_case) || record.use_case.length === 0) {
    errors.push('use_case: must be non-empty array');
  } else {
    for (const v of record.use_case) {
      if (!USE_CASE_ENUM.has(v)) errors.push(`use_case: invalid value "${v}"`);
    }
  }

  if (!Array.isArray(record.flow)) {
    errors.push('flow: must be array');
  } else {
    for (const v of record.flow) {
      if (!FLOW_ENUM.has(v)) errors.push(`flow: invalid value "${v}"`);
    }
  }

  if (!Array.isArray(record.customer_language)) {
    errors.push('customer_language: must be array');
  } else if (record.customer_language.length < 6 || record.customer_language.length > 8) {
    errors.push(`customer_language: length ${record.customer_language.length} not in [6,8]`);
  } else {
    for (const v of record.customer_language) {
      if (typeof v !== 'string' || v.trim().length === 0) {
        errors.push('customer_language: contains non-string or empty entry');
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
          errors.push(`dilution: missing or empty use_case`);
        }
      }
    }
  }

  return errors.length === 0 ? null : errors;
}

module.exports = {
  validateApplicability,
  FINISH_ENUM,
  EFFECT_ENUM,
  MATERIAL_ENUM,
  USE_CASE_ENUM,
  FLOW_ENUM
};
