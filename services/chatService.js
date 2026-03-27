// Chat logic - orchestrate search, prompt building, and LLM
const config = require("../config");
const { searchProducts } = require("./search");
const { buildPrompt } = require("./promptBuilder");
const { getSettings } = require("./settingsService");
const { askLLM } = require("./llm");

async function handleChat(message, clientId, products) {
  const settings = getSettings(clientId);

  let found = searchProducts(message, products);

  // Fallback to default products if no match found
  if (found.length === 0) {
    found = products.slice(0, config.search.fallbackProducts);
  }

  const prompt = buildPrompt({
    message,
    products: found,
    settings
  });

  const reply = await askLLM(prompt);

  return { reply, products: found };
}

module.exports = { handleChat };
