#!/usr/bin/env node
/**
 * Standalone probe: tier-1 manufacturerId gate vs full catalog.
 * Usage: node scripts/probeTierOneGate.js
 */

const fs = require("fs");
const path = require("path");

const PRODUCTS_PATH = path.join(__dirname, "..", "data", "products.json");
const TIER_ONE_CONFIG_PATH = path.join(__dirname, "..", "data", "tier-one-manufacturer-ids.json");

function loadTierOneIds() {
  if (!fs.existsSync(TIER_ONE_CONFIG_PATH)) {
    return { gateEnabled: false, allowedIds: new Set(), labels: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(TIER_ONE_CONFIG_PATH, "utf8"));
  const ids = Array.isArray(parsed?.tierOneManufacturerIds) ? parsed.tierOneManufacturerIds : [];
  if (ids.length === 0) {
    return { gateEnabled: false, allowedIds: new Set(), labels: parsed?._brandLabels || {} };
  }
  return {
    gateEnabled: true,
    allowedIds: new Set(ids.map(id => Number(id)).filter(n => Number.isFinite(n))),
    labels: parsed?._brandLabels || {}
  };
}

function applyTierOneGate(products, allowedIds) {
  return products.filter(product => {
    const raw = product?.manufacturerId;
    if (raw == null || String(raw).trim() === "") {
      return false;
    }
    const id = Number(raw);
    return Number.isFinite(id) && allowedIds.has(id);
  });
}

function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
  const { gateEnabled, allowedIds, labels } = loadTierOneIds();

  if (!gateEnabled) {
    console.log("Gate OFF — missing config or empty tierOneManufacturerIds");
    process.exit(1);
  }

  const surviving = applyTierOneGate(products, allowedIds);
  const total = products.length;
  const surviveCount = surviving.length;
  const pct = ((surviveCount / total) * 100).toFixed(2);

  console.log(`Total products in catalog: ${total}`);
  console.log(`Products surviving the gate: ${surviveCount} (${pct}%)`);
  console.log("");

  const tierIds = [...allowedIds].sort((a, b) => a - b);
  console.log("Breakdown (tier-1 manufacturerIds):");
  console.log("manufacturerId | brand label | products in catalog | products surviving");
  console.log("---|---|---:|---:");

  for (const id of tierIds) {
    const label = labels[String(id)] || labels[id] || "(unknown)";
    const inCatalog = products.filter(p => Number(p.manufacturerId) === id).length;
    const pass = surviving.filter(p => Number(p.manufacturerId) === id).length;
    console.log(`${id} | ${label} | ${inCatalog} | ${pass}`);
  }

  console.log("");
  console.log("Sample SKUs per tier-1 brand (up to 3 each):");
  for (const id of tierIds) {
    const label = labels[String(id)] || labels[id] || "(unknown)";
    const samples = products
      .filter(p => Number(p.manufacturerId) === id)
      .slice(0, 3)
      .map(p => `${p.id} — ${p.name}`);
    console.log(`\n${label} (manufacturerId ${id}):`);
    samples.forEach(line => console.log(`  - ${line}`));
  }
}

main();
