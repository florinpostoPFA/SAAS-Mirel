const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { askLLM } = require("../services/llm");
const { normalizeTagList, applyProductTagOverrides } = require("../services/tagNormalization");

dotenv.config();

const PRODUCTS_PATH = path.join(__dirname, "../data/products.json");
const VOCABULARY_PATH = path.join(__dirname, "../Tests/tagVocabulary.json");
const VOCABULARY_CATEGORIES = [
  "location",
  "surface",
  "purpose",
  "product_type",
  "finish",
  "ph",
  "coating_safety",
  "concentration"
];

const COST_PER_PRODUCT_USD = 0.00015;

/** @type {ReturnType<typeof loadTagVocabulary>} */
let vocabularyBundle = loadTagVocabulary();
let ALLOWED_TAGS = vocabularyBundle.allowedTags;
let CATEGORY_META = vocabularyBundle.categoryMeta;

/**
 * @returns {{ allowedTags: Set<string>, categoryMeta: Record<string, { required?: boolean, max_tags?: number, note?: string, tags: Array<{ name: string, note?: string }> }>, raw: object }}
 */
function loadTagVocabulary() {
  const raw = JSON.parse(fs.readFileSync(VOCABULARY_PATH, "utf-8"));
  const allowedTags = new Set();
  const categoryMeta = {};

  for (const category of VOCABULARY_CATEGORIES) {
    const block = raw.vocabulary?.[category];
    if (!block || !Array.isArray(block.tags)) continue;
    categoryMeta[category] = {
      required: block.required,
      max_tags: block.max_tags,
      note: block.note,
      tags: block.tags
    };
    for (const tag of block.tags) {
      if (tag?.name) allowedTags.add(tag.name);
    }
  }

  return { allowedTags, categoryMeta, raw };
}

/** Deterministic substring hints. Keys must match ALLOWED_TAGS when emitted. */
const KEYWORD_TAG_MAPPING = {
  interior: ["interior", "cockpit", "bord", "cotiera", "scaun"],
  exterior: ["exterior", "caroserie", "vopsea"],
  leather_natural: ["leather", "piele"],
  textile: ["textil", "material textil", "stofa", "stoffa", "fabric", "upholstery"],
  alcantara: ["alcantara"],
  plastic_interior: ["plastic", "trim", "bord", "console"],
  glass: ["glass", "geam", "geamuri", "sticla", "windshield", "parbriz", "luneta"],
  paint: ["vopsea", "caroserie", "lac", "paint", "clearcoat"],
  wheels: ["janta", "jante", "rim", "rims", "wheel", "wheels"],
  tires: ["tire", "tires", "anvelopa", "anvelope"],
  cleaning: ["clean", "cleaner", "curata", "murdar", "pata"],
  protection: ["protect", "seal", "dressing"]
};

/**
 * @param {{ name?: string, description?: string, short_description?: string, meta_keyword?: string, searchText?: string }} product
 * @returns {string}
 */
