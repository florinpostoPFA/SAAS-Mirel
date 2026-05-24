#!/usr/bin/env node
/**
 * Build data/productSections.json from tier-1 long-form catalog descriptions.
 * Usage: npm run build:sections
 */
const fs = require("fs");
const path = require("path");
const { extractProductSections } = require("../services/sectionExtractor");

const TIER1_BRANDS = ["Koch Chemie", "Gtechniq", "ZviZZer", "Ewocar", "ADBL"];
const MIN_DESCRIPTION_LEN = 2000;

const ROOT = path.join(__dirname, "..");
const PRODUCTS_PATH = path.join(ROOT, "data", "products.json");
const OUT_PATH = path.join(ROOT, "data", "productSections.json");

function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
  const entries = [];

  for (const p of products) {
    if (p.removedFromCatalog) continue;
    if (!TIER1_BRANDS.includes(p.brand)) continue;
    const desc = String(p.description || "");
    if (desc.length < MIN_DESCRIPTION_LEN) continue;

    const sku = String(p.id || p.sku || "");
    if (!sku) continue;

    entries.push(extractProductSections(desc, sku));
  }

  entries.sort((a, b) => a.sku.localeCompare(b.sku));

  const payload = {
    version: "1.0-2026-05-24",
    templateVersion: "carhub-h2-v1",
    tierOneBrands: TIER1_BRANDS,
    minDescriptionLength: MIN_DESCRIPTION_LEN,
    builtAt: new Date().toISOString(),
    count: entries.length,
    entries
  };

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUT_PATH} (${entries.length} SKUs)`);

  const presence = {};
  for (const e of entries) {
    for (const [k, v] of Object.entries(e.sectionPresence || {})) {
      presence[k] = presence[k] || { present: 0, partial: 0, missing: 0 };
      presence[k][v] = (presence[k][v] || 0) + 1;
    }
  }
  console.log("Section presence summary:");
  for (const [k, counts] of Object.entries(presence)) {
    console.log(`  ${k}: present=${counts.present} partial=${counts.partial} missing=${counts.missing}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, TIER1_BRANDS, MIN_DESCRIPTION_LEN };
