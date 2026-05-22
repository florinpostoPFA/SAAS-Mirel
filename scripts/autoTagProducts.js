const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { askLLM } = require("../services/llm");
const { normalizeTagList, applyProductTagOverrides } = require("../services/tagNormalization");

dotenv.config();

const PRODUCTS_PATH = path.join(__dirname, "../data/products.json");
const VOCABULARY_PATH = path.join(__dirname, "../tests/tagVocabulary.json");
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

function buildPrompt(product, categoryMeta = CATEGORY_META) {
  const groupedVocabulary = formatCategoryPromptLines(categoryMeta);
  return `You are an expert in auto detailing.

Extract structured tags for this product.

Rules:
- Pick at most 5 tags total across all categories.
- Respect max_tags per category (see list below).
- Use ONLY tag names from the allowed list (not the parenthetical notes).

Allowed tags grouped by category. Pick at most max_tags per category.
${groupedVocabulary}

Constraints:
- Use ONLY tags from the allowed list
- Do NOT invent new tags
- Return ONLY a JSON array of tag name strings

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

async function generateTagsForProduct(product) {
  const fromKeywords = inferDeterministicTags(product);

  const prompt = buildPrompt(product);
  const raw = await askLLM(prompt);
  const cleaned = extractJSON(raw);

  let parsed = [];

  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    parsed = parseTagsFromResponse(raw, cleaned);
  }

  if (!Array.isArray(parsed)) {
    parsed = [];
  }

  parsed = parsed.map((tag) => String(tag).toLowerCase().trim());
  const { tags, droppedUnknownTags } = sanitizeTags([...fromKeywords, ...parsed]);

  console.log("PRODUCT:", product.name);
  console.log("RAW:", raw);
  console.log("CLEANED:", cleaned);
  console.log("TAGS:", tags);
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
  return {
    forceAll: argv.includes("--force-all")
  };
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
          const result = await llmFn(product);
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
  const { forceAll } = parseCliArgs();
  const products = loadProducts();
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
  extractJSON,
  parseTagsFromResponse,
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
