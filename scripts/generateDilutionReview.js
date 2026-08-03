/**
 * Generate dilution metadata review for dilutable chemical products missing dilution.
 * Does NOT modify products.json.
 */
const fs = require("fs");
const path = require("path");

const products = require("../data/products.json");

const ROOT = path.resolve(__dirname, "..");
const OUT_MD = path.join(ROOT, "reports/dilution_metadata_review.md");
const OUT_JSON = path.join(ROOT, "reports/dilution_metadata_review.json");
const OUT_FALSE_POS = path.join(ROOT, "reports/dilution_false_positive_candidates.md");
const OUT_VALIDATION_V2 = path.join(ROOT, "reports/dilution_validation_report_v2.md");
const OUT_METRICS = path.join(ROOT, "reports/dilution_enrichment_metrics.md");

const RTU_SIGNALS = [
  "gata de utilizare",
  "ready to use",
  "ready-to-use",
  "nu necesita diluare",
  "nu necesită diluare",
  "fara diluare",
  "fără diluare",
  "nediluat",
  "spray direct",
  "aplicati direct",
  "aplicați direct",
  "pulverizati direct",
  "pulverizați direct",
  "nu se dilueaza",
  "nu se diluează",
  "folositi direct",
  "folosiți direct"
];

const CONCENTRATE_SIGNALS = [
  "concentrat",
  "concentrate",
  "super concentrat",
  "hyper wash",
  "dilu",
  "diluți",
  "diluti",
  "raport",
  "ratio"
];

const CHEMICAL_SIGNALS = [
  "solutie",
  "soluție",
  "sampon",
  "șampon",
  "shampoo",
  "spray",
  "lichid",
  "detergent",
  "cleaner",
  "degreaser",
  "decontamin",
  "apc",
  "all purpose",
  "all-purpose",
  "allclean",
  "lubrifiant",
  "iron remover",
  "wheel cleaner",
  "glass cleaner",
  "prewash",
  "pre-wash",
  "sampon auto",
  "agent curatare"
];

const ACCESSORY_NAME_PATTERNS = [
  { re: /\b(manusa|mănușă|wash mitt|washmitt|microfiber wash|microfibre wash)\b/i, reason: "wash mitt" },
  { re: /\b(laveta|prosop|towel|microfibra|microfibră|microfiber towel|wash glove|washglove)\b/i, reason: "microfiber towel/glove" },
  { re: /\b(perie|pensula|brush)\b/i, reason: "brush" },
  { re: /\b(galeta|găleată|bucket)\b/i, reason: "bucket" },
  { re: /\b(sita|sită|grit guard|gritguard)\b/i, reason: "grit guard" },
  {
    re: /\b(burete melamina|magic sponge|multisponge|application sponge|burete aplicator|applicator pad|aplicator pad|applicator microfibra|even coat|suport slefuire|polishing pad|foam pad|cutting pad|finishing pad)\b/i,
    reason: "applicator pad/sponge"
  },
  {
    re: /\b(burete spalare|burete spălare|burete pentru aplicare|burete polish|burete universal pentru spalare)\b/i,
    reason: "sponge/applicator"
  },
  {
    re: /\b(argila decontaminare|argila agresiv|argila blanda|argila auto|clay bar|clay mitt|clay sponge|cleaner clay|detailing clay|smooth surface clay)\b/i,
    reason: "clay bar/accessory"
  },
  { re: /\b(deschizator canistre|dispenser|dozator|pompa|pompă)\b/i, reason: "dispenser/pump/container opener" },
  { re: /\b(galeata goala|găleată goală|empty bucket|recipient gol|canistra goala|canistră goală)\b/i, reason: "empty container" },
  { re: /\b(blana de oaie|sheepskin|buffing pad|wool pad)\b/i, reason: "polish applicator" },
  { re: /\b(taler prindere|backing plate)\b/i, reason: "tool/accessory" }
];

const ACCESSORY_BLOB_PATTERNS = [
  { re: /\b(accesori(?:u|i)?(?:\s|$)|accessor(?:y|ies))\b/i, reason: "accessory" }
];

