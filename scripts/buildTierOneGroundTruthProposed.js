#!/usr/bin/env node
/**
 * Builds Tests/tierOneGroundTruth.proposed.json from catalog + knowledge links.
 * Run: node scripts/buildTierOneGroundTruthProposed.js
 *
 * Heuristic guardrails (re-run safety — do not widen without founder review):
 *
 * 1. applyRubberProductNameBias — ONLY when the product name matches Gummifix / Gummi /
 *    standalone cauciuc|rubber (not "plastic … cauciuc" in the name) AND the catalog
 *    description does NOT mention plastic, plastic+cauciuc, covorașe/covorase, or pardoseli,
 *    AND the description does NOT enumerate multiple surface types (e.g. plastic + rubber).
 *    Otherwise keep base expected_tags (combined surfaces win). Example: 48001 Gummifix keeps
 *    trim_dressing + ["plastic_interior","rubber"] because the name and description are multi-surface.
 *
 * 2. applyIronIndicatorRetag — wheel-context only; uses word-boundary "indicator" so Romanian
 *    "proprietăți" does not false-trigger. Felgenblitz-style iron chemistry on wheel SKUs.
 *
 * 3. applyConcentrationHeuristic — concentrate only when text mentions dilution/concentrate,
 *    not from bottle size alone.
 */
const fs = require("fs");
const path = require("path");

const PRODUCTS_PATH = path.join(__dirname, "../data/products.json");
const KNOWLEDGE_PATH = path.join(__dirname, "../data/knowledge.json");
const OUTPUT_PATH = path.join(__dirname, "../Tests/tierOneGroundTruth.proposed.json");

const BRAND_BY_MFR = {
  "13": "Koch Chemie",
  "39": "Gtechniq",
  "44": "ZviZZer",
  "70": "Ewocar",
  "92": "ADBL"
};

const CONCENTRATE_RE =
  /concentrat|concentrate|dilut|diluabil|diluable|se dilue|diluare|diluție|dilutie|diluare|1\s*:\s*\d/i;

function loadProducts() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf-8"));
  return new Map(products.map((p) => [String(p.id), p]));
}

function loadKnowledge() {
  const rows = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, "utf-8"));
  return new Map(rows.map((k) => [k.id, k]));
}

function catalogText(product) {
  return [product?.name, product?.short_description, product?.description]
    .filter(Boolean)
    .join(" ");
}

/** meta_keyword + short_description + first ~500 chars of description (founder rule 2026-05-22). */
function catalogIronIndicatorScanText(product) {
  const desc = String(product?.description || "").slice(0, 500);
  return [
    product?.meta_keyword,
    product?.short_description,
    desc
  ]
    .filter(Boolean)
    .join(" ");
}

const IRON_INDICATOR_RE =
  /\bindicator\b|indicatorului de performanta|rosu|roșu|\bfier\b|reactive|iron(?!\s*and\s*fallout)/i;

const WHEEL_PRODUCT_TYPE_RE = /^(wheel_cleaner|iron_remover|tar_remover)$/;
const WHEEL_NAME_RE = /jant|felgen|wheel|reifen|rim\b/i;

function impliesIronIndicatorChemistry(product) {
  return IRON_INDICATOR_RE.test(catalogIronIndicatorScanText(product));
}

/**
 * Felgenblitz-style iron-indicator wheel products: decontamination + iron_remover
 * even when also marketed as wheel cleaners.
 */
function isWheelProductContext(expectedTags, product) {
  if (expectedTags.surface?.includes("wheels")) {
    return true;
  }
  if (WHEEL_PRODUCT_TYPE_RE.test(expectedTags.product_type || "")) {
    return true;
  }
  return WHEEL_NAME_RE.test(String(product?.name || ""));
}

function applyIronIndicatorRetag(expectedTags, product) {
  const tags = { ...expectedTags };
  if (!impliesIronIndicatorChemistry(product) || !isWheelProductContext(expectedTags, product)) {
    return tags;
  }
  tags.purpose = "decontamination";
  tags.product_type = "iron_remover";
  if (!tags.surface?.includes("wheels")) {
    tags.surface = ["wheels", ...(tags.surface || [])].filter(
      (s, i, arr) => arr.indexOf(s) === i
    );
  }
  return tags;
}

