#!/usr/bin/env node
/**
 * Builds Tests/tierOneGroundTruth.proposed.json from catalog + knowledge links.
 * Run: node scripts/buildTierOneGroundTruthProposed.js
 */
const fs = require("fs");
const path = require("path");

const PRODUCTS_PATH = path.join(__dirname, "../data/products.json");
const OUTPUT_PATH = path.join(__dirname, "../Tests/tierOneGroundTruth.proposed.json");

function loadProducts() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf-8"));
  const byId = new Map(products.map((p) => [String(p.id), p]));
  return byId;
}

function entry(byId, spec) {
  const p = byId.get(spec.id);
  if (!p) {
    throw new Error(`Missing catalog product id=${spec.id}`);
  }
  const BRAND_BY_MFR = {
    "13": "Koch Chemie",
    "39": "Gtechniq",
    "44": "ZviZZer",
    "70": "Ewocar",
    "92": "ADBL"
  };
  const manufacturer =
    p.brand || BRAND_BY_MFR[String(p.manufacturerId)] || spec.manufacturerFallback || "Unknown";
  return {
    _source_knowledge_id: spec.knowledgeId,
    magento_id: String(p.id),
    sku: String(p.sku || p.id),
    manufacturer,
    manufacturerId: String(p.manufacturerId),
    name: p.name,
    rationale: spec.rationale,
    expected_tags: spec.expected_tags
  };
}