const NON_DILUTABLE_EFFECTS = new Set([
  "cloth",
  "dressing",
  "wax",
  "polish",
  "protectant",
  "sealant",
  "coating",
  "compound"
]);

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function productBlob(product) {
  return norm(
    [product.name, product.short_description, product.description, ...(product.tags || [])].join(" ")
  );
}

function isLegacyTarget(product) {
  if (!product?.applicability || product.applicability.dilution != null) {
    return false;
  }
  const effect = product.applicability.effect;
  const tags = Array.isArray(product.tags) ? product.tags : [];
  return (
    effect === "cleaner" ||
    effect === "decontaminant" ||
    tags.includes("apc") ||
    tags.includes("shampoo")
  );
}

function detectAccessory(product) {
  const nameShort = norm([product.name, product.short_description].join(" "));
  const blob = productBlob(product);
  const tags = product.tags || [];

  const isClayLubricantProduct =
    /\b(lubrifiant.*argila|lubrifiant.*clay|clay spray|slippy)\b/i.test(nameShort) &&
    !/\b(clay bar|argila decontaminare|argila agresiv|argila blanda|clay mitt|clay sponge|smooth surface clay)\b/i.test(
      nameShort
    );

  if (tags.includes("clay_bar") && !isClayLubricantProduct) {
    return "clay_bar tag (physical clay accessory)";
  }

  if (isClayLubricantProduct) {
    return null;
  }

  for (const { re, reason } of ACCESSORY_NAME_PATTERNS) {
    if (re.test(nameShort)) {
      return reason;
    }
  }

  for (const { re, reason } of ACCESSORY_BLOB_PATTERNS) {
    if (re.test(blob)) {
      return reason;
    }
  }
  if (NON_DILUTABLE_EFFECTS.has(product.applicability?.effect)) {
    return `non-dilutable effect:${product.applicability.effect}`;
  }
  return null;
}

function isChemicalProduct(product) {
  const blob = productBlob(product);
  const tags = product.tags || [];
  if (tags.includes("concentrate")) {
    return true;
  }
  if (CHEMICAL_SIGNALS.some(sig => blob.includes(norm(sig)))) {
    return true;
  }
  const effect = product.applicability?.effect;
  return effect === "cleaner" || effect === "decontaminant";
}

function isDilutionMeaningful(product) {
  const tags = product.tags || [];
  const effect = product.applicability?.effect;
  if (effect === "cleaner" || effect === "decontaminant") {
    return true;
  }
  if (tags.includes("apc") || tags.includes("shampoo") || tags.includes("concentrate")) {
    return isChemicalProduct(product);
  }
  return false;
}

function hasRtuSignal(product) {
  const blob = productBlob(product);
  const tags = product.tags || [];
  if (tags.includes("ready_to_use") && !tags.includes("concentrate")) {
    return { rtu: true, reason: "tag:ready_to_use" };
  }
  for (const sig of RTU_SIGNALS) {
    if (blob.includes(norm(sig))) {
      return { rtu: true, reason: `text:${sig}` };
    }
  }
  return { rtu: false, reason: null };
}

function classifyCandidate(product) {
  if (!isLegacyTarget(product)) {
    return { eligible: false, stage: "not_target", reason: "Outside cleaner/APC/shampoo/decontaminant scope or dilution already set." };
  }

  const accessory = detectAccessory(product);
  if (accessory) {
    return { eligible: false, stage: "accessory_exclusion", reason: `Accessory/non-chemical SKU (${accessory}).` };
  }

  if (!isChemicalProduct(product)) {
    return { eligible: false, stage: "not_chemical", reason: "No chemical product signals in name/description/tags." };
  }

  if (!isDilutionMeaningful(product)) {
    return { eligible: false, stage: "dilution_not_meaningful", reason: "Dilution not meaningful for this product type." };
  }

  const rtu = hasRtuSignal(product);
  if (rtu.rtu) {
    return { eligible: false, stage: "rtu_exclusion", reason: `Ready-to-use (${rtu.reason}).` };
  }

  return { eligible: true, stage: "candidate", reason: null };
}

