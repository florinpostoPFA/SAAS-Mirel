// Chat logic - orchestrate search, prompt building, and LLM
const config = require("../config");
const { searchProductsByTags } = require("./search");
const { buildPrompt } = require("./promptBuilder");
const { getSettings } = require("./settingsService");
const { askLLM } = require("./llm");
const { detectTags } = require("./tagService");
const { detectIntent } = require("./intentService");
const { info, debug, error } = require("./logger");

const SOURCE = "ChatService";


/**
 * Step 1: Retrieve client settings
 */
function getClientSettings(clientId) {
  debug(SOURCE, `Fetching settings for client: ${clientId}`);
  const settings = getSettings(clientId);
  debug(SOURCE, `Settings loaded`, settings);
  return settings;
}

/**
 * Step 2: Detect intent (tags) from user message
 * Uses hybrid approach: rules first, AI fallback
 */
async function detectUserIntent(message, settings, availableProductTags) {
  info(SOURCE, `Detecting intent for message: "${message}"`);

  const tags = await detectTags(
    message,
    settings.tag_rules,
    availableProductTags
  );

  if (tags.length === 0) {
    info(SOURCE, "No intent detected, no tags matched");
    return [];
  }

  info(SOURCE, `Tags detected: ${tags.join(", ")}`);
  return tags;
}

/**
 * Step 3: Search for relevant products based on detected tags
 */
function findRelevantProducts(tags, products, maxProducts) {
  if (tags.length === 0) {
    info(SOURCE, "No tags to search with, skipping search");
    return [];
  }

  info(SOURCE, `Searching for products with tags: ${tags.join(", ")}`);

  const found = searchProductsByTags(tags, products, maxProducts);

  if (found.length === 0) {
    info(SOURCE, "No products matched the detected tags");
    debug(SOURCE, `Available products: ${products.map(p => p.name).join(", ")}`);
    return [];
  }

  info(SOURCE, `Found ${found.length} product(s):`, {
    products: found.map(p => ({ name: p.name, score: p.score, price: p.price }))
  });

  return found;
}


/**
 * Step 3: Apply fallback if no products found
 */
function applyFallbackProducts(found, allProducts) {
  if (found.length === 0) {
    info(SOURCE, "No products found by tag matching, applying fallback");
    const fallback = allProducts.slice(0, config.search.fallbackProducts);
    info(SOURCE, `Using ${fallback.length} fallback product(s):`, {
      products: fallback.map(p => ({ name: p.name, price: p.price }))
    });
    return fallback;
  }
  return found;
}

/**
 * Step 4: Build optimized prompt with found products
 */
function createOptimizedPrompt(message, products, settings, detectedTags) {
  debug(SOURCE, `Building prompt with ${products.length} product(s)`, {
    products: products.map(p => p.name),
    tags: detectedTags
  });
  const prompt = buildPrompt({
    message,
    products,
    settings,
    detectedTags: detectedTags || []
  });
  debug(SOURCE, `Prompt built (length: ${prompt.length} chars)`);
  return prompt;
}

/**
 * Step 5: Get LLM response
 */
async function getLLMResponse(prompt) {
  info(SOURCE, "Sending prompt to LLM");
  const reply = await askLLM(prompt);
  info(SOURCE, `LLM response received (length: ${reply.length} chars)`);
  return reply;
}

/**
 * Main chat handler
 * Flow: Settings → Detect Intent (Tags) → Search Products → Build Prompt → Query LLM
 */
async function handleChat(message, clientId, products) {
  info(SOURCE, `=== Chat initiated ===`);
  info(SOURCE, `Client: ${clientId}, Message: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`);

  try {
    // Step 1: Load settings
    const settings = getClientSettings(clientId);
    debug(SOURCE, `Settings loaded:`, {
      tone: settings.tone,
      max_products: settings.max_products,
      strategy: settings.strategy
    });

    // Step 2: Detect basic user intent (greeting/product_search)
    const intent = detectIntent(message);
    info(SOURCE, `Intent detected: ${intent}`);

    const greetingRules = settings.conversation_rules?.greeting || {};
    if (intent === "greeting" && greetingRules.enabled) {
      info(SOURCE, "Handling greeting via configured conversation_rules");

      const productsForGreeting = greetingRules.show_products
        ? applyFallbackProducts([], products)
        : [];

      return {
        reply: greetingRules.response || "Salut! Cu ce te pot ajuta?",
        products: productsForGreeting
      };
    }

    // Proceed with normal flow (product search) when not greeting
    const availableProductTags = [...new Set(products.flatMap(p => p.tags || []))];
    debug(SOURCE, `Available product tags: ${availableProductTags.join(", ")}`);

    const detectedTags = await detectUserIntent(message, settings, availableProductTags);

    // Step 3: Search for products based on detected tags
    let found = findRelevantProducts(detectedTags, products, settings.max_products);

    // Step 4: Apply fallback if no products found
    found = applyFallbackProducts(found, products);

    // Step 5: Build prompt with detected tags context
    const prompt = createOptimizedPrompt(message, found, settings, detectedTags);

    // Step 6: Query LLM
    const reply = await getLLMResponse(prompt);

    info(SOURCE, `=== Chat completed successfully ===`);
    debug(SOURCE, `Final response:`, { length: reply.length, preview: reply.substring(0, 80) });
    
    return { reply, products: found };
  } catch (err) {
    error(SOURCE, "Chat handling failed", { error: err.message, stack: err.stack });
    throw err;
  }
}


module.exports = { handleChat };
