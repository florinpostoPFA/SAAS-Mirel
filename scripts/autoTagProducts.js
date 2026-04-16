const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { askLLM } = require("../services/llm");

dotenv.config();

const PRODUCTS_PATH = path.join(__dirname, "../data/products.json");
const ALLOWED_TAGS = new Set([
  // Location
  "interior", "exterior",
  // Surface (material)
  "plastic", "leather", "textile", "alcantara", "glass", "paint", "metal", "rubber", "wheels", "tires",
  // Purpose (action)
  "cleaning", "protection", "polish", "coating",
  // Product type
  "dressing", "cleaner", "detailer", "wax", "sealant", "apc",
  // Finish (result)
  "mat", "gloss", "satin", "natural"
]);
function normalizeTag(tag) {
  return tag
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeTags(tags) {
  return tags.map(tag =>
    tag.toLowerCase().trim()
  );
}

function loadProducts() {
  const raw = fs.readFileSync(PRODUCTS_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function buildPrompt(product) {
  return `You are an expert in auto detailing.

Extract structured tags for this product.

Rules:
- Include EXACTLY:
  - 1 location (interior or exterior, if applicable)
  - 1-2 surfaces (material types like plastic, leather, glass, rubber, paint, metal, wheels, tires, textile, alcantara)
  - 1 product type (dressing, cleaner, detailer, wax, sealant, apc)
  - EXACTLY 1 purpose from: cleaning, protection, polish, coating

STRICT PURPOSE RULES:
- "cleaning" → ONLY for products that remove dirt (APC, glass cleaner, interior cleaner)
- "polish" → for compounds, swirl removers, scratch removers, abrasive products
- If a product corrects paint defects → ALWAYS use "polish"
- "protection" → for waxes, sealants, dressings
- NEVER return both "cleaning" and "polish"
- NEVER return more than one purpose

Finish:
- Include finish ONLY if explicitly mentioned (mat, gloss, satin, natural)

Allowed tags:
interior, exterior, plastic, leather, textile, alcantara, glass, paint, metal, rubber, wheels, tires,
cleaning, protection, polish, coating, dressing, cleaner, detailer, wax, sealant, apc,
mat, gloss, satin, natural

Constraints:
- Use ONLY tags from the allowed list
- Do NOT invent new tags

Return ONLY a JSON array of tags.

Product:
Name: ${product.name || ""}
Description: ${product.description || ""}`;
}

function extractJSON(text) {
  if (!text) return "";

  return String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/^json\s*/i, "")
    .trim();
}

function parseTagsFromResponse(text, cleaned = extractJSON(text)) {
  const candidates = [cleaned];

  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.push(cleaned.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      if (candidate === candidates[candidates.length - 1]) {
        console.error("TAG PARSE FAILED");
        console.log("RAW:", text);
        console.log("CLEANED:", cleaned);
      }
    }
  }

  return [];
}

function sanitizeTags(tags) {
  const PURPOSE_TAGS = ["cleaning", "protection", "polish", "coating"];

let purposes = tags.filter(t => PURPOSE_TAGS.includes(t));

// Rule: if polish exists → remove cleaning
if (purposes.includes("polish")) {
  tags = tags.filter(t => t !== "cleaning");
}

// Ensure max 1 purpose
let found = null;
tags = tags.filter(tag => {
  if (PURPOSE_TAGS.includes(tag)) {
    if (found) return false;
    found = tag;
  }
  return true;
});

  const seen = new Set();
  const result = [];
  for (const tag of tags) {
    const normalized = String(tag || "").toLowerCase().trim();
    if (normalized && ALLOWED_TAGS.has(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

async function generateTagsForProduct(product) {
  const prompt = buildPrompt(product);
  const raw = await askLLM(prompt);
  const cleaned = extractJSON(raw);

  let tags = [];

  try {
    tags = JSON.parse(cleaned);
  } catch (err) {
    tags = parseTagsFromResponse(raw, cleaned);
  }

  if (!Array.isArray(tags)) {
    tags = [];
  }

  tags = tags.map(tag => String(tag).toLowerCase().trim());
  console.log("RAW TAGS:", tags);
  tags = sanitizeTags(tags);
  console.log("FINAL TAGS:", tags);

  console.log("PRODUCT:", product.name);
  console.log("RAW:", raw);
  console.log("CLEANED:", cleaned);
  console.log("TAGS:", tags);
  console.log("----------------");

  return tags;
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function main() {
  const BATCH_SIZE = 20;
  const products = loadProducts();

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Processing batch ${batchNumber}...`);

    for (const product of batch) {
      if (Array.isArray(product.tags) && product.tags.length > 0) {
        continue;
      }

      try {
        const parsedTags = await generateTagsForProduct(product);
        product.tags = normalizeTags(parsedTags);
        console.log(`Tagged: ${product.name}`);
      } catch (err) {
        console.error(`Failed to tag: ${product.name}`, err.message);
      }

      await delay(500);
    }

    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
    console.log(`Batch ${batchNumber} saved`);
  }

  const tagged = products.filter(p => Array.isArray(p.tags) && p.tags.length > 0).length;
  console.log(`Done. Tagged ${tagged} / ${products.length} products.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error("Failed to auto-tag products:", error.message);
    process.exit(1);
  });
}

module.exports = {
  extractJSON,
  parseTagsFromResponse,
  sanitizeTags,
  generateTagsForProduct
};
