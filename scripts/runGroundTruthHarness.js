#!/usr/bin/env node
/**
 * Gate A — tier-1 ground truth diff harness (Step 1.4).
 * Compares Tests/tierOneGroundTruth.json expected_tags vs product.tags in data/products.json.
 *
 * Tag field: scripts/autoTagProducts.js persists to product.tags (flat string[]), not aiTags.
 *
 * Exit 0 when no FAIL (PASS and WARN OK). Exit 1 when any SKU FAIL.
 */
const fs = require("fs");
const path = require("path");
const {
  VOCABULARY_CATEGORIES,
  loadTagVocabulary
} = require("./autoTagProducts");

const GROUND_TRUTH_PATH = path.join(__dirname, "../Tests/tierOneGroundTruth.json");
const PRODUCTS_PATH = path.join(__dirname, "../data/products.json");

const REQUIRED_KEYS = ["location", "surface", "purpose", "product_type"];
const OPTIONAL_KEYS = ["finish", "ph", "coating_safety", "concentration"];

function normalizeScalar(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => normalizeScalar(v)).filter(Boolean))].sort();
}

function loadGroundTruth() {
  return JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, "utf-8"));
}

function loadProductsById() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf-8"));
  const byId = new Map();
  for (const product of products) {
    byId.set(String(product.id), product);
    if (product.sku) {
      byId.set(String(product.sku), product);
    }
  }
  return byId;
}

function buildCategoryTagSets(categoryMeta) {
  const sets = {};
  for (const category of VOCABULARY_CATEGORIES) {
    const block = categoryMeta[category];
    if (!block?.tags) continue;
    sets[category] = new Set(block.tags.map((t) => t.name));
  }
  return sets;
}

function classifyFlatTags(flatTags, categoryTagSets) {
  const classified = {};
  for (const category of VOCABULARY_CATEGORIES) {
    classified[category] = [];
  }
  for (const tag of normalizeList(flatTags)) {
    for (const category of VOCABULARY_CATEGORIES) {
      if (categoryTagSets[category]?.has(tag)) {
        classified[category].push(tag);
      }
    }
  }
  for (const category of VOCABULARY_CATEGORIES) {
    classified[category].sort();
  }
  return classified;
}

/**
 * @returns {{ status: 'PASS'|'FAIL'|'WARN', fail: string[], warn: string[] }}
 */
function diffExpectedVsActual(expectedTags, actualFlatTags, categoryTagSets) {
  const fail = [];
  const warn = [];
  const actual = classifyFlatTags(actualFlatTags, categoryTagSets);

  const expLocation = normalizeScalar(expectedTags.location);
  const actLocation = actual.location[0];
  if (!expLocation) {
    fail.push("location: missing in expected_tags");
  } else if (!actLocation) {
    fail.push(`location: missing (expected ${expLocation})`);
  } else if (actLocation !== expLocation) {
    fail.push(`location: got ${actLocation}, expected ${expLocation}`);
  }

  const expSurface = normalizeList(expectedTags.surface);
  const actSurface = actual.surface;
  for (const surface of expSurface) {
    if (!actSurface.includes(surface)) {
      fail.push(`surface: missing ${surface}`);
    }
  }
  for (const surface of actSurface) {
    if (!expSurface.includes(surface)) {
      warn.push(`surface: extra ${surface}`);
    }
  }

  const expPurpose = normalizeScalar(expectedTags.purpose);
  const actPurpose = actual.purpose[0];
  if (!expPurpose) {
    fail.push("purpose: missing in expected_tags");
  } else if (!actPurpose) {
    fail.push(`purpose: missing (expected ${expPurpose})`);
  } else if (actPurpose !== expPurpose) {
    fail.push(`purpose: got ${actPurpose}, expected ${expPurpose}`);
  }

  const expType = normalizeScalar(expectedTags.product_type);
  const actType = actual.product_type[0];
  if (!expType) {
    fail.push("product_type: missing in expected_tags");
  } else if (!actType) {
    fail.push(`product_type: missing (expected ${expType})`);
  } else if (actType !== expType) {
    fail.push(`product_type: got ${actType}, expected ${expType}`);
  }

  for (const key of OPTIONAL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(expectedTags, key)) {
      continue;
    }
    const expected = normalizeScalar(expectedTags[key]);
    const actualValues = actual[key] || [];
    if (!expected) {
      continue;
    }
    if (actualValues.length === 0) {
      warn.push(`${key}: missing (expected ${expected})`);
      continue;
    }
    if (!actualValues.includes(expected)) {
      fail.push(`${key}: got [${actualValues.join(", ")}], expected ${expected}`);
    } else if (actualValues.length > 1) {
      warn.push(`${key}: extra values [${actualValues.filter((v) => v !== expected).join(", ")}]`);
    }
  }

  let status = "PASS";
  if (fail.length > 0) {
    status = "FAIL";
  } else if (warn.length > 0) {
    status = "WARN";
  }
  return { status, fail, warn };
}