function main() {
  const byId = loadProducts();

  const categories = {
    tires: {
      description:
        "Tier-1 tire dressings + cleaners. Diverse finish and concentration for tagger validation.",
      products: [
        entry(byId, {
          id: "ADB000141",
          knowledgeId: "meguiars_endurance_tire_gel",
          rationale:
            "ADBL Black Water 1L — high-gloss tire dressing, ready to use. Tier-1 SKU for gloss finish pattern.",
          expected_tags: {
            location: "exterior",
            surface: ["tires"],
            purpose: "protection",
            product_type: "tire_dressing",
            finish: "gloss",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "T2 0.25",
          knowledgeId: "meguiars_endurance_tire_gel",
          rationale:
            "Gtechniq T2 Tyre Dressing — subtle OEM-style tire finish (mapped to finish:natural).",
          expected_tags: {
            location: "exterior",
            surface: ["tires"],
            purpose: "protection",
            product_type: "tire_dressing",
            finish: "natural",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "196612",
          knowledgeId: "meguiars_endurance_tire_gel",
          rationale:
            "Koch Chemie Reifenschaum — foam tire dressing with wet-look shine.",
          expected_tags: {
            location: "exterior",
            surface: ["tires"],
            purpose: "protection",
            product_type: "tire_dressing",
            finish: "wet_look",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "ADB000026",
          knowledgeId: "tire_rubber_cleaner_utilizare",
          rationale:
            "ADBL Tire and Rubber Cleaner 500ml — degreasing prep before dressing.",
          expected_tags: {
            location: "exterior",
            surface: ["tires", "rubber"],
            purpose: "cleaning",
            product_type: "tire_cleaner",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "ADB000028",
          knowledgeId: "tire_rubber_cleaner_utilizare",
          rationale:
            "ADBL Tire and Rubber Cleaner 5L — concentrate dilution for tire cleaning.",
          expected_tags: {
            location: "exterior",
            surface: ["tires", "rubber"],
            purpose: "cleaning",
            product_type: "tire_cleaner",
            concentration: "concentrate"
          }
        })
      ]
    },
    wheels: {
      description:
        "Tier-1 wheel cleaners: acidic, pH-neutral, iron fallout, concentrate, reactive decon.",
      products: [
        entry(byId, {
          id: "187011",
          knowledgeId: "solutie_jante_acida",
          rationale:
            "Koch Felgenreiniger Extrem 11L — acidic wheel cleaner concentrate for heavy brake dust.",
          expected_tags: {
            location: "exterior",
            surface: ["wheels"],
            purpose: "cleaning",
            product_type: "wheel_cleaner",
            ph: "acidic",
            concentration: "concentrate",
            coating_safety: "coating_caution"
          }
        }),
        entry(byId, {
          id: "218011",
          knowledgeId: "curatare_jante_indicator_rosu",
          rationale:
            "Koch Felgenblitz Saurefrei 11L — acid-free (pH-neutral) wheel cleaner, coating-safe maintenance.",
          expected_tags: {
            location: "exterior",
            surface: ["wheels"],
            purpose: "cleaning",
            product_type: "wheel_cleaner",
            ph: "ph_neutral",
            concentration: "concentrate",
            coating_safety: "coating_safe"
          }
        }),
        entry(byId, {
          id: "W6 0.5",
          knowledgeId: "curatare_jante_indicator_rosu",
          rationale:
            "Gtechniq W6 Iron and Fallout Remover — iron decontamination on wheels and paint fallout.",
          expected_tags: {
            location: "exterior",
            surface: ["wheels", "paint"],
            purpose: "decontamination",
            product_type: "iron_remover",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
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
            concentration: "ready_to_use",
            coating_safety: "uncoated_only"
          }
        }),
        entry(byId, {
          id: "77704750",
          knowledgeId: "curatare_jante_indicator_rosu",
          rationale:
            "Koch Reactive Wheel Cleaner 750ml — reactive wheel decontamination before protection.",
          expected_tags: {
            location: "exterior",
            surface: ["wheels"],
            purpose: "decontamination",
            product_type: "wheel_cleaner",
            ph: "ph_neutral",
            concentration: "ready_to_use"
          }
        })
      ]
    },
    interior_plastic: {
      description:
        "Tier-1 interior plastic trim dressings: gloss, matte, satin, concentrate, RTU protection.",
      products: [
        entry(byId, {
          id: "20001",
          knowledgeId: "dressing_plastic_interior",
          rationale:
            "Koch Cockpit Super Pflege 1L — glossy interior plastic dressing (Csp).",
          expected_tags: {
            location: "interior",
            surface: ["plastic_interior"],
            purpose: "protection",
            product_type: "trim_dressing",
            finish: "gloss",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "48001",
          knowledgeId: "dressing_plastic_interior",
          rationale:
            "Koch GUF Gummifix 1L — matte OEM look for interior plastic and rubber trim.",
          expected_tags: {
            location: "interior",
            surface: ["plastic_interior", "rubber"],
            purpose: "protection",
            product_type: "trim_dressing",
            finish: "matte",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "132001",
          knowledgeId: "dressing_plastic_interior",
          rationale:
            "Koch Top Star 1L — semi-mat interior plastic dressing (satin finish).",
          expected_tags: {
            location: "interior",
            surface: ["plastic_interior"],
            purpose: "protection",
            product_type: "trim_dressing",
            finish: "satin",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "476001",
          knowledgeId: "dressing_plastic_interior",
          rationale:
            "Koch Hydro Plast Care 1L — concentrate interior plastic dressing for dilution.",
          expected_tags: {
            location: "interior",
            surface: ["plastic_interior"],
            purpose: "protection",
            product_type: "trim_dressing",
            finish: "satin",
            concentration: "concentrate"
          }
        }),
        entry(byId, {
          id: "ADB000065",
          knowledgeId: "protectie_ceramica_plastic_interior",
          rationale:
            "ADBL Interior Wow 1L — RTU interior plastic protectant with satin finish.",
          expected_tags: {
            location: "interior",
            surface: ["plastic_interior"],
            purpose: "protection",
            product_type: "trim_dressing",
            finish: "satin",
            concentration: "ready_to_use"
          }
        })
      ]
    },
    leather: {
      description:
        "Tier-1 leather cleaners and conditioners across ADBL, Koch, Ewocar.",
      products: [
        entry(byId, {
          id: "ADB000466",
          knowledgeId: "apc_on_leather",
          rationale:
            "ADBL Leather Cleaner 500ml — dedicated leather cleaning before conditioning.",
          expected_tags: {
            location: "interior",
            surface: ["leather_natural", "leather_synthetic"],
            purpose: "cleaning",
            product_type: "leather_cleaner",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "ADB000468",
          knowledgeId: "apc_on_leather",
          rationale:
            "ADBL Leather Cleaner 5L — concentrate leather cleaner for pro dilution.",
          expected_tags: {
            location: "interior",
            surface: ["leather_natural", "leather_synthetic"],
            purpose: "cleaning",
            product_type: "leather_cleaner",
            concentration: "concentrate"
          }
        }),
        entry(byId, {
          id: "ADB000327",
          knowledgeId: "apc_on_leather",
          rationale:
            "ADBL Leather Conditioner 500ml — feed and protect natural/synthetic leather.",
          expected_tags: {
            location: "interior",
            surface: ["leather_natural"],
            purpose: "conditioning",
            product_type: "leather_conditioner",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "77709500",
          knowledgeId: "apc_on_leather",
          rationale:
            "Koch Protect Leather Care 500ml — leather hydration and protection.",
          expected_tags: {
            location: "interior",
            surface: ["leather_natural"],
            purpose: "conditioning",
            product_type: "leather_conditioner",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "LC1",
          knowledgeId: "apc_on_leather",
          rationale:
            "Ewocar Leather Clean 500ml — RTU leather cleaner for maintenance washes.",
          expected_tags: {
            location: "interior",
            surface: ["leather_natural", "leather_synthetic"],
            purpose: "cleaning",
            product_type: "leather_cleaner",
            concentration: "ready_to_use"
          }
        })
      ]
    },
    glass: {
      description:
        "Tier-1 glass cleaners: RTU, concentrate, hydrophobic hybrid, pro formulas.",
      products: [
        entry(byId, {
          id: "77703750",
          knowledgeId: "laveta_geam_utilizare",
          rationale:
            "Koch Speed Glass Cleaner 750ml — standard RTU interior/exterior glass cleaning.",
          expected_tags: {
            location: "exterior",
            surface: ["glass"],
            purpose: "cleaning",
            product_type: "glass_cleaner",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "302001",
          knowledgeId: "laveta_geam_utilizare",
          rationale:
            "Koch Glass Cleaner Pro 1L — pro glass cleaner concentrate line (Gc).",
          expected_tags: {
            location: "exterior",
            surface: ["glass"],
            purpose: "cleaning",
            product_type: "glass_cleaner",
            concentration: "concentrate"
          }
        }),
        entry(byId, {
          id: "ADB000353",
          knowledgeId: "laveta_geam_utilizare",
          rationale:
            "ADBL Hybrid Glass 500ml — glass cleaner with hydrophobic maintenance effect.",
          expected_tags: {
            location: "exterior",
            surface: ["glass"],
            purpose: "cleaning",
            product_type: "glass_cleaner",
            concentration: "ready_to_use"
          }
        }),
        entry(byId, {
          id: "G6 0.5",
          knowledgeId: "laveta_geam_utilizare",
          rationale:
            "Gtechniq G6 Perfect Glass 500ml — coating-safe glass cleaner RTU.",
          expected_tags: {
            location: "exterior",
            surface: ["glass"],
            purpose: "cleaning",
            product_type: "glass_cleaner",
            concentration: "ready_to_use",
            coating_safety: "coating_safe"
          }
        }),
        entry(byId, {
          id: "GC1000",
          knowledgeId: "laveta_geam_utilizare",
          rationale:
            "Ewocar CleanGlass 1L — RTU glass cleaner for streak-free maintenance.",
          expected_tags: {
            location: "interior",
            surface: ["glass"],
            purpose: "cleaning",
            product_type: "glass_cleaner",
            concentration: "ready_to_use"
          }
        })
      ]
    }
  };

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
