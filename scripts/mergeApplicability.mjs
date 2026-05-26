import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';
import validators from './validateApplicability.cjs';

const { validateApplicability } = validators;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const JSONL_PATH = resolve(ROOT, 'tmp/applicability.final.jsonl');
const PRODUCTS_PATH = resolve(ROOT, 'data/products.json');
const FAILURES_LOG = resolve(__dirname, 'applicability-merge-failures.log');
const MAX_FAILURES = 20;

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
