import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const JSONL_PATH = resolve(ROOT, 'tmp/applicability.final.jsonl');
const PRODUCTS_PATH = resolve(ROOT, 'data/products.json');
const FAILURES_LOG = resolve(__dirname, 'applicability-merge-failures.log');
const MAX_FAILURES = 20;

// ─── Closed enums (locked 2026-05-25) ───

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

// ─── Validation ───

export function validateApplicability(record) {
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

// ─── Main ───

async function main() {
  if (!existsSync(JSONL_PATH)) {
    console.error(`ERROR: Input file not found: ${JSONL_PATH}`);
    process.exit(1);
  }

  const products = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf-8'));
  const idIndex = new Map();
  for (let i = 0; i < products.length; i++) {
    idIndex.set(products[i].id, i);
  }

  if (existsSync(FAILURES_LOG)) unlinkSync(FAILURES_LOG);

  const records = [];
  const rl = createInterface({ input: createReadStream(JSONL_PATH, 'utf-8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    records.push(JSON.parse(line));
  }

  let merged = 0;
  let skipped = 0;
  let skuNotFound = 0;

  for (const record of records) {
    const sku = record.id || record.sku;
    const toValidate = record.applicability || {
      finish: record.finish,
      effect: record.effect,
      material_compatibility: record.material_compatibility,
      use_case: record.use_case,
      flow: record.flow,
      customer_language: record.customer_language,
      dilution: record.dilution
    };

    const errors = validateApplicability(toValidate);
    if (errors) {
      skipped++;
      appendFileSync(FAILURES_LOG, JSON.stringify({ sku, reason: errors, raw: record }) + '\n');
      if (skipped > MAX_FAILURES) {
        console.error(`HARD FAIL: >${MAX_FAILURES} records failed validation. Aborting without writing.`);
        process.exit(1);
      }
      continue;
    }

    const idx = idIndex.get(sku);
    if (idx === undefined) {
      skuNotFound++;
      continue;
    }

    const product = products[idx];
    const { applicability: _discard, ...rest } = product;
    products[idx] = { ...rest, applicability: toValidate };
    merged++;
  }

  writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2) + '\n', 'utf-8');

  const totalWithApplicability = products.filter(p => p.applicability).length;
  const totalWithout = products.length - totalWithApplicability;

  console.log('=== Merge Summary ===');
  console.log(`Input records:          ${records.length}`);
  console.log(`Merged (valid + found): ${merged}`);
  console.log(`Skipped (validation):   ${skipped}`);
  console.log(`SKU not in catalog:     ${skuNotFound}`);
  console.log(`Products with applicability: ${totalWithApplicability}`);
  console.log(`Products without:       ${totalWithout}`);

  if (skipped > 0) {
    console.warn(`⚠ ${skipped} records failed — see ${FAILURES_LOG}`);
  }
}

main();