function knowledgeText(knowledgeId, knowledgeById) {
  const row = knowledgeById.get(knowledgeId);
  if (!row) return "";
  return [row.title, row.content, row.searchText].filter(Boolean).join(" ");
}

function impliesConcentrate(product, knowledgeId, knowledgeById) {
  const text = `${catalogText(product)} ${knowledgeText(knowledgeId, knowledgeById)}`;
  return CONCENTRATE_RE.test(text);
}

function parseVolumeMl(name) {
  const n = String(name || "").toLowerCase();
  const ml = n.match(/(\d+(?:[.,]\d+)?)\s*ml\b/);
  if (ml) return parseFloat(ml[1].replace(",", "."));
  const l = n.match(/(\d+(?:[.,]\d+)?)\s*l\b/);
  if (l) return parseFloat(l[1].replace(",", ".")) * 1000;
  const kg = n.match(/(\d+(?:[.,]\d+)?)\s*kg\b/);
  if (kg) return parseFloat(kg[1].replace(",", ".")) * 1000;
  return Number.POSITIVE_INFINITY;
}

function applyConcentrationHeuristic(expectedTags, product, knowledgeId, knowledgeById) {
  const tags = { ...expectedTags };
  if (impliesConcentrate(product, knowledgeId, knowledgeById)) {
    tags.concentration = "concentrate";
  } else {
    delete tags.concentration;
    tags.concentration = "ready_to_use";
  }
  return tags;
}

const RUBBER_BIAS_PLASTIC_OR_INTERIOR_ZONES_RE =
  /plastic|plastic\s+si\s+cauciuc|plastic\s+și\s+cauciuc|covorase|covora[sșş]e|pardoseli/i;