function parseRatiosFromText(text, fieldName) {
  const src = norm(text);
  if (!src.trim()) {
    return [];
  }
  const found = [];
  const seen = new Set();

  function hasDilutionContext(index) {
    const window = src.slice(Math.max(0, index - 90), index + 90);
    if (
      /(?:canistr|litri|ml\b|gr\b|kg\b|mm\b|ani\b|garant)/.test(window) &&
      !/dilut|concentrat|raport|ratio|sampon|shampoo/.test(window)
    ) {
      return false;
    }
    return CONCENTRATE_SIGNALS.some(sig => window.includes(sig)) || /dilut|raport|ratio|sampon|shampoo/.test(window);
  }

  const patterns = [
    { re: /dilut(?:ie|ia)?\s*(?:de\s*)?(?:pana\s*la\s*)?(\d+)\s*(?:la|:|\s)\s*(\d+)/g, requireContext: false },
    { re: /poate fi diluat pana la\s*(\d+)\s*(?:la|:)\s*(\d+)/g, requireContext: false },
    { re: /(\d+)\s*(?:la|:)\s*(\d+)/g, requireContext: true },
    {
      re: /(\d+)\s*-\s*(\d+)\s*%/g,
      requireContext: true,
      map: (a, b) => ({ ratio: `${a}-${b}%`, note: "percent_range" })
    },
    {
      re: /(\d+(?:[.,]\d+)?)\s*%/g,
      requireContext: true,
      map: a => ({ ratio: `${String(a).replace(",", ".")}%`, note: "percent" })
    }
  ];

  for (const { re, requireContext, map } of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      if (requireContext && !hasDilutionContext(m.index)) {
        continue;
      }
      let ratio;
      if (map) {
        ratio = map(...m.slice(1)).ratio;
      } else {
        const left = Number(m[1]);
        const right = Number(m[2]);
        if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
          continue;
        }
        if (left > 1000 || right > 1000) {
          continue;
        }
        ratio = `${left}:${right}`;
      }
      if (seen.has(ratio)) {
        continue;
      }
      seen.add(ratio);
      found.push({
        ratio,
        field: fieldName,
        excerpt: src.slice(Math.max(0, m.index - 40), m.index + 60).trim()
      });
    }
  }
  return found;
}

function extractDescriptionRatios(product) {
  const fromDescription = parseRatiosFromText(product.description || "", "description");
  const fromShort = parseRatiosFromText(product.short_description || "", "short_description");
  const merged = [];
  const seen = new Set();
  for (const item of [...fromDescription, ...fromShort]) {
    if (seen.has(item.ratio)) {
      continue;
    }
    seen.add(item.ratio);
    merged.push(item);
  }
  return { fromDescription, fromShort, merged };
}

function primaryCategory(product) {
  const tags = product.tags || [];
  const useCases = product.applicability?.use_case || [];
  if (tags.includes("shampoo") || useCases.includes("exterior_wash")) {
    return "shampoo";
  }
  if (tags.includes("apc") || useCases.includes("interior_general_clean")) {
    return "apc";
  }
  if (product.applicability?.effect === "decontaminant" || tags.includes("degreaser") || tags.includes("engine_bay")) {
    return "decontaminant";
  }
  if (tags.includes("wheel_cleaner") || useCases.includes("wheels_cleaning")) {
    return "wheel_cleaner";
  }
  if (tags.includes("glass_cleaner") || useCases.includes("interior_glass") || useCases.includes("exterior_glass")) {
    return "glass_cleaner";
  }
  if (useCases.includes("interior_textile_cleaning")) {
    return "textile_cleaner";
  }
  return product.applicability?.effect || "cleaner";
}

