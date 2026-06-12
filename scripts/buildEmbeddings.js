#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FLOWS_DIR = path.join(ROOT, "flows");
const INDEX_DIR = path.join(DATA_DIR, "embeddings", "v1");
const INDEX_PATH = path.join(INDEX_DIR, "index.json");

const MODEL_ID = "Xenova/bge-m3";
const DIMENSION = 1024;
const BATCH_SIZE = 16;
const MIN_TEXT_LEN = 8;

const PATHS = {
  products: path.join(DATA_DIR, "products.json"),
  knowledge: path.join(DATA_DIR, "knowledge.json"),
  knowledgeFlow: path.join(DATA_DIR, "knowledge_flow.json"),
  productSections: path.join(DATA_DIR, "productSections.json")
};

const PRODUCT_TYPE_TO_EFFECT = {
  wax: "wax",
  sealant: "sealant",
  ceramic_coating: "coating",
  tire_dressing: "dressing",
  trim_dressing: "dressing",
  iron_remover: "decontaminant",
  tar_remover: "decontaminant",
  bug_remover: "decontaminant",
  clay_bar: "decontaminant",
  polish_compound: "polish",
  quick_detailer: "detailer",
  shampoo: "cleaner",
  snow_foam: "cleaner",
  apc: "cleaner",
  wheel_cleaner: "cleaner",
  tire_cleaner: "cleaner",
  leather_cleaner: "cleaner",
  glass_cleaner: "cleaner",
  interior_cleaner: "cleaner",
  leather_conditioner: "protectant",
  fabric_protectant: "protectant",
  rubber_protectant: "protectant"
};

const PRODUCT_TYPE_TO_USE_CASE = {
  tire_dressing: ["tires_dressing"],
  tire_cleaner: ["tires_cleaning"],
  wheel_cleaner: ["wheels_cleaning"],
  leather_cleaner: ["interior_leather_care"],
  leather_conditioner: ["interior_leather_care"],
  interior_cleaner: ["interior_general_clean"],
  glass_cleaner: ["interior_glass", "exterior_glass"],
  shampoo: ["exterior_wash"],
  snow_foam: ["exterior_wash"],
  apc: ["interior_general_clean", "exterior_wash"],
  wax: ["exterior_paint_protection", "exterior_paint_polish"],
  sealant: ["exterior_paint_protection"],
  ceramic_coating: ["exterior_paint_protection", "ceramic_application"],
  iron_remover: ["exterior_decontamination"],
  tar_remover: ["exterior_decontamination"],
  bug_remover: ["exterior_decontamination"],
  clay_bar: ["exterior_decontamination"],
  polish_compound: ["exterior_paint_polish"]
};

const EFFECT_ALIASES = {
  wax: new Set(["wax"]),
  polish: new Set(["polish", "compound"]),
  compound: new Set(["polish", "compound"]),
  coating: new Set(["coating", "sealant"]),
  sealant: new Set(["sealant", "coating"]),
  dressing: new Set(["dressing", "protectant"]),
  protectant: new Set(["protectant", "dressing"]),
  decontaminant: new Set(["decontaminant", "cleaner"]),
  cleaner: new Set(["cleaner", "decontaminant", "detailer"]),
  detailer: new Set(["detailer", "cleaner"]),
  cloth: new Set(["cloth"])
};

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function shortSha256(input) {
  return sha256(input).slice(0, 12);
}

function hashFileBytes(filePath) {
  return shortSha256(fs.readFileSync(filePath));
}

