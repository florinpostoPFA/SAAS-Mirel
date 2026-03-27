/**
 * Centralized configuration
 * All hardcoded values and behavior settings in one place
 */

const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
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
    systemRole: "Ești un consultant profesionist de detailing auto.",
    tone: {
      friendly:
        "Fii consultativ, nu agresiv. Vorbește natural, ca un expert.",
      formal: "Fii profesionist și formal. Prezintă informații precise."
    },
    delayRecommendationTemplate: `
IMPORTANT:
NU recomanda produse imediat.

Flux corect:
1. Înțelege nevoia clientului
2. Pune 1-2 întrebări relevante dacă informația nu este suficientă
3. Abia apoi recomandă produse
`,
    immediateRecommendationTemplate: `
IMPORTANT:
Poți recomanda produse direct dacă cererea este clară.
`,
    rules: [
      "Fii consultativ, nu agresiv",
      "Vorbește natural, ca un expert",
      "Folosește DOAR produsele din listă"
    ],
    // Prompt section labels
    sections: {
      systemRole: "System Role",
      strategy: "Strategy",
      rules: "Rules",
      clientRequest: "Client Request",
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
    delay_recommendation: true
  }
};

module.exports = config;
