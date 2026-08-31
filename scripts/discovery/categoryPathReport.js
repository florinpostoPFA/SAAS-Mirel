/**
 * Step 5e — categoryPath distribution + coverage report (discovery only).
 * Usage: node scripts/discovery/categoryPathReport.js
 * Output: scripts/discovery/categoryPath-report.md
 */
const fs = require("fs");
const path = require("path");

const products = require("../../data/products.json");

const TIER1_BRANDS = [
  { brand: "Koch Chemie", manufacturerId: "13" },
  { brand: "Gtechniq", manufacturerId: "39" },
  { brand: "ZviZZer", manufacturerId: "44" },
  { brand: "Ewocar", manufacturerId: "70" },
  { brand: "ADBL", manufacturerId: "92" }
];

const TIRE_PATH_RE = /cauciuc|anvelop|tire|bandouri/i;
const WHEEL_PATH_RE = /jante|wheel|felgen/i;
const LEATHER_PATH_RE = /piele|leather|tapiterie/i;
const PROMO_PATH_RE = /kituri|reduceri|oferte/i;

const TIRE_TAGS = ["tires", "rubber", "tire_cleaner", "tire_dressing", "cauciuc"];
const WHEEL_TAGS = ["wheels", "metal", "wheel_cleaner"];

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isTier1(p) {
  return TIER1_BRANDS.some((t) => t.brand === p.brand);
}

function pathSegments(categoryPath) {
  const p = String(categoryPath || "").trim();
  if (!p) return [];
  return p.split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean);
}

function hasTag(p, tag) {
  const tags = Array.isArray(p.tags) ? p.tags : [];
  return tags.includes(tag);
}

function hasAnyTag(p, tagList) {
  return tagList.some((t) => hasTag(p, t));
}

function matchesPath(p, re) {
  return re.test(String(p.categoryPath || ""));
}

function mdTable(headers, rows) {
  const esc = (c) => String(c).replace(/\|/g, "\\|");
  const lines = [
    "| " + headers.map(esc).join(" | ") + " |",
    "| " + headers.map(() => "---").join(" | ") + " |"
  ];
  for (const row of rows) {
    lines.push("| " + row.map(esc).join(" | ") + " |");
  }
  return lines.join("\n");
}

function tagCrossReport(productsActive, pathRe, tagList, label) {
  const pathMatches = productsActive.filter((p) => matchesPath(p, pathRe));
  const lines = [`### ${label}`, "", `Products matching path pattern: **${pathMatches.length}**`, ""];

  for (const tag of tagList) {
    const withTag = productsActive.filter((p) => hasTag(p, tag));
    const agreed = withTag.filter((p) => matchesPath(p, pathRe));
    const tagNotPath = withTag.filter((p) => !matchesPath(p, pathRe));
    const pathNotTag = pathMatches.filter((p) => !hasTag(p, tag));

    lines.push(`#### Tag \`${tag}\``);
    lines.push(`- Agreed (tag + path): **${agreed.length}**`);
    lines.push(`- Tag says ${label}, category disagrees: **${tagNotPath.length}**`);
    lines.push(`- Category says ${label}, tag disagrees: **${pathNotTag.length}**`);
    if (tagNotPath.length > 0 && tagNotPath.length <= 15) {
      lines.push(
        "",
        "Tag-not-path SKUs:",
        ...tagNotPath.map(
          (p) =>
            `  - \`${p.id}\` · ${p.brand} · \`${(p.categoryPath || "").slice(0, 80)}\` · tags=[${(p.tags || []).join(", ")}]`
        )
      );
    } else if (tagNotPath.length > 15) {
      lines.push("", `Tag-not-path: ${tagNotPath.length} SKUs (first 10):`);
      for (const p of tagNotPath.slice(0, 10)) {
        lines.push(
          `  - \`${p.id}\` · ${p.brand} · \`${(p.categoryPath || "").slice(0, 80)}\` · tags=[${(p.tags || []).join(", ")}]`
        );
      }
    }
    if (pathNotTag.length > 0 && pathNotTag.length <= 10) {
      lines.push(
        "",
        "Path-not-tag SKUs:",
        ...pathNotTag.map(
          (p) =>
            `  - \`${p.id}\` · ${p.brand} · tags=[${(p.tags || []).join(", ")}]`
        )
      );
    } else if (pathNotTag.length > 10) {
      lines.push("", `Path-not-tag: ${pathNotTag.length} SKUs (first 8):`);
      for (const p of pathNotTag.slice(0, 8)) {
        lines.push(`  - \`${p.id}\` · ${p.brand} · tags=[${(p.tags || []).join(", ")}]`);
      }
    }
    lines.push("");
  }

  lines.push("#### All path matches (sku, brand, path, tags, tier-1)");
  lines.push("");
  lines.push(
    mdTable(
      ["SKU", "Brand", "Tier-1", "manufacturerId", "tags", "categoryPath"],
      pathMatches.slice(0, 80).map((p) => [
        p.id,
        p.brand || "",
        isTier1(p) ? "yes" : "no",
        p.manufacturerId || "",
        (p.tags || []).join(", ") || "(none)",
        p.categoryPath || ""
      ])
    )
  );
  if (pathMatches.length > 80) {
    lines.push("", `*…and ${pathMatches.length - 80} more path matches (truncated).*`);
  }
  return lines.join("\n");
}