/** Catalog text lists more than one surface family (plastic + rubber, etc.). */
function descriptionEnumeratesMultipleSurfaces(descText) {
  const d = String(descText || "").toLowerCase();
  if (
    /plastic.{0,80}(?:cauciuc|rubber|gummi)|(?:cauciuc|rubber|gummi).{0,80}plastic/i.test(
      d
    )
  ) {
    return true;
  }
  if (
    /(?:cauciuc|rubber).{0,40}(?:si|și|sau|,).{0,40}plastic|plastic.{0,40}(?:si|și|sau|,).{0,40}(?:cauciuc|rubber)/i.test(
      d
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Narrow rubber-only retag: see file-header rule (1). Combined tags from specs win when
 * plastic/covorase/pardoseli or multi-surface copy is present (e.g. 48001 Gummifix).
 */
function applyRubberProductNameBias(expectedTags, product) {
  const name = String(product?.name || "");
  const isGummiLine = /\bgummifix\b|\bgummi\b/i.test(name);
  const isRubberOnlyName =
    /\b(cauciuc|rubber)\b/i.test(name) && !/\bplastic\b/i.test(name);
  if (!isGummiLine && !isRubberOnlyName) {
    return expectedTags;
  }

  const desc = [
    product?.meta_keyword,
    product?.short_description,
    product?.description
  ]
    .filter(Boolean)
    .join(" ");

  if (RUBBER_BIAS_PLASTIC_OR_INTERIOR_ZONES_RE.test(desc)) {
    return expectedTags;
  }
  if (descriptionEnumeratesMultipleSurfaces(desc)) {
    return expectedTags;
  }

  const tags = { ...expectedTags };
  const scan = desc.toLowerCase();

  tags.surface = ["rubber"];
  tags.product_type = "rubber_protectant";
  tags.purpose = "protection";

  if (/garnituri|weatherstrip|usi\b|door seal|exterior|parbriz/.test(scan)) {
    tags.location = "exterior";
  } else if (/interior|covorase|bord|cockpit|pardoseli/.test(scan)) {
    tags.location = "interior";
  }

  return tags;
}

/** Acidic concentrates marketed as extreme/aggressive → uncoated_only (founder rule 2026-05-22). */
function applyAggressiveAcidicCoatingSafety(expectedTags, product) {
  const tags = { ...expectedTags };
  if (tags.ph !== "acidic" || tags.coating_safety) {
    return tags;
  }
  const text = catalogText(product).toLowerCase();
  const isConcentrate =
    tags.concentration === "concentrate" || /concentrat/.test(text);
  const isAggressive = /extrem|puternic|agresiv/.test(text);
  if (isConcentrate && /acid/.test(text) && isAggressive) {
    tags.coating_safety = "uncoated_only";
  }
  return tags;
}

function buildEntry(byId, knowledgeById, spec) {
  const p = byId.get(spec.id);
  if (!p) {
    throw new Error(`Missing catalog product id=${spec.id}`);
  }
  const manufacturer =
    p.brand || BRAND_BY_MFR[String(p.manufacturerId)] || spec.manufacturerFallback || "Unknown";

  let expected_tags = applyConcentrationHeuristic(
    spec.expected_tags,
    p,
    spec.knowledgeId,
    knowledgeById
  );
  expected_tags = applyAggressiveAcidicCoatingSafety(expected_tags, p);
  expected_tags = applyIronIndicatorRetag(expected_tags, p);
  expected_tags = applyRubberProductNameBias(expected_tags, p);

  return {
    _source_knowledge_id: spec.knowledgeId,
    magento_id: String(p.id),
    sku: String(p.sku || p.id),
    manufacturer,
    manufacturerId: String(p.manufacturerId),
    name: p.name,
    rationale: spec.rationale,
    expected_tags,
    _dedupGroup: spec.dedupGroup || null,
    _volumeMl: parseVolumeMl(p.name)
  };
}

function dedupeGroupedEntries(entries) {
  const groups = new Map();
  const singles = [];

  for (const entry of entries) {
    if (!entry._dedupGroup) {
      singles.push(stripInternal(entry));
      continue;
    }
    if (!groups.has(entry._dedupGroup)) {
      groups.set(entry._dedupGroup, []);
    }
    groups.get(entry._dedupGroup).push(entry);
  }

  const merged = [...singles];
  for (const groupEntries of groups.values()) {
    const sorted = [...groupEntries].sort((a, b) => a._volumeMl - b._volumeMl);
    const winner = { ...sorted[0] };
    const candidates = sorted.slice(1).map((e) => e.magento_id);
    if (candidates.length > 0) {
      winner._match_candidates = candidates;
    }
    merged.push(stripInternal(winner));
  }

  return merged;
}

function stripInternal(entry) {
  const { _dedupGroup, _volumeMl, ...rest } = entry;
  if (rest._match_candidates) {
    return rest;
  }
  return rest;
}

function buildCategory(specs, byId, knowledgeById) {
  const built = specs.map((spec) => buildEntry(byId, knowledgeById, spec));
  return dedupeGroupedEntries(built);
}

function main() {
  const byId = loadProducts();
  const knowledgeById = loadKnowledge();

  const tireSpecs = [
    {
      id: "ADB000141",
      knowledgeId: "meguiars_endurance_tire_gel",
      rationale:
        "ADBL Black Water 1L — high-gloss tire dressing, ready to use. Tier-1 SKU for gloss finish pattern.",
      expected_tags: {
        location: "exterior",
        surface: ["tires"],
        purpose: "protection",
        product_type: "tire_dressing",
        finish: "gloss"
      }
    },
    {
      id: "T1 0.25",
      knowledgeId: "meguiars_endurance_tire_gel",
      rationale:
        "Gtechniq T1 Durable Tyre Gel 250ml — durable gloss tyre dressing RTU.",
      expected_tags: {
        location: "exterior",
        surface: ["tires"],
        purpose: "protection",
        product_type: "tire_dressing",
        finish: "gloss"
      }
    },
    {
      id: "T2 0.25",
      knowledgeId: "meguiars_endurance_tire_gel",
      rationale:
        "Gtechniq T2 Tyre Dressing — subtle OEM-style tire finish (mapped to finish:natural).",
      expected_tags: {
        location: "exterior",
        surface: ["tires"],
        purpose: "protection",
        product_type: "tire_dressing",
        finish: "natural"
      }
    },
    {
      id: "196612",
      knowledgeId: "meguiars_endurance_tire_gel",
      rationale:
        "Koch Chemie Reifenschaum 600ml — foam tire dressing (spuma), maintains and protects with intense shine.",
      expected_tags: {
        location: "exterior",
        surface: ["tires"],
        purpose: "protection",
        product_type: "tire_dressing",
        finish: "wet_look"
      }
    },
    {
      id: "ADB000026",
      dedupGroup: "adbl-tire-rubber-cleaner",
      knowledgeId: "tire_rubber_cleaner_utilizare",
      rationale:
        "ADBL Tire and Rubber Cleaner 500ml — degreasing prep before dressing (500ml canonical; 5L is same formula).",
      expected_tags: {
        location: "exterior",
        surface: ["tires", "rubber"],
        purpose: "cleaning",
        product_type: "tire_cleaner"
      }
    },
    {
      id: "ADB000028",
      dedupGroup: "adbl-tire-rubber-cleaner",
      knowledgeId: "tire_rubber_cleaner_utilizare",
      rationale: "ADBL Tire and Rubber Cleaner 5L — larger size of same RTU cleaner (deduped into 500ml).",
      expected_tags: {
        location: "exterior",
        surface: ["tires", "rubber"],
        purpose: "cleaning",
        product_type: "tire_cleaner"
      }
    }
  ];

  const wheelSpecs = [
    {
      id: "187011",
      knowledgeId: "solutie_jante_acida",
      rationale:
        "Koch Felgenreiniger Extrem 11kg — acidic wheel cleaner concentrate for heavy brake dust.",
      expected_tags: {
        location: "exterior",
        surface: ["wheels"],
        purpose: "cleaning",
        product_type: "wheel_cleaner",
        ph: "acidic"
      }
    },
    {
      id: "218005",
      dedupGroup: "koch-felgenblitz-saurefrei",
      knowledgeId: "curatare_jante_indicator_rosu",
      rationale:
        "Koch Felgenblitz Saurefrei 5L — pH-neutral iron-indicator wheel decon (red performance indicator in catalog).",
      expected_tags: {
        location: "exterior",
        surface: ["wheels"],
        purpose: "cleaning",
        product_type: "wheel_cleaner",
        ph: "ph_neutral",
        coating_safety: "coating_safe"
      }
    },
    {
      id: "218011",
      dedupGroup: "koch-felgenblitz-saurefrei",
      knowledgeId: "curatare_jante_indicator_rosu",
      rationale:
        "Koch Felgenblitz Saurefrei 11L — bulk size; iron-indicator chemistry (deduped into 5L).",
      expected_tags: {
        location: "exterior",
        surface: ["wheels"],
        purpose: "cleaning",
        product_type: "wheel_cleaner",
        ph: "ph_neutral",
        coating_safety: "coating_safe"
      }
    },
    {
      id: "W6 0.5",
      knowledgeId: "curatare_jante_indicator_rosu",
      rationale:
        "Gtechniq W6 Iron and Fallout Remover — iron decontamination on wheels and paint fallout.",
      expected_tags: {
        location: "exterior",
        surface: ["wheels", "paint"],
        purpose: "decontamination",
        product_type: "iron_remover",
        coating_safety: "coating_safe"
      }
    },
    {
      id: "ADB000532",
      knowledgeId: "solutie_jante_acida",
      rationale:
        "ADBL Wheel Warrior Gel 500ml — acidic gel wheel cleaner, RTU application.",
      expected_tags: {
        location: "exterior",
        surface: ["wheels"],
        purpose: "cleaning",
        product_type: "wheel_cleaner",
        ph: "acidic",
        coating_safety: "uncoated_only"
      }
    },
    {
      id: "77704750",
      knowledgeId: "curatare_jante_indicator_rosu",
      rationale:
        "Koch Reactive Wheel Cleaner 750ml — reactive wheel decontamination before protection.",
      expected_tags: {
        location: "exterior",
        surface: ["wheels"],
        purpose: "decontamination",
        product_type: "iron_remover",
        ph: "ph_neutral",
        coating_safety: "coating_safe"
      }
    }
  ];

  const interiorPlasticSpecs = [
    {
      id: "20001",
      knowledgeId: "dressing_plastic_interior",
      rationale:
        "Koch Cockpit Super Pflege 1L — glossy interior plastic dressing (Csp).",
      expected_tags: {
        location: "interior",
        surface: ["plastic_interior"],
        purpose: "protection",
        product_type: "trim_dressing",
        finish: "gloss"
      }
    },
        {
          id: "48001",
          knowledgeId: "dressing_plastic_interior",
          rationale:
            "Koch GUF Gummifix 1L — matte trim dressing for interior plastic and rubber (catalog: covorase, pardoseli).",
          expected_tags: {
            location: "interior",
            surface: ["plastic_interior", "rubber"],
            purpose: "protection",
            product_type: "trim_dressing",
            finish: "matte"
          }
        },
    {
      id: "132001",
      knowledgeId: "dressing_plastic_interior",
      rationale:
        "Koch Top Star 1L — semi-mat interior plastic dressing (satin finish).",
      expected_tags: {
        location: "interior",
        surface: ["plastic_interior"],
        purpose: "protection",
        product_type: "trim_dressing",
        finish: "satin"
      }
    },
    {
      id: "476001",
      knowledgeId: "dressing_plastic_interior",
      rationale:
        "Koch Hydro Plast Care 1L — concentrate interior plastic dressing for dilution.",
      expected_tags: {
        location: "interior",
        surface: ["plastic_interior"],
        purpose: "protection",
        product_type: "trim_dressing",
        finish: "satin"
      }
    },
    {
      id: "ADB000065",
      knowledgeId: "protectie_ceramica_plastic_interior",
      rationale:
        "ADBL Interior Wow 1L — RTU interior plastic protectant with satin finish.",
      expected_tags: {
        location: "interior",
        surface: ["plastic_interior"],
        purpose: "protection",
        product_type: "trim_dressing",
        finish: "satin"
      }
    }
  ];

  const leatherSpecs = [
    {
      id: "ADB000466",
      dedupGroup: "adbl-leather-cleaner",
      knowledgeId: "apc_on_leather",
      rationale:
        "ADBL Leather Cleaner 500ml — dedicated leather cleaning before conditioning (dilutable 1:1).",
      expected_tags: {
        location: "interior",
        surface: ["leather_natural", "leather_synthetic"],
        purpose: "cleaning",
        product_type: "leather_cleaner"
      }
    },
    {
      id: "ADB000468",
      dedupGroup: "adbl-leather-cleaner",
      knowledgeId: "apc_on_leather",
      rationale: "ADBL Leather Cleaner 5L — bulk size of same dilutable leather cleaner.",
      expected_tags: {
        location: "interior",
        surface: ["leather_natural", "leather_synthetic"],
        purpose: "cleaning",
        product_type: "leather_cleaner"
      }
    },
    {
      id: "ADB000327",
      knowledgeId: "apc_on_leather",
      rationale:
        "ADBL Leather Conditioner 500ml — feed and protect natural/synthetic leather.",
      expected_tags: {
        location: "interior",
        surface: ["leather_natural"],
        purpose: "conditioning",
        product_type: "leather_conditioner"
      }
    },
    {
      id: "77709500",
      knowledgeId: "apc_on_leather",
      rationale:
        "Koch Protect Leather Care 500ml — leather hydration and protection.",
      expected_tags: {
        location: "interior",
        surface: ["leather_natural"],
        purpose: "conditioning",
        product_type: "leather_conditioner"
      }
    },
    {
      id: "LC1",
      dedupGroup: "ewocar-leather-clean",
      knowledgeId: "apc_on_leather",
      rationale:
        "Ewocar Leather Clean 500ml — RTU leather cleaner for maintenance washes.",
      expected_tags: {
        location: "interior",
        surface: ["leather_natural", "leather_synthetic"],
        purpose: "cleaning",
        product_type: "leather_cleaner"
      }
    },
    {
      id: "LC5",
      dedupGroup: "ewocar-leather-clean",
      knowledgeId: "apc_on_leather",
      rationale:
        "Ewocar Leather Clean Concentrate 5L — bulk concentrate (deduped into 500ml RTU).",
      expected_tags: {
        location: "interior",
        surface: ["leather_natural", "leather_synthetic"],
        purpose: "cleaning",
        product_type: "leather_cleaner"
      }
    },
    {
      id: "ADB000313",
      knowledgeId: "apc_on_leather",
      rationale:
        "ADBL Leather Conditioner 200ml — compact RTU leather feed.",
      expected_tags: {
        location: "interior",
        surface: ["leather_natural"],
        purpose: "conditioning",
        product_type: "leather_conditioner"
      }
    }
  ];

  const glassSpecs = [
    {
      id: "77703750",
      knowledgeId: "laveta_geam_utilizare",
      rationale:
        "Koch Speed Glass Cleaner 750ml — standard RTU interior/exterior glass cleaning.",
      expected_tags: {
        location: "exterior",
        surface: ["glass"],
        purpose: "cleaning",
        product_type: "glass_cleaner"
      }
    },
    {
      id: "302001",
      dedupGroup: "koch-glass-cleaner-pro",
      knowledgeId: "laveta_geam_utilizare",
      rationale:
        "Koch Glass Cleaner Pro 1L — pro glass cleaner RTU (1L canonical size).",
      expected_tags: {
        location: "exterior",
        surface: ["glass"],
        purpose: "cleaning",
        product_type: "glass_cleaner"
      }
    },
    {
      id: "302010",
      dedupGroup: "koch-glass-cleaner-pro",
      knowledgeId: "laveta_geam_utilizare",
      rationale: "Koch Glass Cleaner Pro 10L — bulk RTU glass cleaner (deduped into 1L).",
      expected_tags: {
        location: "exterior",
        surface: ["glass"],
        purpose: "cleaning",
        product_type: "glass_cleaner"
      }
    },
    {
      id: "ADB000353",
      knowledgeId: "laveta_geam_utilizare",
      rationale:
        "ADBL Hybrid Glass 500ml — glass cleaner with hydrophobic maintenance effect.",
      expected_tags: {
        location: "exterior",
        surface: ["glass"],
        purpose: "cleaning",
        product_type: "glass_cleaner"
      }
    },
    {
      id: "G6 0.5",
      knowledgeId: "laveta_geam_utilizare",
      rationale:
        "Gtechniq G6 Perfect Glass 500ml — coating-safe glass cleaner RTU.",
      expected_tags: {
        location: "exterior",
        surface: ["glass"],
        purpose: "cleaning",
        product_type: "glass_cleaner",
        coating_safety: "coating_safe"
      }
    },
    {
      id: "GC1000",
      knowledgeId: "laveta_geam_utilizare",
      rationale:
        "Ewocar CleanGlass 1L — RTU glass cleaner for streak-free maintenance.",
      expected_tags: {
        location: "interior",
        surface: ["glass"],
        purpose: "cleaning",
        product_type: "glass_cleaner"
      }
    }
  ];

  const categories = {
    tires: {
      description:
        "Tier-1 tire dressings + cleaners. Diverse finish and concentration for tagger validation.",
      products: buildCategory(tireSpecs, byId, knowledgeById)
    },
    wheels: {
      description:
        "Tier-1 wheel cleaners: acidic, pH-neutral, iron fallout, concentrate, reactive decon.",
      products: buildCategory(wheelSpecs, byId, knowledgeById)
    },
    interior_plastic: {
      description:
        "Tier-1 interior plastic trim dressings: gloss, matte, satin, concentrate, RTU protection.",
      products: buildCategory(interiorPlasticSpecs, byId, knowledgeById)
    },
    leather: {
      description:
        "Tier-1 leather cleaners and conditioners across ADBL, Koch, Ewocar.",
      products: buildCategory(leatherSpecs, byId, knowledgeById)
    },
    glass: {
      description:
        "Tier-1 glass cleaners: RTU, concentrate, hydrophobic hybrid, pro formulas.",
      products: buildCategory(glassSpecs, byId, knowledgeById)
    }
  };

  for (const [name, cat] of Object.entries(categories)) {
    if (cat.products.length !== 5) {
      throw new Error(`Category ${name} has ${cat.products.length} products after dedup (expected 5)`);
    }
  }

  const doc = {
    version: "1.0-proposed-2026-05-22",
    vocabulary_version: "1.1",
    status: "proposed",
    description:
      "Proposed tier-1 ground truth for founder/CTO review. Rename to Tests/tierOneGroundTruth.json after batch approval. Used by Step 1.4 tagger validation harness.",
    categories
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(doc, null, 2) + "\n");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
