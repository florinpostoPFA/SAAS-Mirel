/**
 * Merge approved dilution recommendations into products.json.
 * Only updates applicability.dilution where null.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PRODUCTS_PATH = path.join(ROOT, "data/products.json");
const REVIEW_PATH = path.join(ROOT, "reports/dilution_metadata_review.json");
const PREVIEW_PATH = path.join(ROOT, "reports/dilution_merge_preview.md");
const SUMMARY_PATH = path.join(ROOT, "reports/dilution_merge_summary.md");
const PATCH_PATH = path.join(ROOT, "reports/dilution_merge_patch.json");

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function recommendationSource(row) {
  if (row.confidence === "high" || row.inference === "description") {
    return "Explicit description";
  }
  if (row.inference === "product_line") {
    return "Same product line";
  }
  if (row.inference === "brand_category") {
    return "Same brand exemplar";
  }
  return row.inference || "Unknown";
}

const HIGH_RISK_NAME = [
  /\bbetisoare\b/,
  /\bswabs?\b/,
  /\bsuport.*telefon\b/,
  /\bracleta\b/,
  /\bkit produse\b/,
  /\bodorizant\b/,
  /\bair re-fresher\b/,
  /\bset galeata\b/,
  /\bgaleata spalare\b/,
  /\bempty bucket\b/,
  /\bscraper\b/,
  /\bautocolant\b/,
  /\bmagnetic\b/,
  /\bphone\b/
];

function assessRisk(row) {
  const name = norm(row.name);
  if (HIGH_RISK_NAME.some(re => re.test(name))) {
    return "High";
  }

  const dil = row.recommended_dilution || [];
  const useCases = row.use_case || [];

  if (row.confidence === "high") {
    if (
      row.category === "shampoo" &&
      dil[0]?.use_case === "exterior_wash" &&
      !useCases.includes("exterior_wash") &&
      /tapiterie|upholstery|carpet|textil/i.test(row.name)
    ) {
      return "Medium";
    }
    if ((row.description_extract || []).some(e => /dilut/i.test(e.excerpt || ""))) {
      return "Low";
    }
    return "Low";
  }

  if (row.confidence === "medium") {
    if (row.inference === "product_line") {
      return dil.length > 2 ? "Medium" : "Low";
    }
    if (/510%|1525%|50ml:10l/i.test(JSON.stringify(dil))) {
      return "High";
    }
    if (!row.tags?.includes("concentrate") && row.category === "apc" && row.inference === "brand_category") {
      return "High";
    }
    if (row.inference === "brand_category") {
      return "Medium";
    }
    return "Medium";
  }

  return "High";
}

function mdEscape(s) {
  return String(s || "").replace(/\|/g, "\\|");
}

function formatDilution(dil) {
  if (dil == null) {
    return "null";
  }
  if (!Array.isArray(dil) || dil.length === 0) {
    return "[]";
  }
  return dil.map(d => `${d.ratio} → ${d.use_case}`).join("; ");
}

function buildMergePlan(products, reviewRows) {
  const byId = new Map(products.map(p => [String(p.id), p]));
  const updated = [];
  const rejected = [];
  const skipped = [];

  for (const row of reviewRows) {
    const product = byId.get(String(row.id));
    const risk = assessRisk(row);
    const source = recommendationSource(row);
    const entry = {
      id: row.id,
      name: row.name,
      confidence: row.confidence,
      risk,
      source,
      existing_dilution: product?.applicability?.dilution ?? null,
      new_dilution: row.recommended_dilution
    };

    if (!product) {
      skipped.push({ ...entry, reason: "product_not_found" });
      continue;
    }

    if (!row.recommended_dilution || !Array.isArray(row.recommended_dilution) || row.recommended_dilution.length === 0) {
      skipped.push({ ...entry, reason: "no_recommended_dilution" });
      continue;
    }

    if (row.confidence === "low") {
      skipped.push({ ...entry, reason: "confidence_tier_low_not_in_final_review" });
      continue;
    }

    if (risk === "High") {
      rejected.push({ ...entry, reason: "high_risk_rejected" });
      continue;
    }

    if (product.applicability?.dilution != null) {
      skipped.push({ ...entry, reason: "existing_dilution_not_null" });
      continue;
    }

    if (!product.applicability || typeof product.applicability !== "object") {
      skipped.push({ ...entry, reason: "missing_applicability_block" });
      continue;
    }

    updated.push({ ...entry, reason: "approved_merge" });
  }

  return { updated, rejected, skipped };
}

function renderPreview(plan) {
  const lines = [
    "# Dilution Merge Preview",
    "",
    `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
    "**Action:** Pending merge into `data/products.json`",
    "",
    `**Approved for merge:** ${plan.updated.length} products (LOW + MEDIUM risk)`,
    "",
    "| SKU | Product Name | Existing dilution | New dilution | Confidence | Risk | Source |",
    "|-----|--------------|-------------------|--------------|------------|------|--------|"
  ];

  for (const row of plan.updated) {
    lines.push(
      `| ${row.id} | ${mdEscape(row.name.slice(0, 55))} | null | ${mdEscape(formatDilution(row.new_dilution))} | ${row.confidence} | ${row.risk} | ${row.source} |`
    );
  }

  lines.push("");
  lines.push(`**Rejected (HIGH risk):** ${plan.rejected.length}`);
  lines.push(`**Skipped:** ${plan.skipped.length}`);
  return lines.join("\n");
}

function renderSummary(plan, applyResult) {
  const lowMerged = plan.updated.filter(r => r.risk === "Low").length;
  const mediumMerged = plan.updated.filter(r => r.risk === "Medium").length;

  return [
    "# Dilution Merge Summary",
    "",
    `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
    "**Target:** `data/products.json` → `applicability.dilution` only",
    "",
    "## Results",
    "",
    "| Metric | Count |",
    "|--------|------:|",
    `| Total products updated | ${applyResult.applied} |`,
    `| LOW risk merged | ${lowMerged} |`,
    `| MEDIUM risk merged | ${mediumMerged} |`,
    `| HIGH risk rejected | ${plan.rejected.length} |`,
    `| Skipped | ${plan.skipped.length} |`,
    `| Conflicts encountered | ${applyResult.conflicts.length} |`,
    "",
    ...(applyResult.conflicts.length
      ? [
          "## Conflicts",
          "",
          ...applyResult.conflicts.map(c => `- \`${c.id}\`: ${c.reason}`),
          ""
        ]
      : []),
    "## Updated SKUs",
    "",
    ...plan.updated.map(r => `- \`${r.id}\` (${r.risk} risk, ${r.confidence} confidence)`),
    "",
    "## Audit files",
    "",
    "- [`dilution_merge_preview.md`](./dilution_merge_preview.md)",
    "- [`dilution_merge_patch.json`](./dilution_merge_patch.json)"
  ].join("\n");
}

function applyMerge(products, plan) {
  const byId = new Map(products.map(p => [String(p.id), p]));
  const conflicts = [];
  let applied = 0;

  for (const row of plan.updated) {
    const product = byId.get(String(row.id));
    if (!product?.applicability) {
      conflicts.push({ id: row.id, reason: "missing_applicability_at_apply_time" });
      continue;
    }
    if (product.applicability.dilution != null) {
      conflicts.push({ id: row.id, reason: "dilution_already_set_at_apply_time" });
      continue;
    }
    product.applicability.dilution = JSON.parse(JSON.stringify(row.new_dilution));
    applied += 1;
  }

  return { applied, conflicts };
}

function main() {
  const applyChanges = process.argv.includes("--apply");

  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
  const review = JSON.parse(fs.readFileSync(REVIEW_PATH, "utf8"));
  const plan = buildMergePlan(products, review.rows || []);

  fs.writeFileSync(PREVIEW_PATH, renderPreview(plan));
  console.log(`Wrote ${PREVIEW_PATH} (${plan.updated.length} approved)`);

  const patch = {
    generated_at: new Date().toISOString(),
    updated: plan.updated,
    rejected: plan.rejected,
    skipped: plan.skipped
  };

  if (!applyChanges) {
    fs.writeFileSync(PATCH_PATH, JSON.stringify(patch, null, 2));
    console.log(`Wrote ${PATCH_PATH} (preview only, run with --apply to merge)`);
    return;
  }

  const applyResult = applyMerge(products, plan);
  fs.writeFileSync(PRODUCTS_PATH, `${JSON.stringify(products, null, 2)}\n`);
  JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));

  fs.writeFileSync(PATCH_PATH, JSON.stringify({ ...patch, applyResult }, null, 2));
  fs.writeFileSync(SUMMARY_PATH, renderSummary(plan, applyResult));

  console.log(`Applied ${applyResult.applied} dilution updates to ${PRODUCTS_PATH}`);
  console.log(`Wrote ${SUMMARY_PATH}`);
  console.log(`Wrote ${PATCH_PATH}`);
}

main();