function productLineKey(product) {
  let n = norm(product.name || "");
  if (product.brand) {
    n = n.replace(new RegExp(norm(product.brand), "g"), " ");
  }
  n = n
    .replace(/\d+\s*(?:ml|l|litri|gr|g|kg|cm|mm|oz|inch|")\b/g, " ")
    .replace(/\b[a-z]{0,2}\d{3,}[a-z0-9-]*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n.slice(0, 80);
}

function mapUseCaseLabel(product, category) {
  const useCases = product.applicability?.use_case || [];
  const preferred = {
    shampoo: "exterior_wash",
    apc: useCases.includes("interior_general_clean") ? "interior_general_clean" : "curatare generala",
    decontaminant: useCases.includes("engine_bay_cleaning") ? "engine_bay_cleaning" : "decontaminare usuala",
    wheel_cleaner: "jante",
    glass_cleaner: "curatat geamuri",
    textile_cleaner: "curatat textil",
    cleaner: useCases[0] || "general_use"
  };
  return preferred[category] || useCases[0] || "general_use";
}

function buildExemplarIndex() {
  const index = {
    byBrandCategory: new Map(),
    byCategory: new Map(),
    byBrandLine: new Map(),
    withDilution: []
  };

  for (const product of products) {
    const dil = product.applicability?.dilution;
    if (!Array.isArray(dil) || dil.length === 0) {
      continue;
    }
    if (detectAccessory(product)) {
      continue;
    }

    const brand = norm(product.brand || "unknown");
    const category = primaryCategory(product);
    const lineKey = productLineKey(product);
    const entry = {
      id: product.id,
      name: product.name,
      brand: product.brand,
      dilution: dil,
      category,
      lineKey
    };
    index.withDilution.push(entry);

    const bcKey = `${brand}::${category}`;
    if (!index.byBrandCategory.has(bcKey)) {
      index.byBrandCategory.set(bcKey, []);
    }
    index.byBrandCategory.get(bcKey).push(entry);

    if (!index.byCategory.has(category)) {
      index.byCategory.set(category, []);
    }
    index.byCategory.get(category).push(entry);

    const blKey = `${brand}::${lineKey}`;
    if (!index.byBrandLine.has(blKey)) {
      index.byBrandLine.set(blKey, []);
    }
    index.byBrandLine.get(blKey).push(entry);
  }

  return index;
}

function findProductLineExemplars(product, index) {
  const brand = norm(product.brand || "unknown");
  const lineKey = productLineKey(product);
  const exact = index.byBrandLine.get(`${brand}::${lineKey}`) || [];
  if (exact.length > 0) {
    return { matches: exact, matchType: "exact_line" };
  }

  const prefix = lineKey.slice(0, Math.min(24, lineKey.length));
  if (prefix.length < 8) {
    return { matches: [], matchType: null };
  }

  const fuzzy = [];
  for (const [key, entries] of index.byBrandLine.entries()) {
    if (!key.startsWith(`${brand}::`)) {
      continue;
    }
    const otherLine = key.slice(brand.length + 2);
    if (otherLine.startsWith(prefix) || prefix.startsWith(otherLine.slice(0, 24))) {
      fuzzy.push(...entries);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const e of fuzzy) {
    if (seen.has(e.id)) {
      continue;
    }
    seen.add(e.id);
    unique.push(e);
  }
  if (unique.length > 0) {
    return { matches: unique, matchType: "fuzzy_line" };
  }
  return { matches: [], matchType: null };
}

function modeDilution(entries) {
  const counts = new Map();
  for (const e of entries) {
    for (const d of e.dilution) {
      const key = `${d.ratio}@@${d.use_case}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    return null;
  }
  return sorted.slice(0, 3).map(([key]) => {
    const [ratio, use_case] = key.split("@@");
    return { ratio, use_case };
  });
}

function defaultByCategory(category) {
  const defaults = {
    shampoo: [{ ratio: "1:128", use_case: "exterior_wash" }],
    apc: [
      { ratio: "1:10", use_case: "curatare generala" },
      { ratio: "1:5", use_case: "contaminare medie, pete dificile" }
    ],
    decontaminant: [
      { ratio: "1:4", use_case: "pete pronuntate" },
      { ratio: "1:10", use_case: "degreasare" }
    ],
    wheel_cleaner: [{ ratio: "4:1", use_case: "curatat praful si smoala" }],
    glass_cleaner: [{ ratio: "1:40", use_case: "curatat geamuri" }],
    textile_cleaner: [{ ratio: "1:10", use_case: "curatat textil" }],
    cleaner: [{ ratio: "1:10", use_case: "general_use" }]
  };
  return defaults[category] || defaults.cleaner;
}

function recommendForProduct(product, index) {
  const category = primaryCategory(product);
  const brand = norm(product.brand || "unknown");
  const ratioExtract = extractDescriptionRatios(product);
  const useCaseLabel = mapUseCaseLabel(product, category);

  const lineMatch = findProductLineExemplars(product, index);
  const brandCategoryExemplars = index.byBrandCategory.get(`${brand}::${category}`) || [];
  const categoryExemplars = index.byCategory.get(category) || [];

  const lineModes = modeDilution(lineMatch.matches);
  const brandCategoryModes = modeDilution(brandCategoryExemplars);

  const exemplarRefs = (lineMatch.matches.length ? lineMatch.matches : brandCategoryExemplars)
    .slice(0, 3)
    .map(e => ({ id: e.id, name: e.name, dilution: e.dilution, matchType: lineMatch.matches.length ? lineMatch.matchType : "brand_category" }));

  if (ratioExtract.fromDescription.length > 0 || ratioExtract.fromShort.length > 0) {
    const recommended = ratioExtract.merged.slice(0, 3).map((r, i) => ({
      ratio: r.ratio,
      use_case: i === 0 ? useCaseLabel : `${useCaseLabel}_variant_${i + 1}`
    }));
    const sources = [];
    if (ratioExtract.fromDescription.length) {
      sources.push("description");
    }
    if (ratioExtract.fromShort.length) {
      sources.push("short_description");
    }
    return {
      recommended,
      confidence: "high",
      rationale: [
        `Explicit dilution in ${sources.join(" + ")} (${ratioExtract.merged.map(r => r.ratio).join(", ")}).`
      ],
      sources: {
        descriptionRatios: ratioExtract.merged,
        exemplarRefs,
        category,
        inference: "description"
      },
      action: "approve_candidate"
    };
  }

  if (lineModes?.length) {
    return {
      recommended: lineModes,
      confidence: "medium",
      rationale: [
        `Same product line already has dilution metadata (${lineMatch.matches.map(e => e.id).slice(0, 3).join(", ")}).`
      ],
      sources: {
        descriptionRatios: [],
        exemplarRefs: lineMatch.matches.slice(0, 3).map(e => ({
          id: e.id,
          name: e.name,
          dilution: e.dilution,
          matchType: lineMatch.matchType
        })),
        category,
        inference: "product_line"
      },
      action: "review_recommended"
    };
  }

  if (brandCategoryModes?.length && brand !== "unknown") {
    return {
      recommended: brandCategoryModes,
      confidence: "medium",
      rationale: [
        `Same brand + category exemplar mode from ${brandCategoryExemplars.length} SKU(s) with dilution.`
      ],
      sources: {
        descriptionRatios: [],
        exemplarRefs: brandCategoryExemplars.slice(0, 3).map(e => ({
          id: e.id,
          name: e.name,
          dilution: e.dilution,
          matchType: "brand_category"
        })),
        category,
        inference: "brand_category"
      },
      action: "review_recommended"
    };
  }

  const categoryModes = modeDilution(categoryExemplars);
  const recommended = categoryModes?.length ? categoryModes : defaultByCategory(category);
  return {
    recommended,
    confidence: "low",
    rationale: [
      categoryModes?.length
        ? `Category-wide exemplar mode only (${categoryExemplars.length} reference SKU(s)).`
        : `No line/brand exemplars; applied category default for '${category}'.`
    ],
    sources: {
      descriptionRatios: [],
      exemplarRefs: categoryExemplars.slice(0, 3).map(e => ({
        id: e.id,
        name: e.name,
        dilution: e.dilution,
        matchType: "category_default"
      })),
      category,
      inference: "category_default"
    },
    action: "manual_review_required"
  };
}

function buildReview() {
  const index = buildExemplarIndex();
  const metrics = {
    generated_at: new Date().toISOString().slice(0, 10),
    candidates_before_filtering: 0,
    candidates_after_filtering: 0,
    removed_by_exclusion_rules: 0,
    rtu_exclusions: 0,
    accessory_exclusions: 0,
    not_chemical_exclusions: 0,
    dilution_not_meaningful_exclusions: 0,
    high_confidence: 0,
    medium_confidence: 0,
    low_confidence: 0,
    not_applicable: 0
  };

  const falsePositives = [];
  const rows = [];

  for (const product of products) {
    if (!isLegacyTarget(product)) {
      continue;
    }
    metrics.candidates_before_filtering += 1;

    const classification = classifyCandidate(product);
    if (!classification.eligible) {
      metrics.removed_by_exclusion_rules += 1;
      if (classification.stage === "rtu_exclusion") {
        metrics.rtu_exclusions += 1;
      } else if (classification.stage === "accessory_exclusion") {
        metrics.accessory_exclusions += 1;
      } else if (classification.stage === "not_chemical") {
        metrics.not_chemical_exclusions += 1;
      } else if (classification.stage === "dilution_not_meaningful") {
        metrics.dilution_not_meaningful_exclusions += 1;
      }

      falsePositives.push({
        id: product.id,
        name: product.name,
        brand: product.brand,
        effect: product.applicability.effect,
        tags: product.tags || [],
        exclusion_stage: classification.stage,
        why_no_dilution: classification.reason,
        would_have_been_recommended: (() => {
          const rec = recommendForProduct(product, index);
          return rec.recommended;
        })()
      });
      continue;
    }

    metrics.candidates_after_filtering += 1;
    const rec = recommendForProduct(product, index);
    if (rec.confidence === "high") {
      metrics.high_confidence += 1;
    } else if (rec.confidence === "medium") {
      metrics.medium_confidence += 1;
    } else if (rec.confidence === "low") {
      metrics.low_confidence += 1;
    }

    rows.push({
      id: product.id,
      name: product.name,
      brand: product.brand,
      price: product.price,
      effect: product.applicability.effect,
      tags: product.tags || [],
      use_case: product.applicability.use_case || [],
      category: rec.sources.category,
      current_dilution: null,
      recommended_dilution: rec.recommended,
      confidence: rec.confidence,
      action: rec.action,
      inference: rec.sources.inference,
      rationale: rec.rationale,
      description_extract: rec.sources.descriptionRatios,
      exemplars: rec.sources.exemplarRefs
    });
  }

  const summary = {
    ...metrics,
    total_targets: rows.length,
    by_confidence: {},
    by_action: {},
    by_category: {},
    by_brand: {},
    false_positive_count: falsePositives.length
  };

  for (const row of rows) {
    summary.by_confidence[row.confidence] = (summary.by_confidence[row.confidence] || 0) + 1;
    summary.by_action[row.action] = (summary.by_action[row.action] || 0) + 1;
    summary.by_category[row.category] = (summary.by_category[row.category] || 0) + 1;
    const b = row.brand || "unknown";
    summary.by_brand[b] = (summary.by_brand[b] || 0) + 1;
  }

  return { summary, rows, falsePositives, metrics, index };
}

function mdEscape(s) {
  return String(s || "").replace(/\|/g, "\\|");
}

function truncate(s, n = 700) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function fullDescription(product) {
  if (!product) {
    return "(product not found)";
  }
  const parts = [];
  if (product.description) {
    parts.push(`**Description:** ${truncate(product.description, 500)}`);
  }
  if (product.short_description) {
    parts.push(`**Short description:** ${truncate(product.short_description, 400)}`);
  }
  return parts.join("\n\n") || "(no description)";
}

function renderReviewMarkdown({ summary, rows }) {
  const exemplarCount = products.filter(
    p => Array.isArray(p.applicability?.dilution) && p.applicability.dilution.length > 0
  ).length;
  const lines = [
    "# Dilution Metadata Review",
    "",
    `**Source:** \`data/products.json\``,
    `**Generated:** ${summary.generated_at}`,
    "**Scope:** chemical cleaners/APC/shampoo/decontaminants with `dilution: null`, after accessory/RTU/non-chemical exclusions.",
    `**Recommendation targets:** ${summary.total_targets} products`,
    `**Excluded from prior naive pass:** ${summary.false_positive_count} products`,
    "",
    "> Review only — `products.json` was not modified.",
    "",
    "## Methodology",
    "",
    "1. Legacy target filter: `effect` cleaner/decontaminant or tags `apc`/`shampoo`, `dilution` null.",
    "2. Hard exclusions: mitts, towels, pads, sponges, brushes, buckets, grit guards, clay bars, accessories, dispensers.",
    "3. Gates: must be chemical, dilution meaningful, not RTU.",
    "4. Confidence: **high** = explicit ratio in description/short_description; **medium** = product line or brand+category exemplar; **low** = category default.",
    `5. Exemplar pool: ${exemplarCount} enriched SKUs with dilution (accessories removed from pool).`,
    "",
    "## Summary",
    "",
    "| Metric | Count |",
    "|--------|------:|",
    `| Candidates before filtering | ${summary.candidates_before_filtering} |`,
    `| Candidates after filtering | ${summary.candidates_after_filtering} |`,
    `| Removed by exclusion rules | ${summary.removed_by_exclusion_rules} |`,
    `| Accessory exclusions | ${summary.accessory_exclusions} |`,
    `| RTU exclusions | ${summary.rtu_exclusions} |`,
    ""
  ];

  for (const [k, v] of Object.entries(summary.by_confidence).sort((a, b) => b[1] - a[1])) {
    lines.push(`| Confidence: ${k} | ${v} |`);
  }
  lines.push("");
  lines.push("See also: [`dilution_enrichment_metrics.md`](./dilution_enrichment_metrics.md), [`dilution_false_positive_candidates.md`](./dilution_false_positive_candidates.md).");
  lines.push("");
  lines.push("Full JSON: [`dilution_metadata_review.json`](./dilution_metadata_review.json)");
  return lines.join("\n");
}

function renderFalsePositiveMarkdown({ falsePositives, summary }) {
  const byStage = {};
  for (const fp of falsePositives) {
    byStage[fp.exclusion_stage] = (byStage[fp.exclusion_stage] || 0) + 1;
  }

  const lines = [
    "# Dilution False-Positive Candidates",
    "",
    `**Generated:** ${summary.generated_at}`,
    "**Purpose:** SKUs removed by exclusion rules that would have received dilution under the naive generator.",
    "",
    `**Total excluded:** ${falsePositives.length}`,
    "",
    "| Exclusion stage | Count |",
    "|-----------------|------:|"
  ];
  for (const [k, v] of Object.entries(byStage).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push("");
  lines.push("| SKU | Name | Why dilution should not exist |");
  lines.push("|-----|------|------------------------------|");
  for (const fp of falsePositives.sort((a, b) => a.exclusion_stage.localeCompare(b.exclusion_stage))) {
    lines.push(`| ${fp.id} | ${mdEscape(fp.name.slice(0, 70))} | ${mdEscape(fp.why_no_dilution)} |`);
  }
  return lines.join("\n");
}

function renderMetricsMarkdown({ metrics, summary }) {
  return [
    "# Dilution Enrichment Metrics",
    "",
    `**Generated:** ${metrics.generated_at}`,
    "",
    "| Metric | Count |",
    "|--------|------:|",
    `| Candidates before filtering | ${metrics.candidates_before_filtering} |`,
    `| Candidates after filtering | ${metrics.candidates_after_filtering} |`,
    `| Removed by exclusion rules | ${metrics.removed_by_exclusion_rules} |`,
    `| High confidence | ${metrics.high_confidence || 0} |`,
    `| Medium confidence | ${metrics.medium_confidence || 0} |`,
    `| Low confidence | ${metrics.low_confidence || 0} |`,
    `| RTU exclusions | ${metrics.rtu_exclusions} |`,
    `| Accessory exclusions | ${metrics.accessory_exclusions} |`,
    `| Not chemical exclusions | ${metrics.not_chemical_exclusions} |`,
    `| Dilution not meaningful exclusions | ${metrics.dilution_not_meaningful_exclusions} |`,
    "",
    "## Confidence distribution (after filtering)",
    "",
    "| Confidence | Count | Share |",
    "|------------|------:|------:|",
    ...Object.entries(summary.by_confidence).map(([k, v]) => {
      const share = summary.total_targets ? ((v / summary.total_targets) * 100).toFixed(1) : "0.0";
      return `| ${k} | ${v} | ${share}% |`;
    }),
    "",
    "## Success criteria checks",
    "",
    "Post-filter recommendations exclude wash mitts, buckets, clay bars, brushes, applicators, and microfiber accessories."
  ].join("\n");
}

function renderValidationV2({ summary, rows }) {
  const byId = new Map(products.map(p => [String(p.id), p]));
  const high = rows.filter(r => r.confidence === "high").slice(0, 20);
  const medium = rows.filter(r => r.confidence === "medium").slice(0, 20);

  const lines = [
    "# Dilution Validation Report v2",
    "",
    `**Generated:** ${summary.generated_at}`,
    "**Source:** improved generator with accessory/chemical/RTU gates",
    "",
    "## Overview",
    "",
    "| Metric | Value |",
    "|--------|------:|",
    `| Candidates before filtering | ${summary.candidates_before_filtering} |`,
    `| Candidates after filtering | ${summary.candidates_after_filtering} |`,
    `| Removed by exclusion rules | ${summary.removed_by_exclusion_rules} |`,
    `| High confidence (available) | ${summary.by_confidence.high || 0} |`,
    `| Medium confidence (available) | ${summary.by_confidence.medium || 0} |`,
    `| Low confidence (available) | ${summary.by_confidence.low || 0} |`,
    "",
    "### Confidence distribution",
    "",
    "| Confidence | Count |",
    "|------------|------:|",
    ...Object.entries(summary.by_confidence).map(([k, v]) => `| ${k} | ${v} |`),
    ""
  ];

  function section(title, items, note) {
    lines.push(`## ${title}`, "");
    if (note) {
      lines.push(`> ${note}`, "");
    }
    lines.push(`**Shown:** ${items.length}`, "");
    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      const product = byId.get(String(row.id));
      lines.push(`### ${i + 1}. \`${row.id}\` — ${row.name}`, "");
      lines.push("| Field | Value |", "|-------|-------|");
      lines.push(`| Brand | ${mdEscape(row.brand)} |`);
      lines.push(`| Category / inference | ${row.category} / ${row.inference} |`);
      lines.push(`| Confidence | **${row.confidence}** |`);
      lines.push("");
      lines.push("#### Existing description", "", fullDescription(product), "");
      lines.push("#### Proposed dilution", "", JSON.stringify(row.recommended_dilution, null, 2), "");
      lines.push("#### Exemplar source", "");
      if (row.description_extract?.length) {
        for (const d of row.description_extract) {
          lines.push(`- **${d.field}:** \`${d.ratio}\` — _"${truncate(d.excerpt, 100)}"_`);
        }
      }
      for (const e of row.exemplars || []) {
        lines.push(`- **Exemplar \`${e.id}\` (${e.matchType || "unknown"}):** ${truncate(e.name, 70)}`);
      }
      lines.push("");
      for (const r of row.rationale || []) {
        lines.push(`- ${r}`);
      }
      lines.push("", "---", "");
    }
  }

  section(
    "High confidence (top 20)",
    high,
    (summary.by_confidence.high || 0) < 20 ? `Only ${summary.by_confidence.high || 0} high-confidence SKU(s) available.` : null
  );
  section("Medium confidence (top 20)", medium, null);
  return lines.join("\n");
}

function verifySuccessCriteria(rows, falsePositives) {
  const forbidden =
    /\b(manusa|mănușă|mitt|galeta|găleată|bucket|argila decontaminare|argila agresiv|argila blanda|clay bar|clay mitt|perie|brush|laveta|prosop|microfib|grit guard|burete aplicator|magic sponge|clay sponge)\b/i;
  const badRecs = rows.filter(r => r.recommended_dilution && forbidden.test(r.name));
  const badFpStillRecommended = falsePositives.filter(
    fp => fp.would_have_been_recommended && forbidden.test(fp.name)
  );
  if (badRecs.length) {
    throw new Error(`Forbidden accessory recommendations remain: ${badRecs.map(r => r.id).join(", ")}`);
  }
  console.log("SUCCESS CHECK: no forbidden accessory recommendations in final rows");
  console.log(`Excluded accessories that naive pass would recommend: ${badFpStillRecommended.length}`);
}

function main() {
  const review = buildReview();
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(review, null, 2));
  fs.writeFileSync(OUT_MD, renderReviewMarkdown(review));
  fs.writeFileSync(OUT_FALSE_POS, renderFalsePositiveMarkdown(review));
  fs.writeFileSync(OUT_METRICS, renderMetricsMarkdown(review));
  fs.writeFileSync(OUT_VALIDATION_V2, renderValidationV2(review));
  verifySuccessCriteria(review.rows, review.falsePositives);
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_FALSE_POS}`);
  console.log(`Wrote ${OUT_METRICS}`);
  console.log(`Wrote ${OUT_VALIDATION_V2}`);
  console.log(JSON.stringify(review.metrics, null, 2));
}

main();