function collectGroundTruthEntries(doc) {
  const entries = [];
  for (const [categoryName, category] of Object.entries(doc.categories || {})) {
    for (const product of category.products || []) {
      entries.push({ categoryName, product });
    }
  }
  return entries;
}

function formatDiffDetails(result) {
  const parts = [...result.fail, ...result.warn.map((w) => `WARN ${w}`)];
  return parts.length > 0 ? parts.join("; ") : "ok";
}

function runHarness() {
  const { categoryMeta } = loadTagVocabulary();
  const categoryTagSets = buildCategoryTagSets(categoryMeta);
  const groundTruth = loadGroundTruth();
  const productsById = loadProductsById();

  const summary = {
    total: 0,
    pass: 0,
    fail: 0,
    warn: 0,
    byCategory: {}
  };

  const lines = [];

  for (const { categoryName, product: entry } of collectGroundTruthEntries(groundTruth)) {
    summary.total += 1;
    if (!summary.byCategory[categoryName]) {
      summary.byCategory[categoryName] = { pass: 0, fail: 0, warn: 0, total: 0 };
    }
    summary.byCategory[categoryName].total += 1;

    const catalog = productsById.get(String(entry.magento_id)) || productsById.get(String(entry.sku));
    if (!catalog) {
      const status = "FAIL";
      summary.fail += 1;
      summary.byCategory[categoryName].fail += 1;
      lines.push(
        `[${status}] ${entry.sku} ${entry.manufacturer} "${entry.name}" — catalog SKU not found`
      );
      continue;
    }

    const actualTags = Array.isArray(catalog.tags) ? catalog.tags : [];
    const result = diffExpectedVsActual(entry.expected_tags, actualTags, categoryTagSets);
    summary[result.status.toLowerCase()] += 1;
    summary.byCategory[categoryName][result.status.toLowerCase()] += 1;

    lines.push(
      `[${result.status}] ${entry.sku} ${entry.manufacturer} "${entry.name}" — ${formatDiffDetails(result)}`
    );
  }

  for (const line of lines) {
    console.log(line);
  }

  console.log("");
  console.log("=== Gate A summary ===");
  console.log(`total: ${summary.total}`);
  console.log(`pass: ${summary.pass}`);
  console.log(`fail: ${summary.fail}`);
  console.log(`warn: ${summary.warn}`);
  for (const [categoryName, counts] of Object.entries(summary.byCategory)) {
    console.log(
      `  ${categoryName}: ${counts.pass} pass, ${counts.fail} fail, ${counts.warn} warn (${counts.total} SKUs)`
    );
  }

  const exitCode = summary.fail > 0 ? 1 : 0;
  return { exitCode, summary };
}

function main() {
  const { exitCode } = runHarness();
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_KEYS,
  OPTIONAL_KEYS,
  normalizeList,
  classifyFlatTags,
  diffExpectedVsActual,
  runHarness
};
