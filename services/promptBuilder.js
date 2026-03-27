const config = require("../config");

/**
 * Build system role section
 */
function buildSystemRoleSection() {
  return config.prompt.systemRole;
}

/**
 * Build strategy section based on delay_recommendation setting
 */
function buildStrategySection(settings) {
  if (settings.delay_recommendation) {
    return config.prompt.delayRecommendationTemplate;
  }
  return config.prompt.immediateRecommendationTemplate;
}

/**
 * Build rules section with dynamic settings
 */
function buildRulesSection(settings) {
  const staticRules = config.prompt.rules
    .map(rule => `- ${rule}`)
    .join("\n");

  const dynamicRules = [
    `- Recomandă maxim ${settings.max_products} produse`,
    `- Include CTA: "${settings.cta}"`
  ].join("\n");

  return `${staticRules}\n${dynamicRules}`;
}

/**
 * Build client request section
 */
function buildClientRequestSection(message) {
  return `"${message}"`;
}

/**
 * Build products section
 */
function buildProductsSection(products) {
  return JSON.stringify(products, null, 2);
}

/**
 * Main prompt builder
 * Orchestrates all sections into a cohesive prompt
 */
function buildPrompt({ message, products, settings }) {
  const systemRole = buildSystemRoleSection();
  const strategy = buildStrategySection(settings);
  const rules = buildRulesSection(settings);
  const clientRequest = buildClientRequestSection(message);
  const productsData = buildProductsSection(products);

  return `
${systemRole}

${strategy}

Reguli:
${rules}

Client:
${clientRequest}

Produse disponibile:
${productsData}
`;
}

module.exports = {
  buildPrompt,
  buildSystemRoleSection,
  buildStrategySection,
  buildRulesSection,
  buildClientRequestSection,
  buildProductsSection
};