function computeFlowsArtifactHash() {
  const flowFiles = fs
    .readdirSync(FLOWS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const concat = flowFiles
    .map((name) => fs.readFileSync(path.join(FLOWS_DIR, name), "utf8"))
    .join("");
  return shortSha256(concat);
}

function normalizeField(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function joinFields(...parts) {
  return parts.map(normalizeField).filter(Boolean).join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function indexById(entries, idKey = "id") {
  const map = new Map();
  for (const entry of entries || []) {
    const id = entry && entry[idKey];
    if (id != null) {
      map.set(String(id), entry);
    }
  }
  return map;
}

function createSkipLogger(skipped) {
  return (reason, detail) => {
    skipped[reason] = (skipped[reason] || 0) + 1;
    if (detail) {
      console.warn(`[skip:${reason}] ${detail}`);
    }
  };
}

function passesTagEffectUseCaseCrossCheck(product) {
  const applicability = product?.applicability;
  if (!applicability || !applicability.effect) {
    return { ok: true };
  }

  const tags = Array.isArray(product.tags)
    ? product.tags.map((tag) => String(tag || "").toLowerCase().trim()).filter(Boolean)
    : [];
  const effect = String(applicability.effect || "").toLowerCase();
  const useCases = Array.isArray(applicability.use_case)
    ? applicability.use_case.map((value) => String(value || "").toLowerCase().trim()).filter(Boolean)
    : [];

  for (const tag of tags) {
    const expectedEffect = PRODUCT_TYPE_TO_EFFECT[tag];
    if (expectedEffect && expectedEffect !== effect) {
      const allowed = EFFECT_ALIASES[effect];
      if (!allowed || !allowed.has(expectedEffect)) {
        return {
          ok: false,
          reason: `tag=${tag},effect=${effect},expectedEffect=${expectedEffect}`
        };
      }
    }

    const expectedUseCases = PRODUCT_TYPE_TO_USE_CASE[tag];
    if (expectedUseCases && expectedUseCases.length > 0 && useCases.length > 0) {
      const matches = expectedUseCases.some((candidate) => useCases.includes(candidate));
      if (!matches) {
        return {
          ok: false,
          reason: `tag=${tag},use_case=[${useCases.join(",")}],expected=[${expectedUseCases.join(",")}]`
        };
      }
    }
  }

  const allowedTags = EFFECT_ALIASES[effect];
  if (allowedTags && tags.length > 0) {
    const typedTags = tags.filter((tag) => PRODUCT_TYPE_TO_EFFECT[tag]);
    if (typedTags.length > 0) {
      const aligned = typedTags.some((tag) => {
        const expected = PRODUCT_TYPE_TO_EFFECT[tag];
        return expected === effect || allowedTags.has(expected);
      });
      if (!aligned) {
        return {
          ok: false,
          reason: `typedTags=[${typedTags.join(",")}],effect=${effect}`
        };
      }
    }
  }

  return { ok: true };
}

function maybeAddItem(items, candidate, logSkip) {
  const text = normalizeField(candidate.text);
  if (!text || text.length < MIN_TEXT_LEN) {
    logSkip("empty", `${candidate.id} (${candidate.type})`);
    return false;
  }

  items.push({
    id: candidate.id,
    type: candidate.type,
    source_path: candidate.source_path,
    source_ref: candidate.source_ref,
    text
  });
  return true;
}

function buildKnowledgeItems(knowledgeEntries, items, counts, logSkip) {
  for (const entry of knowledgeEntries || []) {
    const entryId = String(entry?.id || "").trim();
    if (!entryId) continue;

    const added = maybeAddItem(
      items,
      {
        id: `knowledge:${entryId}`,
        type: "knowledge",
        source_path: "data/knowledge.json",
        source_ref: entryId,
        text: joinFields(entry.title, entry.content || entry.body)
      },
      logSkip
    );
    if (added) counts.knowledge += 1;
  }
}

function buildKnowledgeFlowItems(
  flowFiles,
  knowledgeById,
  knowledgeFlowById,
  items,
  counts,
  logSkip
) {
  for (const flowFile of flowFiles) {
    const flow = readJson(flowFile);
    const flowId = String(flow?.flowId || path.basename(flowFile, ".json"));
    const steps = Array.isArray(flow?.steps) ? flow.steps : [];

    for (const step of steps) {
      const stepId = String(step?.id || "").trim();
      if (!stepId) continue;

      const knowledgeIds = Array.isArray(step.knowledgeIds) ? step.knowledgeIds : [];
      const chunks = [];
      for (const knowledgeId of knowledgeIds) {
        const entry =
          knowledgeFlowById.get(String(knowledgeId)) || knowledgeById.get(String(knowledgeId));
        if (!entry) continue;
        const chunk = joinFields(entry.title, entry.content || entry.body);
        if (chunk) chunks.push(chunk);
      }

      const added = maybeAddItem(
        items,
        {
          id: `knowledge_flow:${flowId}:${stepId}`,
          type: "knowledge_flow",
          source_path: path.relative(ROOT, flowFile),
          source_ref: `${flowId}:${stepId}`,
          text: chunks.join("\n")
        },
        logSkip
      );
      if (added) counts.knowledge_flow += 1;
    }
  }
}

function buildProductItems(products, droppedProducts, items, counts, logSkip) {
  for (const product of products || []) {
    const productCode = String(product?.id || product?.product_code || "").trim();
    if (!productCode) continue;

    if (Number(product.price) === 0) {
      droppedProducts.add(productCode);
      logSkip("price_zero", productCode);
      continue;
    }

    const crossCheck = passesTagEffectUseCaseCrossCheck(product);
    if (!crossCheck.ok) {
      droppedProducts.add(productCode);
      logSkip("tag_disagreement", `${productCode} (${crossCheck.reason})`);
      continue;
    }

    const tagsText = Array.isArray(product.tags)
      ? product.tags.map((tag) => normalizeField(tag)).filter(Boolean).join(", ")
      : "";

    const added = maybeAddItem(
      items,
      {
        id: `product:${productCode}`,
        type: "product",
        source_path: "data/products.json",
        source_ref: productCode,
        text: joinFields(product.name, product.short_description, product.description, tagsText)
      },
      logSkip
    );
    if (added) counts.product += 1;
  }
}

function buildProductSectionItems(productSectionsDoc, droppedProducts, items, counts, logSkip) {
  const entries = Array.isArray(productSectionsDoc?.entries) ? productSectionsDoc.entries : [];

  for (const entry of entries) {
    const productCode = String(entry?.sku || entry?.product_code || "").trim();
    if (!productCode) continue;

    if (droppedProducts.has(productCode)) {
      logSkip("parent_dropped", `${productCode}`);
      continue;
    }

    const sections = entry?.sections && typeof entry.sections === "object" ? entry.sections : {};
    for (const [sectionKey, sectionValue] of Object.entries(sections)) {
      const sectionText = normalizeField(sectionValue);
      if (!sectionText) continue;

      const added = maybeAddItem(
        items,
        {
          id: `product_section:${productCode}:${sectionKey}`,
          type: "product_section",
          source_path: "data/productSections.json",
          source_ref: `${productCode}:${sectionKey}`,
          text: sectionText
        },
        logSkip
      );
      if (added) counts.product_section += 1;
    }
  }
}

function buildFlowStepItems(flowFiles, items, counts, logSkip) {
  for (const flowFile of flowFiles) {
    const flow = readJson(flowFile);
    const flowId = String(flow?.flowId || path.basename(flowFile, ".json"));
    const steps = Array.isArray(flow?.steps) ? flow.steps : [];

    for (const step of steps) {
      const stepId = String(step?.id || "").trim();
      if (!stepId) continue;

      const instructions = step.description || step.instructions || step.goal || "";
      const added = maybeAddItem(
        items,
        {
          id: `flow:${flowId}:${stepId}`,
          type: "flow_step",
          source_path: path.relative(ROOT, flowFile),
          source_ref: `${flowId}:${stepId}`,
          text: joinFields(step.title || step.name, instructions)
        },
        logSkip
      );
      if (added) counts.flow_step += 1;
    }
  }
}

function discoverModelRevision() {
  const cacheRoot = path.join(
    ROOT,
    "node_modules",
    "@xenova",
    "transformers",
    ".cache",
    "Xenova",
    "bge-m3"
  );
  const parts = [];

  const configPath = path.join(cacheRoot, "config.json");
  if (fs.existsSync(configPath)) {
    parts.push(fs.readFileSync(configPath));
  }

  const onnxDir = path.join(cacheRoot, "onnx");
  if (fs.existsSync(onnxDir)) {
    const onnxFiles = fs.readdirSync(onnxDir).filter((name) => name.endsWith(".onnx")).sort();
    for (const name of onnxFiles) {
      parts.push(fs.readFileSync(path.join(onnxDir, name)));
    }
  }

  if (parts.length === 0) {
    return "cache-missing";
  }

  const merged = Buffer.concat(parts.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part))));
  return shortSha256(merged);
}

