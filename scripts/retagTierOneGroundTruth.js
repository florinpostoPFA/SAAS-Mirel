#!/usr/bin/env node
/**
 * Re-tag only tier-1 Gate A SKUs (25) with current autoTagProducts pipeline.
 * Usage: node scripts/retagTierOneGroundTruth.js [--dry-run]
 */
const fs = require("fs");
const path = require("path");
const { generateTagsForProduct } = require("./autoTagProducts");
const { applyProductTagOverrides } = require("../services/tagNormalization");

const GROUND_TRUTH_PATH = path.join(__dirname, "../Tests/tierOneGroundTruth.json");
const PRODUCTS_PATH = path.join(__dirname, "../data/products.json");

function loadTierOneSkus(doc) {
  const skus = new Set();
  for (const category of Object.values(doc.categories || {})) {
    for (const product of category.products || []) {
      if (product.sku) skus.add(String(product.sku));
      if (product.magento_id) skus.add(String(product.magento_id));
    }
  }
  return skus;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const doc = JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, "utf-8"));
  const tierOneSkus = loadTierOneSkus(doc);
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf-8"));

  let updated = 0;
  for (const product of products) {
    const id = String(product.id);
    const sku = String(product.sku || "");
    if (!tierOneSkus.has(id) && !tierOneSkus.has(sku)) {
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would retag ${id} ${product.name?.slice(0, 50)}`);
      updated += 1;
      continue;
    }

    product.tags = [];
    const result = await generateTagsForProduct(product, { llmOnly: true });
    product.tags = applyProductTagOverrides(result.tags, product);
    console.log(`Tagged ${id}:`, product.tags.join(", "));
    updated += 1;
  }

  if (!dryRun) {
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
  }

  console.log(`${dryRun ? "Would retag" : "Retagged"} ${updated} tier-1 products.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