function main() {
  const active = products.filter((p) => !p.removedFromCatalog);
  const withPath = active.filter((p) => String(p.categoryPath || "").trim().length > 0);
  const emptyPath = active.length - withPath.length;
  const taggedCount = active.filter((p) => Array.isArray(p.tags) && p.tags.length > 0).length;

  // §1 Coverage
  const coverageRows = TIER1_BRANDS.map(({ brand, manufacturerId }) => {
    const group = active.filter((p) => p.brand === brand);
    const nonEmpty = group.filter((p) => String(p.categoryPath || "").trim().length > 0);
    return {
      brand,
      manufacturerId,
      total: group.length,
      nonEmpty: nonEmpty.length,
      pct: group.length ? Math.round((nonEmpty.length / group.length) * 100) : 0
    };
  });

  // §2 Top 30 paths
  const pathCounts = new Map();
  for (const p of active) {
    const cp = String(p.categoryPath || "").trim() || "(empty)";
    if (!pathCounts.has(cp)) pathCounts.set(cp, { count: 0, tier1: 0 });
    const row = pathCounts.get(cp);
    row.count += 1;
    if (isTier1(p)) row.tier1 += 1;
  }
  const topPaths = [...pathCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 30);

  // §3 Depth histogram (split on " / ")
  const depthHist = {};
  for (const p of active) {
    const segs = pathSegments(p.categoryPath);
    const depth = segs.length;
    const bucket = depth === 0 ? "0 (empty)" : depth >= 5 ? "5+" : String(depth);
    depthHist[bucket] = (depthHist[bucket] || 0) + 1;
  }

  // §6 Leather paths frequency
  const leatherProducts = active.filter((p) => matchesPath(p, LEATHER_PATH_RE));
  const leatherPathFreq = new Map();
  for (const p of leatherProducts) {
    const cp = p.categoryPath || "(empty)";
    leatherPathFreq.set(cp, (leatherPathFreq.get(cp) || 0) + 1);
  }
  const leatherTop = [...leatherPathFreq.entries()].sort((a, b) => b[1] - a[1]);

  // §7 Promo/bundle
  const promoProducts = active.filter((p) => matchesPath(p, PROMO_PATH_RE));
  const promoSamples = promoProducts.slice(0, 5);

  // §8 Diacritics sample
  const diacriticPaths = new Set();
  const diacriticRe = /[ăâîșțĂÂÎȘȚáéíóú]/;
  for (const p of active) {
    const cp = String(p.categoryPath || "");
    if (diacriticRe.test(cp)) diacriticPaths.add(cp);
  }
  const diacriticSample = [...diacriticPaths].slice(0, 10);

  // Prespălare typo flag
  const prespalareTypo = active.filter((p) =>
    /prespălareauto|prespalareauto/i.test(String(p.categoryPath || ""))
  );

  const md = `# categoryPath discovery report (Step 5e)

**Ticket:** [Step 5e — categoryPath discovery report](https://www.notion.so/f2b306e32b284dd6963e040523dde583)
**Date:** ${new Date().toISOString().slice(0, 10)}
**Catalog:** \`data/products.json\` (${products.length} rows, ${active.length} active)
**Generator:** \`node scripts/discovery/categoryPathReport.js\`

> Discovery only — no \`services/\` or \`data/\` changes. Runtime does not read \`categoryPath\` today.

---

## 1. Coverage

| Metric | Value |
|--------|-------|
| Total products (catalog) | ${products.length} |
| Active (not removedFromCatalog) | ${active.length} |
| Non-empty categoryPath | ${withPath.length} (${Math.round((withPath.length / active.length) * 100)}%) |
| Empty / missing categoryPath | ${emptyPath} |
| Products with non-empty \`tags[]\` | ${taggedCount} (${Math.round((taggedCount / active.length) * 100)}%) |

${taggedCount === 0 ? "> **⚠ Tag cross-checks (§4–§5):** This catalog snapshot has **zero** populated \`tags\` arrays. Agreed/tag-disagree counts reflect empty tags, not categoryPath quality. Re-run after Step 5 retag for meaningful tag↔path alignment.\n" : ""}
### Per tier-1 brand

${mdTable(
  ["Brand", "manufacturerId", "SKUs", "Non-empty path", "%"],
  coverageRows.map((r) => [r.brand, r.manufacturerId, r.total, r.nonEmpty, `${r.pct}%`])
)}

---

## 2. Distribution — top 30 distinct paths

${mdTable(
  ["count", "tier-1 count", "categoryPath"],
  topPaths.map(([cp, { count, tier1 }]) => [count, tier1, cp])
)}

---

## 3. Depth distribution

Path segments split on \` / \` (Magento breadcrumb separator).

| Segments | Product count |
|----------|---------------|
${Object.entries(depthHist)
  .sort((a, b) => {
    const order = ["0 (empty)", "1", "2", "3", "4", "5+"];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  })
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join("\n")}

**Note:** \`resolveCategoryPath\` (Step 5c) picks the **deepest** path by \`/\` count, tiebreak alphabetical — see \`scripts/lib/magentoCategories.js\`.

---

## 4. Tire-bug pattern check

Path pattern: \`/cauciuc|anvelop|tire|bandouri/i\` on full \`categoryPath\`.

${tagCrossReport(active, TIRE_PATH_RE, TIRE_TAGS, "tire")}

---

## 5. Wheel-bug pattern check

Path pattern: \`/jante|wheel|felgen/i\` on full \`categoryPath\`.

${tagCrossReport(active, WHEEL_PATH_RE, WHEEL_TAGS, "wheel")}

---

## 6. Leather sub-variant check (Step 5b axis)

Products with path matching \`/piele|leather|tapiterie/i\`: **${leatherProducts.length}**

### categoryPath frequency (leather-pattern products)

${mdTable(
  ["count", "categoryPath"],
  leatherTop.slice(0, 20).map(([cp, n]) => [n, cp])
)}

**Sub-variant signal in tree?** Cristi's Magento tree uses **functional buckets** (e.g. \`Curățarea interioarelor auto\`, \`Protejarea interioarelor auto\`) — not \`leather_natural\` / \`leather_synthetic\` / \`alcantara\` as separate leaf nodes. Name-level keywords still required for sub-variant disambiguation.

---

## 7. Promo/bundle conflation risk

Products where path contains \`Kituri\`, \`Reduceri\`, or \`Oferte\`: **${promoProducts.length}** (${Math.round((promoProducts.length / active.length) * 100)}% of active catalog).

**Deepest-path-wins:** When a SKU has multiple Magento category assignments, Step 5c stores only one path — the deepest by slash count. If a tire SKU is assigned both \`Cauciucuri & Bandouri\` (depth ~4) and \`Kituri / Reduceri\` (depth ~3), **Cauciucuri wins** and tire substring matching still works. Risk is the inverse: promo path deeper than functional path → functional category masked.

### Sample: 5 promo-path products

${promoSamples
  .map(
    (p, i) =>
      `#### Sample ${i + 1}: \`${p.id}\` — ${p.name.slice(0, 60)}…
- brand: ${p.brand}
- categoryPath: ${p.categoryPath}
- tags: [${(p.tags || []).join(", ") || "none"}]
- searchText category mention: ${/cauciuc|anvelop|jante|piele/i.test(p.searchText || "") ? "yes (name/path keywords in searchText)" : "no obvious functional category in searchText"}`
  )
  .join("\n\n")}

*Tire-pattern products under promo-only path:* ${active.filter((p) => matchesPath(p, PROMO_PATH_RE) && matchesPath(p, TIRE_PATH_RE)).length} SKUs.

---

## 8. Romanian normalization sample

10 distinct paths with diacritics — raw vs NFKD-stripped lowercase:

${mdTable(
  ["Raw path", "norm(path)"],
  diacriticSample.map((cp) => [cp, norm(cp)])
)}

**Matching guidance:** Use \`normalize('NFD')\` + strip combining marks before substring checks; do not rely on exact equality. Known typo: \`PrespălareAuto\` (no space) — ${prespalareTypo.length} product(s) affected; substring \`prespalare\` still matches.

---

## Recommendations (decision gate)

### 1. Tire-bug hotfix via categoryPath substring?

**Yes (narrow hotfix).** ${active.filter((p) => matchesPath(p, TIRE_PATH_RE)).length} SKUs sit under deterministic tire/wheel-band paths (\`Cauciucuri & Bandouri / …\`).${taggedCount === 0 ? " On this snapshot tags are empty — categoryPath is the **only** structured tire signal available." : " Tag–path disagreement is measurable once retag lands."} Add a **pre-filter or guard** in tire intent routing: when \`categoryPath\` matches tire pattern, restrict candidates to same pattern (or boost), without replacing tags entirely.

### 2. Can categoryPath replace Step 5b failing axes?

| Axis | Verdict |
|------|---------|
| **Tire / anvelope** | **Partial replace** — path is strong for product-type gate; keep tags for dressing vs cleaner role. |
| **Wheel / jante** | **Partial replace** — same as tire; path separates jante vs cauciuc trees cleanly. |
| **Leather sub-variant** | **No** — tree is flat (\`piele\`/\`tapiterie\` leaves); natural vs synthetic vs alcantara not in categoryPath. |
| **Surface vs material** | **No** — paths encode product department, not slot-level surface enum. |

### 3. Deepest-path-wins risk for promo/bundle?

**Medium risk, mitigable.** ${promoProducts.length} SKUs (${Math.round((promoProducts.length / active.length) * 100)}%) show promo paths; most are genuinely promo SKUs. Mitigations: (a) when path matches \`Reduceri|Kituri\`, fall back to \`searchText\` category breadcrumb if present; (b) never use categoryPath alone for routing — combine with tags/name; (c) re-import audit for hero SKUs stuck on promo path only.

---

*Generated in ${process.uptime().toFixed(2)}s*
`;

  const outPath = path.join(__dirname, "categoryPath-report.md");
  fs.writeFileSync(outPath, md);
  console.log(`Wrote ${outPath} (${md.length} chars, ${md.split("\n").length} lines)`);
}

if (require.main === module) {
  main();
}

module.exports = { main, norm, pathSegments, matchesPath };