async function loadEmbedder(pipeline) {
  return pipeline("feature-extraction", MODEL_ID, { quantized: true });
}

async function encodeItems(embedder, items) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const startedAt = Date.now();

    for (const item of batch) {
      const output = await embedder(item.text, { pooling: "mean", normalize: true });
      const vector = Array.from(output.data);
      if (vector.length !== DIMENSION) {
        throw new Error(`Embedding dimension mismatch for ${item.id}: got ${vector.length}, expected ${DIMENSION}`);
      }
      item.embedding = vector;
    }

    console.log(
      `Encoded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(items.length / BATCH_SIZE)} (${batch.length} items, ${Date.now() - startedAt}ms)`
    );
  }
}

function writeIndexAtomically(indexPayload) {
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  const tmpPath = `${INDEX_PATH}.tmp`;
  const json = `${JSON.stringify(indexPayload)}\n`;
  fs.writeFileSync(tmpPath, json, "utf8");
  const fd = fs.openSync(tmpPath, "r");
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmpPath, INDEX_PATH);
  return json;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

async function encodeQuery(embedder, query) {
  const output = await embedder(query, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

function topMatches(queryVector, items, limit) {
  return items
    .map((item) => ({
      id: item.id,
      type: item.type,
      text: item.text,
      score: cosineSimilarity(queryVector, item.embedding)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

async function runSanityProbes(embedder, indexPayload) {
  const items = indexPayload.items;

  const probes = [
    {
      query: "anvelope dressing",
      validate(matches) {
        const hit = matches.some(
          (match) =>
            /tire|anvelop|wheel|dressing/i.test(match.id) ||
            /anvelop|tire/i.test(match.text || "")
        );
        return hit ? null : `top-5=${matches.map((match) => match.id).join(", ")}`;
      }
    },
    {
      query: "protectie usor vopsea",
      validate(matches) {
        const hit = matches.some(
          (match) =>
            /paint|vopsea|protec/i.test(match.id) ||
            /paint.*protec|protec.*vopsea/i.test(match.text || "")
        );
        return hit ? null : `top-5=${matches.map((match) => match.id).join(", ")}`;
      }
    },
    {
      query: "interior textil",
      validate(matches) {
        const hit = matches.some(
          (match) =>
            /textil|interior|fabric/i.test(match.id) ||
            /textil|textile/i.test(match.text || "")
        );
        return hit ? null : `top-5=${matches.map((match) => match.id).join(", ")}`;
      }
    }
  ];

  let failed = false;
  for (const probe of probes) {
    const queryVector = await encodeQuery(embedder, probe.query);
    const matches = topMatches(queryVector, items, 5);
    const error = probe.validate(matches);
    if (error) {
      failed = true;
      console.error(`SANITY FAIL "${probe.query}": ${error}`);
    } else {
      console.log(
        `SANITY OK "${probe.query}": ${matches.map((match) => `${match.id} (${match.score.toFixed(4)})`).join(", ")}`
      );
    }
  }

  if (failed) {
    process.exitCode = 1;
    throw new Error("Cosine sanity probes failed");
  }
}

function validateIndex(indexPayload) {
  const items = indexPayload.items || [];
  const counts = indexPayload.counts || {};
  const embeddedTotal =
    (counts.knowledge || 0) +
    (counts.knowledge_flow || 0) +
    (counts.product || 0) +
    (counts.product_section || 0) +
    (counts.flow_step || 0);

  if (items.length !== embeddedTotal) {
    throw new Error(`Count mismatch: items.length=${items.length}, embeddedTotal=${embeddedTotal}`);
  }

  for (const item of items) {
    if (!Array.isArray(item.embedding) || item.embedding.length !== DIMENSION) {
      throw new Error(`Invalid embedding for ${item.id}`);
    }
  }
}

async function main() {
  const { pipeline, env } = await import("@xenova/transformers");
  const MODEL_CACHE = path.join(process.cwd(), "data", "models");
  fs.mkdirSync(MODEL_CACHE, { recursive: true });
  env.cacheDir = MODEL_CACHE;
  env.localModelPath = MODEL_CACHE;
  env.allowRemoteModels = true;
  env.backends.onnx.wasm.numThreads = 1;

  const startedAt = Date.now();
  const skipped = {
    empty: 0,
    price_zero: 0,
    tag_disagreement: 0,
    parent_dropped: 0
  };
  const logSkip = createSkipLogger(skipped);

  const artifactVersions = {
    catalog: hashFileBytes(PATHS.products),
    knowledge: hashFileBytes(PATHS.knowledge),
    knowledge_flow: hashFileBytes(PATHS.knowledgeFlow),
    productSections: hashFileBytes(PATHS.productSections),
    flows: computeFlowsArtifactHash()
  };

  const knowledgeEntries = readJson(PATHS.knowledge);
  const knowledgeFlowEntries = readJson(PATHS.knowledgeFlow);
  const products = readJson(PATHS.products);
  const productSectionsDoc = readJson(PATHS.productSections);
  const knowledgeById = indexById(knowledgeEntries);
  const knowledgeFlowById = indexById(knowledgeFlowEntries);
  const flowFiles = fs
    .readdirSync(FLOWS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(FLOWS_DIR, name));

  const items = [];
  const counts = {
    knowledge: 0,
    knowledge_flow: 0,
    product: 0,
    product_section: 0,
    flow_step: 0,
    skipped
  };
  const droppedProducts = new Set();

  buildKnowledgeItems(knowledgeEntries, items, counts, logSkip);
  buildKnowledgeFlowItems(flowFiles, knowledgeById, knowledgeFlowById, items, counts, logSkip);
  buildProductItems(products, droppedProducts, items, counts, logSkip);
  buildProductSectionItems(productSectionsDoc, droppedProducts, items, counts, logSkip);
  buildFlowStepItems(flowFiles, items, counts, logSkip);

  const modelRevision = discoverModelRevision();
  const embedder = await loadEmbedder(pipeline);
  const encodeStartedAt = Date.now();
  await encodeItems(embedder, items);
  const encodeMs = Date.now() - encodeStartedAt;

  const indexPayload = {
    schemaVersion: 1,
    model: MODEL_ID,
    modelRevision,
    dimension: DIMENSION,
    builtAt: new Date().toISOString(),
    artifactVersions,
    counts,
    items
  };

  validateIndex(indexPayload);
  const indexJson = writeIndexAtomically(indexPayload);
  const indexVersion = shortSha256(indexJson);

  await runSanityProbes(embedder, indexPayload);

  const elapsedMs = Date.now() - startedAt;
  console.log("\n=== buildEmbeddings summary ===");
  console.log(`items: ${items.length}`);
  console.log(
    `counts: knowledge=${counts.knowledge}, knowledge_flow=${counts.knowledge_flow}, product=${counts.product}, product_section=${counts.product_section}, flow_step=${counts.flow_step}`
  );
  console.log(
    `skipped: empty=${skipped.empty}, price_zero=${skipped.price_zero}, tag_disagreement=${skipped.tag_disagreement}, parent_dropped=${skipped.parent_dropped}`
  );
  console.log(`encode: ${encodeMs}ms | total: ${elapsedMs}ms`);
  console.log(`indexVersion: ${indexVersion}`);
  console.log(`artifactVersions: ${JSON.stringify(artifactVersions)}`);
  console.log(`index: ${INDEX_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  passesTagEffectUseCaseCrossCheck,
  normalizeField,
  joinFields,
  shortSha256,
  computeFlowsArtifactHash
};
