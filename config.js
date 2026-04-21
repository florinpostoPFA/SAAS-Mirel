/**
 * Centralized configuration
 * All hardcoded values and behavior settings in one place
 */

const config = {
  // Server configuration
  server: {
    port: process.env.BACKEND_PORT || 3001,
    defaultClientId: "client1"
  },

  // Search configuration
  search: {
    resultLimit: 3,
    fallbackProducts: 2,
    tagSynonyms: {
      luciu: ["wax", "ceara", "shine"],
      zgarieturi: ["polish"],
      interior: ["cleaner"]
    },
    // Scoring weights for search algorithm
    scoring: {
      nameMatchWeight: 3,
      descriptionMatchWeight: 2
    }
  },

  // Prompt building configuration
  prompt: {
    systemRole: "Ești un consultant profesionist de detailing auto cu 10+ ani de experiență.",
    tone: {
      friendly:
        "Fii natural și prietenos, ca un expert care dorește să ajute. Vorbește cum vorbești cu un prieten, nu ca un roboț.",
      formal: "Fii profesionist și precis. Sunt detalii tehnice, prezintă-le clar și concis."
    },
    delayRecommendationTemplate: `
Cererea clientului este vagă sau poate avea mai mulți parametri.
Pune 1-2 întrebări inteligente pentru a clarifica.
Abia după ce ai informații suficiente, recomandă produse cu o explicație clară.
`,
    immediateRecommendationTemplate: `
Cererea este clară. Client știe exact ce caută.
Recomandă produsele direct cu o explicație a DE CE se potrivesc.
`,
    rules: [
      "Nu suna robotic - sună ca un expert real care cunoaște produsele",
      "Explică DE CE sunt aceste produse potrivite pentru nevoile lor",
      "Fii scurt și la punct - respectă timp clientului",
      "Folosește DOAR produsele din lista furnizată",
      "Dacă nu ești sigur de ceva, nu inventa - cere clarificare"
    ],
    // Prompt section labels
    sections: {
      systemRole: "System Role",
      strategy: "Strategy",
      rules: "Rules",
      clientRequest: "Client Request",
      recommendationJustification: "Why These Products",
      availableProducts: "Available Products"
    }
  },

  // Default client settings
  defaultSettings: {
    tone: "friendly",
    max_products: 2,
    cta: "Vezi produsul",
    strategy: "upsell",
    provider: "openai",
    delay_recommendation: true,
    conversation_rules: {
      greeting: {
        enabled: true,
        response: "Salut! Cu ce te pot ajuta?",
        show_products: false
      }
    },
    // Tag rules for intent detection
    // Format: [{phrases: ["user says this"], tags: ["product_tag"]}, ...]
    tag_rules: [
      {
        phrases: ["luciu", "shine", "wax", "ceara", "lustru"],
        tags: ["polish", "wax"]
      },
      {
        phrases: ["zgarieturi", "zgârieturi", "scratch", "polish"],
        tags: ["polish"]
      },
      {
        phrases: ["interior", "interior cleaner", "curatare interior"],
        tags: ["interior_cleaner"]
      }
    ]
  },

  // Magento API configuration
  magento: {
    baseUrl: "",
    token: "",
    timeout: 5000
  },

  // Predefined deterministic flows
  flows: {
    exterior_wash_beginner: require("./flows/exteriorWash.json"),
    interior_clean_basic: require("./flows/interior_clean_basic.json"),
    bug_removal_quick: require("./flows/bug_removal_quick.json"),
    wheel_tire_deep_clean: require("./flows/wheel_tire_deep_clean.json")
  }
};

module.exports = config;
