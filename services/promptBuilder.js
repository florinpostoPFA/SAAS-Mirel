const config = require("../config");

function getRoleDescription(tone) {
  if (tone === "expert") {
    return "You are a professional auto detailing consultant giving authoritative yet polite advice.";
  }
  return "You are a friendly, helpful auto detailing consultant focused on the customer.";
}

function formatProductEntry(product) {
  const parts = [`Name: ${product.name}`];
  if (product.description) parts.push(`Description: ${product.description}`);
  if (product.price !== undefined) parts.push(`Price: ${product.price}`);
  if (product.url) parts.push(`URL: ${product.url}`);
  if (product.tags && Array.isArray(product.tags)) {
    parts.push(`Tags: ${product.tags.join(", ")}`);
  }
  return parts.join(" | ");
}

/**
 * Map detected tags to human-readable benefit statements
 * Helps explain WHY a product solves the user's need
 */
function tagsToBenefits(tags) {
  const benefitMap = {
    wax: "long-lasting shine and protection for your paint",
    polish: "removes scratches and restores gloss to damaged areas",
    shine: "brilliant, reflective finish that makes your car stand out",
    cleaner: "removes dirt and grime for a fresh, clean surface",
    interior_cleaner: "restores the freshness and cleanliness of interior surfaces",
    wash: "gentle but thorough cleaning without damaging the paint"
  };

  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  return tags
    .slice(0, 3)
    .map(tag => benefitMap[tag] || null)
    .filter(b => b !== null);
}

function buildInstructions(settings, detectedTags, products) {
  const lines = [];

  // RESPONSE STRUCTURE first
  lines.push("RESPONSE STRUCTURE:");
  lines.push("1. Start by acknowledging what the user needs (based on their message).");
  lines.push("2. Recommend the product(s) that solve their need.");
  lines.push("3. For each product:");
  lines.push("   - Explain WHY it matches their need (link to their intent tags).");
  lines.push("   - Highlight the BENEFIT they gain (what value they get).");
  lines.push("4. End with a clear CTA.");
  lines.push("");

  // Core rules
  lines.push("RULES:");
  lines.push("- Use only the products from the provided PRODUCTS section. Do not invent any other products.");
  lines.push(`- Limit recommendations to at most ${settings.max_products} product(s).`);
  lines.push("- Provide natural, human-like language, not robotic.");
  lines.push(`- Always include CTA: \"${settings.cta}\"`);
  lines.push("- Be specific: explain HOW each product solves their problem.");
  lines.push("");

  // Recommendation strategy
  const clearlyIntent = Array.isArray(detectedTags) && detectedTags.length > 0;
  if (settings.delay_recommendation) {
    if (clearlyIntent) {
      lines.push("- Intent looks clear, recommend directly without extra clarifying questions.");
    } else {
      lines.push(`- If intent is unclear, ask at most 1 clarifying question (max ${settings.max_questions}) before recommending.`);
      lines.push("- Do not ask more than 1 question in one response.");
    }
  } else {
    lines.push("- Do not ask clarifying questions; recommend immediately.");
  }
  lines.push("");

  // Sales mode tone
  if (settings.sales_mode === "aggressive") {
    lines.push("- Use confident, action-oriented language and urgency.");
    lines.push("- Highlight urgency: emphasize time-sensitive benefits.");
  } else {
    lines.push("- Use a consultative and helping tone.");
    lines.push("- Build confidence: explain each choice step-by-step.");
  }
  lines.push("");

  // Response style
  if (settings.response_style === "short") {
    lines.push("- Keep concise: 2-3 sentences per product max.");
  } else if (settings.response_style === "detailed") {
    lines.push("- Provide rich context: detailed explanations of features and benefits.");
  } else if (settings.response_style === "persuasive") {
    lines.push("- Use benefit-driven language: emphasize outcomes and emotional satisfaction.");
    lines.push("- Appeal to values: quality, confidence, professionalism.");
  }
  lines.push("");

  // Product explanation guidance
  if (products.length > 0) {
    const benefits = tagsToBenefits(detectedTags);
    lines.push("PRODUCT EXPLANATION GUIDE:");
    lines.push(`- User's detected needs: ${detectedTags.join(", ") || "general inquiry"}`);
    if (benefits.length > 0) {
      lines.push(`- Expected benefits for user: ${benefits.join("; ")}`);
    }
    lines.push("- For each product, use this pattern:");
    lines.push("  'This product [action] which means you'll get [benefit].'");
    lines.push("- Make user feel confident in their choice.");
  }

  return lines.join("\n");
}

function productsSection(products) {
  if (!products || products.length === 0) {
    return "(No products provided)";
  }
  return products
    .slice(0, 10)
    .map((p, idx) => `${idx + 1}. ${formatProductEntry(p)}`)
    .join("\n");
}

function buildContextSection(message, detectedTags) {
  const tagText = Array.isArray(detectedTags) && detectedTags.length ? detectedTags.join(", ") : "none";
  return `User's request: "${message}"
Detected need tags: ${tagText}`;
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildPrompt({ message, products = [], settings = {}, detectedTags = [] }) {
  const tone = settings.tone || "friendly";
  const salesMode = settings.sales_mode || "soft";
  const responseStyle = settings.response_style || "short";

  const role = getRoleDescription(tone);
  const context = buildContextSection(message, detectedTags);
  const productInfo = productsSection(products);

  const instructions = buildInstructions(
    {
      max_products: safeNumber(settings.max_products, 2),
      delay_recommendation: settings.delay_recommendation !== false,
      sales_mode: salesMode,
      max_questions: safeNumber(settings.max_questions, 1),
      cta: settings.cta || "Vezi produsul",
      response_style: responseStyle
    },
    detectedTags,
    products
  );

  return `ROLE:
${role}

CONTEXT:
${context}

PRODUCTS:
${productInfo}

INSTRUCTIONS:
${instructions}
`;
}

module.exports = { buildPrompt };