function collectProductText(product) {
  return [
    product?.name,
    product?.description,
    product?.short_description,
    product?.meta_keyword,
    product?.searchText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * @param {{ name?: string, description?: string, short_description?: string, meta_keyword?: string, searchText?: string }} product
 * @returns {string[]}
 */
function inferDeterministicTags(product) {
  const text = collectProductText(product);
  const out = [];
  const seen = new Set();
  for (const [tag, keywords] of Object.entries(KEYWORD_TAG_MAPPING)) {
    if (!ALLOWED_TAGS.has(tag)) continue;
    for (const kw of keywords) {
      if (!kw) continue;
      if (text.includes(String(kw).toLowerCase())) {
        if (!seen.has(tag)) {
          seen.add(tag);
          out.push(tag);
        }
        break;
      }
    }
  }
  return out;
}

function normalizeTags(tags) {
  return normalizeTagList(tags);
}

function loadProducts() {
  const raw = fs.readFileSync(PRODUCTS_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function formatCategoryPromptLines(categoryMeta) {
  return VOCABULARY_CATEGORIES.map((category) => {
    const block = categoryMeta[category];
    if (!block) return "";
    const reqLabel = block.required ? "required" : "optional";
    const tagList = block.tags
      .map((tag) => `${tag.name} (${tag.note || ""})`)
      .join(", ");
    return `${category} (${reqLabel}, max ${block.max_tags}): ${tagList}`;
  })
    .filter(Boolean)
    .join("\n");
}

const SURFACE_PREFERENCE_RULES = `Surface preferences:
- If product targets tires (anvelope, tyres): ALWAYS include \`tires\`. Include \`rubber\` only if also for rubber seals/weatherstripping separate from tires.
- If product targets wheel rims (jante, wheels): ALWAYS include \`wheels\`. Include \`metal\` only if also for chrome/brushed metal trim separate from wheels.
- Leather products (piele): enumerate ALL applicable sub-variants. Default to BOTH \`leather_natural\` + \`leather_synthetic\` unless name explicitly limits to one. Include \`alcantara\` when name mentions alcantara/microfibra.
- Glass cleaners (sticla, geamuri): default \`location: exterior\` unless name explicitly says interior-only.`;

const FEW_SHOT_EXAMPLES = `Few-shot examples (sibling products, not test SKUs):

Tire dressing — "Dressing Cauciuc ADBL Black Water, 500ml":
{
  "location": "exterior",
  "surface": ["tires"],
  "purpose": "protection",
  "product_type": "tire_dressing",
  "concentration": "ready_to_use"
}

Wheel cleaner — "Solutie curatare jante Koch Chemie Magic Wheel Cleaner, Mwc, 500ml":
{
  "location": "exterior",
  "surface": ["wheels"],
  "purpose": "cleaning",
  "product_type": "wheel_cleaner",
  "ph": "ph_neutral",
  "concentration": "ready_to_use"
}

Interior plastic cleaner — "Solutie curatare interior plastic InsideUp 500 ml":
{
  "location": "interior",
  "surface": ["plastic_interior"],
  "purpose": "cleaning",
  "product_type": "interior_cleaner",
  "concentration": "ready_to_use"
}

Leather conditioner — "Balsam hidratare si protectie piele ADBL Leather Conditioner, 500ml":
{
  "location": "interior",
  "surface": ["leather_natural", "leather_synthetic"],
  "purpose": "conditioning",
  "product_type": "leather_conditioner",
  "concentration": "ready_to_use"
}

Glass cleaner — "Solutie curatare sticla cu efect hidrofob Adbl Hybrid Glass, 1L":
{
  "location": "exterior",
  "surface": ["glass"],
  "purpose": "cleaning",
  "product_type": "glass_cleaner",
  "concentration": "ready_to_use"
}`;

const AXIS_OUTPUT_SCHEMA = `{
  "location": "<one tag>",
  "surface": ["<1–3 tags>"],
  "purpose": "<one tag>",
  "product_type": "<one tag>",
  "finish": "<tag or omit>",
  "ph": "<tag or omit>",
  "coating_safety": "<tag or omit>",
  "concentration": "<tag or omit>"
}`;

function normalizeAxisScalar(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function normalizeAxisTagList(values) {
  if (!Array.isArray(values)) {
    const single = normalizeAxisScalar(values);
    return single ? [single] : [];
  }
  return [...new Set(values.map((v) => normalizeAxisScalar(v)).filter(Boolean))];
}

/**
 * Flatten per-axis LLM object into product.tags string[] (downstream contract).
 * @param {Record<string, unknown>} axisObj
 * @returns {string[]}
 */
function flattenAxisTagsObject(axisObj) {
  if (!axisObj || typeof axisObj !== "object" || Array.isArray(axisObj)) {
    return [];
  }
  const out = [];
  const location = normalizeAxisScalar(axisObj.location);
  if (location) out.push(location);
  out.push(...normalizeAxisTagList(axisObj.surface));
  const purpose = normalizeAxisScalar(axisObj.purpose);
  if (purpose) out.push(purpose);
  const productType = normalizeAxisScalar(axisObj.product_type);
  if (productType) out.push(productType);
  for (const key of ["finish", "ph", "coating_safety", "concentration"]) {
    const value = normalizeAxisScalar(axisObj[key]);
    if (value) out.push(value);
  }
  return out;
}

function buildPrompt(product, categoryMeta = CATEGORY_META) {
  const groupedVocabulary = formatCategoryPromptLines(categoryMeta);
  return `You are an expert in auto detailing.

Extract structured tags for this product as a per-axis JSON object (not a flat tag list).

Rules:
- Fill every required axis: location, surface (1–3 tags), purpose, product_type.
- Respect max_tags per category (see vocabulary below).
- Use ONLY tag names from the allowed list (not the parenthetical notes).
- Omit optional axes (finish, ph, coating_safety, concentration) when unknown.

${SURFACE_PREFERENCE_RULES}

Allowed tags grouped by category:
${groupedVocabulary}

Output contract — return ONLY this JSON object shape (omit optional keys when not applicable):
${AXIS_OUTPUT_SCHEMA}

${FEW_SHOT_EXAMPLES}

Constraints:
- Use ONLY tags from the allowed list
- Do NOT invent new tags
- Return ONLY the JSON object (no markdown, no commentary)

Product:
Name: ${product.name || ""}
Description: ${product.description || ""}`;
}

function buildRetryPrompt(reason) {
  return `Previous output failed validation: ${reason}. Return ONLY the JSON object specified, using ONLY tag names from the allowed list.`;
}

function extractJSON(text) {
  if (!text) return "";

  return String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/^json\s*/i, "")
    .trim();
}

function parseAxisObjectFromText(text, cleaned = extractJSON(text)) {
  const candidates = [cleaned];
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    candidates.push(cleaned.slice(objStart, objEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      // try next candidate
    }
  }
  return null;
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

/**
 * @param {Record<string, unknown>} axisObj
 * @param {Set<string>} [allowedTags]
 * @returns {{ ok: boolean, reason?: string, flatTags?: string[], droppedUnknownTags?: string[] }}
 */
function validateAxisTagObject(axisObj, allowedTags = ALLOWED_TAGS) {
  if (!axisObj || typeof axisObj !== "object" || Array.isArray(axisObj)) {
    return { ok: false, reason: "response is not a JSON object" };
  }

  const location = normalizeAxisScalar(axisObj.location);
  if (!location) {
    return { ok: false, reason: "missing required location" };
  }

  const surfaces = normalizeAxisTagList(axisObj.surface);
  const surfaceMax = CATEGORY_META.surface?.max_tags || 3;
  if (surfaces.length === 0) {
    return { ok: false, reason: "missing required surface tags" };
  }
  if (surfaces.length > surfaceMax) {
    return { ok: false, reason: `surface has more than ${surfaceMax} tags` };
  }

  if (!normalizeAxisScalar(axisObj.purpose)) {
    return { ok: false, reason: "missing required purpose" };
  }
  if (!normalizeAxisScalar(axisObj.product_type)) {
    return { ok: false, reason: "missing required product_type" };
  }

  const flat = flattenAxisTagsObject(axisObj);
  const { tags, droppedUnknownTags } = sanitizeTags(flat, allowedTags);

  if (droppedUnknownTags.length > 0) {
    return {
      ok: false,
      reason: `off-vocab tags: ${droppedUnknownTags.join(", ")}`,
      flatTags: tags,
      droppedUnknownTags
    };
  }
  if (tags.length === 0) {
    return { ok: false, reason: "no in-vocabulary tags after sanitization" };
  }

  return { ok: true, flatTags: tags, droppedUnknownTags: [] };
}

/**
 * @param {string} raw
 * @returns {{ ok: boolean, reason?: string, flatTags?: string[], droppedUnknownTags?: string[] }}
 */
function parseLlmTagResponse(raw) {
  const cleaned = extractJSON(raw);
  let axisObj = null;

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      axisObj = parsed;
    } else if (Array.isArray(parsed)) {
      const legacy = parsed.map((tag) => String(tag).toLowerCase().trim());
      const { tags, droppedUnknownTags } = sanitizeTags(legacy);
      if (droppedUnknownTags.length > 0) {
        return {
          ok: false,
          reason: `off-vocab tags: ${droppedUnknownTags.join(", ")}`,
          flatTags: tags,
          droppedUnknownTags
        };
      }
      return { ok: true, flatTags: tags, droppedUnknownTags: [] };
    }
  } catch (err) {
    axisObj = parseAxisObjectFromText(raw, cleaned);
  }

  if (!axisObj) {
    axisObj = parseAxisObjectFromText(raw, cleaned);
  }
  if (axisObj) {
    return validateAxisTagObject(axisObj);
  }

  const legacy = parseTagsFromResponse(raw, cleaned).map((tag) =>
    String(tag).toLowerCase().trim()
  );
  if (legacy.length === 0) {
    return { ok: false, reason: "invalid JSON — could not parse object or array" };
  }

  const { tags, droppedUnknownTags } = sanitizeTags(legacy);
  if (droppedUnknownTags.length > 0) {
    return {
      ok: false,
      reason: `off-vocab tags: ${droppedUnknownTags.join(", ")}`,
      flatTags: tags,
      droppedUnknownTags
    };
  }
  return { ok: true, flatTags: tags, droppedUnknownTags: [] };
}

/**
 * @param {string[]} tags
 * @param {Set<string>} [allowedTags]
 * @returns {{ tags: string[], droppedUnknownTags: string[] }}
 */
function sanitizeTags(tags, allowedTags = ALLOWED_TAGS) {
  const PURPOSE_TAGS = [
    "cleaning",
    "decontamination",
    "polish",
    "protection",
    "coating",
    "conditioning",
    "restoration",
    "neutralization"
  ];

  let working = Array.isArray(tags) ? [...tags] : [];
  const purposes = working.filter((t) => PURPOSE_TAGS.includes(t));

  if (purposes.includes("polish")) {
    working = working.filter((t) => t !== "cleaning");
  }

  let foundPurpose = null;
  working = working.filter((tag) => {
    if (PURPOSE_TAGS.includes(tag)) {
      if (foundPurpose) return false;
      foundPurpose = tag;
    }
    return true;
  });

  const normalized = normalizeTagList(working);
  const kept = [];
  const droppedUnknownTags = [];

  for (const tag of normalized) {
    if (allowedTags.has(tag)) {
      kept.push(tag);
    } else if (tag) {
      droppedUnknownTags.push(tag);
    }
  }

  if (droppedUnknownTags.length > 0) {
    console.error(`Dropped unknown tags: ${droppedUnknownTags.join(", ")}`);
  }

  return { tags: kept, droppedUnknownTags };
}

async function generateTagsForProduct(product, options = {}) {
  const fromKeywords = options.llmOnly ? [] : inferDeterministicTags(product);

  const prompt = buildPrompt(product);
  let raw = await askLLM(prompt);
  let parsed = parseLlmTagResponse(raw);

  if (!parsed.ok) {
    const retryPrompt = `${prompt}\n\n${buildRetryPrompt(parsed.reason)}`;
    const retryRaw = await askLLM(retryPrompt);
    raw = `${raw}\n---RETRY---\n${retryRaw}`;
    parsed = parseLlmTagResponse(retryRaw);
  }

  const flatLlmTags = parsed.ok ? parsed.flatTags || [] : [];
  const { tags, droppedUnknownTags } = sanitizeTags([...fromKeywords, ...flatLlmTags]);

  console.log("PRODUCT:", product.name);
  console.log("RAW:", raw);
  console.log("TAGS:", tags);
  if (!parsed.ok) {
    console.log("PARSE:", parsed.reason);
  }
  console.log("----------------");

  return { tags, llmRawResponse: raw, droppedUnknownTags };
}

function mergeDeterministicTags(product) {
  const fromKeywords = inferDeterministicTags(product);
  const existing = Array.isArray(product?.tags) ? product.tags : [];
  const { tags, droppedUnknownTags } = sanitizeTags([...existing, ...fromKeywords]);
  return {
    tags: applyProductTagOverrides(tags, product),
    droppedUnknownTags
  };
}

function parseCliArgs(argv = process.argv) {
  const forceAll = argv.includes("--force-all");
  let limit = null;
  let skus = null;

  const limitIdx = argv.indexOf("--limit");
  if (limitIdx !== -1 && argv[limitIdx + 1]) {
    const parsed = parseInt(argv[limitIdx + 1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = parsed;
    }
  }

  const skusIdx = argv.indexOf("--skus");
  if (skusIdx !== -1 && argv[skusIdx + 1]) {
    skus = argv[skusIdx + 1]
      .split(",")
      .map((sku) => sku.trim())
      .filter(Boolean);
  }

  return { forceAll, limit, skus };
}

function buildDiffLogPath(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0")
  ].join("");
  return path.join(__dirname, "../logs", `retag-${stamp}-${time}.jsonl`);
}

function ensureLogsDir() {
  const logsDir = path.join(__dirname, "../logs");
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * @param {import("fs").WriteStream} stream
 * @param {object} entry
 */
function writeDiffLogEntry(stream, entry) {
  stream.write(`${JSON.stringify(entry)}\n`);
}

/**
 * @param {object[]} products
 * @param {{ forceAll?: boolean, persistPath?: string, diffLogPath?: string, llmFn?: typeof generateTagsForProduct }} [options]
 */
async function runTaggingPipeline(products, options = {}) {
  const { forceAll = false, persistPath = PRODUCTS_PATH, diffLogPath, llmFn = generateTagsForProduct } = options;
  const BATCH_SIZE = 20;
  let diffLogStream = null;
  let diffLogEntries = 0;

  if (forceAll) {
    const estimatedCost = (products.length * COST_PER_PRODUCT_USD).toFixed(2);
    console.log(
      `Running --force-all on ${products.length} products, estimated cost $${estimatedCost}`
    );
  }

  ensureLogsDir();
  const logPath = diffLogPath || buildDiffLogPath();
  diffLogStream = fs.createWriteStream(logPath, { flags: "a" });

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Processing batch ${batchNumber}...`);

    for (const product of batch) {
      const tagsBefore = Array.isArray(product.tags) ? [...product.tags] : [];
      const startedAt = Date.now();
      let llmRawResponse = "";
      let droppedUnknownTags = [];

      try {
        if (forceAll) {
          product.tags = [];
          if (Object.prototype.hasOwnProperty.call(product, "aiTags")) {
            product.aiTags = [];
          }
        }

        const hasExistingTags = !forceAll && Array.isArray(product.tags) && product.tags.length > 0;

        if (hasExistingTags) {
          const merged = mergeDeterministicTags(product);
          product.tags = normalizeTags(merged.tags);
          droppedUnknownTags = merged.droppedUnknownTags;
          console.log(`Merged deterministic tags: ${product.name}`);
        } else {
          const result = await llmFn(product, { llmOnly: forceAll });
          llmRawResponse = result.llmRawResponse || "";
          droppedUnknownTags = result.droppedUnknownTags || [];
          product.tags = normalizeTags(applyProductTagOverrides(result.tags, product));
          console.log(`Tagged: ${product.name}`);
        }
      } catch (err) {
        console.error(`Failed to tag: ${product.name}`, err.message);
      }

      const tagsAfter = Array.isArray(product.tags) ? [...product.tags] : [];
      writeDiffLogEntry(diffLogStream, {
        id: product.id,
        name: product.name,
        tagsBefore,
        tagsAfter,
        llmRawResponse,
        droppedUnknownTags,
        durationMs: Date.now() - startedAt
      });
      diffLogEntries += 1;

      await delay(500);
    }

    if (persistPath) {
      fs.writeFileSync(persistPath, JSON.stringify(products, null, 2));
      console.log(`Batch ${batchNumber} saved`);
    }
  }

  await new Promise((resolve) => diffLogStream.end(resolve));
  console.log(`Diff log: ${logPath} (${diffLogEntries} entries)`);

  const tagged = products.filter((p) => Array.isArray(p.tags) && p.tags.length > 0).length;
  console.log(`Done. Tagged ${tagged} / ${products.length} products.`);

  return { diffLogPath: logPath, diffLogEntries, tagged };
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  const { forceAll, limit, skus } = parseCliArgs();
  let products = loadProducts();

  if (skus && skus.length > 0) {
    const skuSet = new Set(skus);
    products = products.filter(
      (product) => skuSet.has(String(product.id)) || skuSet.has(String(product.sku))
    );
  }
  if (limit) {
    products = products.slice(0, limit);
  }

  await runTaggingPipeline(products, { forceAll });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to auto-tag products:", error.message);
    process.exit(1);
  });
}

module.exports = {
  VOCABULARY_PATH,
  VOCABULARY_CATEGORIES,
  loadTagVocabulary,
  buildPrompt,
  buildRetryPrompt,
  extractJSON,
  parseTagsFromResponse,
  parseAxisObjectFromText,
  flattenAxisTagsObject,
  validateAxisTagObject,
  parseLlmTagResponse,
  sanitizeTags,
  generateTagsForProduct,
  mergeDeterministicTags,
  collectProductText,
  inferDeterministicTags,
  parseCliArgs,
  runTaggingPipeline,
  KEYWORD_TAG_MAPPING,
  getAllowedTags: () => ALLOWED_TAGS,
  reloadVocabulary: () => {
    vocabularyBundle = loadTagVocabulary();
    ALLOWED_TAGS = vocabularyBundle.allowedTags;
    CATEGORY_META = vocabularyBundle.categoryMeta;
    return vocabularyBundle;
  }
};
