"use strict";

const fs = require("fs");
const path = require("path");
const { getArtifactVersions } = require("./artifactVersions");
const { embedQuestion } = require("./embedding");
const { passesTagEffectUseCaseCrossCheck } = require("../scripts/buildEmbeddings");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FLOWS_DIR = path.join(ROOT, "flows");
const INDEX_PATH = path.join(DATA_DIR, "embeddings", "v1", "index.json");

const ALLOWLIST_FILES = new Set([
  "data/products.json",
  "data/knowledge.json",
  "data/knowledge_flow.json",
  "data/product_roles.json",
  "data/productSections.json",
  "data/brand-whitelist.json",
  "data/tier-one-manufacturer-ids.json",
  "data/handoff_templates.json",
  "Tests/tagVocabulary.json",
  "data/embeddings/v1/index.json"
]);

const RESOURCE_PATHS = {
  products: path.join(DATA_DIR, "products.json"),
  knowledge: path.join(DATA_DIR, "knowledge.json"),
  knowledgeFlow: path.join(DATA_DIR, "knowledge_flow.json"),
  productRoles: path.join(DATA_DIR, "product_roles.json"),
  productSections: path.join(DATA_DIR, "productSections.json"),
  brandWhitelist: path.join(DATA_DIR, "brand-whitelist.json"),
  tierOne: path.join(DATA_DIR, "tier-one-manufacturer-ids.json"),
  handoffTemplates: path.join(DATA_DIR, "handoff_templates.json"),
  tagVocabulary: path.join(ROOT, "Tests", "tagVocabulary.json")
};

const cache = {
  products: null,
  knowledge: null,
  knowledgeFlow: null,
  knowledgeById: null,
  knowledgeFlowById: null,
  productRoles: null,
  productSections: null,
  brandWhitelist: null,
  tierOne: null,
  handoffTemplates: null,
  tagVocabulary: null,
  index: null,
  indexIds: null,
  flowsById: null,
  flowPathById: null,
  productsByCode: null
};

function normalizeDiacritics(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/[î]/g, "i")
    .replace(/[ș]/g, "s")
    .replace(/[ț]/g, "t");
}

function noteFileRead(debug, relativePath) {
  if (!debug.files_read.includes(relativePath)) {
    debug.files_read.push(relativePath);
  }
}

function readJsonResource(relativePath, absolutePath, debug) {
  noteFileRead(debug, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function loadProducts(debug) {
  if (!cache.products) {
    cache.products = readJsonResource("data/products.json", RESOURCE_PATHS.products, debug);
    cache.productsByCode = new Map(
      cache.products.map((product) => [String(product.id || product.code || ""), product])
    );
  } else {
    noteFileRead(debug, "data/products.json");
  }
  return cache.products;
}

function loadKnowledge(debug) {
  if (!cache.knowledge) {
    cache.knowledge = readJsonResource("data/knowledge.json", RESOURCE_PATHS.knowledge, debug);
    cache.knowledgeById = new Map(cache.knowledge.map((entry) => [String(entry.id), entry]));
  } else {
    noteFileRead(debug, "data/knowledge.json");
  }
  return cache.knowledge;
}

function loadKnowledgeFlow(debug) {
  if (!cache.knowledgeFlow) {
    cache.knowledgeFlow = readJsonResource(
      "data/knowledge_flow.json",
      RESOURCE_PATHS.knowledgeFlow,
      debug
    );
    cache.knowledgeFlowById = new Map(cache.knowledgeFlow.map((entry) => [String(entry.id), entry]));
  } else {
    noteFileRead(debug, "data/knowledge_flow.json");
  }
  return cache.knowledgeFlow;
}

function loadProductRoles(debug) {
  if (!cache.productRoles) {
    cache.productRoles = readJsonResource("data/product_roles.json", RESOURCE_PATHS.productRoles, debug);
  } else {
    noteFileRead(debug, "data/product_roles.json");
  }
  return cache.productRoles;
}

function loadBrandWhitelist(debug) {
  if (!cache.brandWhitelist) {
    cache.brandWhitelist = readJsonResource(
      "data/brand-whitelist.json",
      RESOURCE_PATHS.brandWhitelist,
      debug
    );
  } else {
    noteFileRead(debug, "data/brand-whitelist.json");
  }
  return cache.brandWhitelist;
}

function loadTierOne(debug) {
  if (!cache.tierOne) {
    cache.tierOne = readJsonResource(
      "data/tier-one-manufacturer-ids.json",
      RESOURCE_PATHS.tierOne,
      debug
    );
  } else {
    noteFileRead(debug, "data/tier-one-manufacturer-ids.json");
  }
  return cache.tierOne;
}

function loadTagVocabulary(debug) {
  if (!cache.tagVocabulary) {
    const raw = readJsonResource("Tests/tagVocabulary.json", RESOURCE_PATHS.tagVocabulary, debug);
    const terms = new Set();
    const vocabulary = raw.vocabulary || {};
    for (const block of Object.values(vocabulary)) {
      if (!block || !Array.isArray(block.tags)) continue;
      for (const tag of block.tags) {
        if (tag?.name) terms.add(String(tag.name).toLowerCase());
      }
    }
    cache.tagVocabulary = [...terms];
  } else {
    noteFileRead(debug, "Tests/tagVocabulary.json");
  }
  return cache.tagVocabulary;
}

function loadIndex(debug) {
  if (!cache.index) {
    noteFileRead(debug, "data/embeddings/v1/index.json");
    cache.index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  } else {
    noteFileRead(debug, "data/embeddings/v1/index.json");
  }
  return cache.index;
}

function getIndexIdSet(debug) {
  loadIndex(debug);
  if (!cache.indexIds) {
    cache.indexIds = new Set(cache.index.items.map((item) => String(item.id)));
  }
  return cache.indexIds;
}

function loadFlows(debug) {
  if (!cache.flowsById) {
    cache.flowsById = {};
    cache.flowPathById = {};
    const files = fs.readdirSync(FLOWS_DIR).filter((name) => name.endsWith(".json")).sort();
    for (const fileName of files) {
      const relativePath = path.posix.join("flows", fileName);
      noteFileRead(debug, relativePath);
      const flow = JSON.parse(fs.readFileSync(path.join(FLOWS_DIR, fileName), "utf8"));
      const flowId = String(flow.flowId || path.basename(fileName, ".json"));
      cache.flowsById[flowId] = flow;
      cache.flowPathById[flowId] = relativePath;
    }
  } else {
    for (const relativePath of Object.values(cache.flowPathById)) {
      noteFileRead(debug, relativePath);
    }
  }
  return cache.flowsById;
}

function getProductByCode(code, debug) {
  loadProducts(debug);
  return cache.productsByCode.get(String(code)) || null;
}

function loadConversationWindow(_sessionId) {
  return [];
}

function extractGenericTerms(queryText) {
  return String(queryText || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((word) => word.length >= 4);
}

function countDistinctHits(textNormalized, hitTerms) {
  const hits = new Set();
  for (const term of hitTerms) {
    const normalizedTerm = normalizeDiacritics(term);
    if (normalizedTerm && textNormalized.includes(normalizedTerm)) {
      hits.add(normalizedTerm);
    }
  }
  return hits.size;
}

function runGrepRetrieval(question, window, debug) {
  const queryText = [question, ...window.map((turn) => turn.text)].join(" ").toLowerCase();
  const normalizedQuery = normalizeDiacritics(queryText);
  const vocabTerms = loadTagVocabulary(debug);
  const hitTerms = new Set(
    vocabTerms.filter((term) => normalizedQuery.includes(normalizeDiacritics(term)))
  );
  for (const word of extractGenericTerms(queryText)) {
    hitTerms.add(word);
  }
  const terms = [...hitTerms];
  const candidates = [];
  const matchedFlowIds = new Set();

  for (const entry of loadKnowledge(debug)) {
    const body = entry.content || entry.body || "";
    const searchable = normalizeDiacritics(`${entry.title || ""} ${body}`);
    const score = countDistinctHits(searchable, terms);
    if (score > 0) {
      candidates.push({
        id: `knowledge:${entry.id}`,
        type: "knowledge",
        score,
        source_field: "body"
      });
    }
  }

  for (const product of loadProducts(debug)) {
    const code = String(product.id || product.code || "");
    const searchable = normalizeDiacritics(
      [product.name, product.short_description, product.description, (product.tags || []).join(" ")]
        .filter(Boolean)
        .join(" ")
    );
    const score = countDistinctHits(searchable, terms);
    if (score > 0) {
      candidates.push({
        id: `product:${code}`,
        type: "product",
        score,
        source_field: "(detected)"
      });
    }
  }

  const flowsById = loadFlows(debug);
  for (const [flowId, flow] of Object.entries(flowsById)) {
    const flowName = flow.title || flow.name || flowId;
    const flowSearchable = normalizeDiacritics(flowName);
    if (countDistinctHits(flowSearchable, terms) > 0) {
      matchedFlowIds.add(flowId);
    }

    for (const step of flow.steps || []) {
      const stepName = step.title || step.name || step.id || "";
      const stepDescription = step.description || step.goal || step.instructions || "";
      const searchable = normalizeDiacritics(`${stepName} ${stepDescription}`);
      const score = countDistinctHits(searchable, terms);
      if (score > 0) {
        matchedFlowIds.add(flowId);
        candidates.push({
          id: `flow:${flowId}:${step.id}`,
          type: "flow_step",
          score,
          source_field: "body"
        });
      }
    }
  }

  const indexIds = getIndexIdSet(debug);
  const survivors = [];
  for (const candidate of candidates) {
    if (indexIds.has(candidate.id)) {
      survivors.push(candidate);
    } else {
      debug._notInIndexCount = (debug._notInIndexCount || 0) + 1;
    }
  }

  return { candidates: survivors, matchedFlowIds: [...matchedFlowIds] };
}

function rankDropTypeGroup(type) {
  if (type === "product") return "products";
  if (type === "knowledge" || type === "knowledge_flow") return "knowledge";
  if (type === "flow_step") return "flows";
  return "other";
}

function compactCandidatesDropped(debug) {
  const out = [];

  if (debug._notInIndexCount > 0) {
    out.push({ reason: "not_in_index", count: debug._notInIndexCount });
  }

  const rankDrops = debug._rankDrops || [];
  const floorDrops = rankDrops.filter((drop) => drop.reason === "score_below_floor");
  if (floorDrops.length > 0) {
    out.push({ reason: "rank_score_below_floor", count: floorDrops.length });
  }

  for (const group of ["products", "knowledge", "flows"]) {
    const overflow = rankDrops
      .filter((drop) => drop.reason === "rank_overflow" && rankDropTypeGroup(drop.type) === group)
      .sort((left, right) => left.rank - right.rank);
    if (overflow.length === 0) continue;
    out.push({ reason: `rank_overflow_${group}`, count: overflow.length });
    for (const item of overflow.slice(0, 5)) {
      out.push({ code: item.code, reason: "rank_overflow" });
    }
  }

  out.push(...debug.candidates_dropped);

  debug.candidates_dropped = out;
  delete debug._notInIndexCount;
  delete debug._rankDrops;
}

function cosineDot(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

async function runEmbeddingRetrieval(question, window, debug) {
  const queryText = [question, ...window.map((turn) => turn.text)].join(" ");
  const index = loadIndex(debug);
  const vec = await embedQuestion(queryText);

  return index.items
    .map((item) => ({
      id: item.id,
      type: item.type,
      score: cosineDot(vec, item.embedding),
      source_field: "vector"
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 40);
}

function candidateSourceFile(candidateId) {
  if (candidateId.startsWith("knowledge:")) {
    return "data/knowledge.json";
  }
  if (candidateId.startsWith("knowledge_flow:")) {
    return "data/knowledge_flow.json";
  }
  if (candidateId.startsWith("product:")) {
    return "data/products.json";
  }
  if (candidateId.startsWith("product_section:")) {
    return "data/productSections.json";
  }
  if (candidateId.startsWith("flow:")) {
    const flowId = candidateId.split(":")[1];
    return cache.flowPathById?.[flowId] || path.posix.join("flows", `${flowId}.json`);
  }
  return null;
}

function assertAllowlist(candidates, debug) {
  const offending = [];
  for (const candidate of candidates) {
    const sourceFile = candidateSourceFile(candidate.id);
    if (!sourceFile) {
      offending.push(candidate.id);
      continue;
    }
    if (sourceFile.startsWith("flows/")) continue;
    if (!ALLOWLIST_FILES.has(sourceFile)) {
      offending.push(sourceFile);
    }
  }

  if (offending.length > 0) {
    const err = new Error(`Denylisted source in candidate set: ${offending[0]}`);
    err.code = "DENYLIST_VIOLATION";
    err.debug = {
      offending: [...new Set(offending)],
      allowlist: [...ALLOWLIST_FILES]
    };
    throw err;
  }
}

function mergeCandidates(grepCandidates, embedCandidates, debug) {
  const maxGrep = grepCandidates.reduce((max, candidate) => Math.max(max, candidate.score || 0), 0);
  const byId = new Map();

  for (const candidate of grepCandidates) {
    const normGrep = maxGrep > 0 ? candidate.score / maxGrep : 0;
    byId.set(candidate.id, {
      ...candidate,
      grepScore: normGrep,
      embedScore: 0,
      combinedScore: normGrep,
      sources: new Set(["grep"])
    });
  }

  for (const candidate of embedCandidates) {
    const existing = byId.get(candidate.id);
    if (existing) {
      existing.embedScore = candidate.score;
      existing.combinedScore = Math.max(existing.grepScore, candidate.score) + 0.1;
      existing.sources.add("embed");
    } else {
      byId.set(candidate.id, {
        ...candidate,
        grepScore: 0,
        embedScore: candidate.score,
        combinedScore: candidate.score,
        sources: new Set(["embed"])
      });
    }
  }

  const merged = [...byId.values()]
    .map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      score: candidate.combinedScore,
      source_field: candidate.source_field,
      grepScore: candidate.grepScore,
      embedScore: candidate.embedScore,
      sources: [...candidate.sources]
    }))
    .sort((left, right) => right.score - left.score);

  console.log("[PIPELINE_STAGE_DEBUG]", { stage: "merge_2.5", count: merged.length });

  assertAllowlist(merged, debug);

  console.log("[PIPELINE_STAGE_DEBUG]", { stage: "allowlist_2.5", count: merged.length });

  return merged;
}

function detectUseCase(question) {
  const q = normalizeDiacritics(question);
  if (q.includes("textil")) return "interior_textile_cleaning";
  if (q.includes("piele") || q.includes("leather")) return "interior_leather_cleaning";
  if ((q.includes("vopsea") || q.includes("paint")) && q.includes("protec")) {
    return "exterior_paint_protection";
  }
  if (q.includes("anvelop") || q.includes("dressing")) return "tire_dressing";
  if (q.includes("sticla") || q.includes("geam")) return "glass_cleaning";
  if (q.includes("jante") || q.includes("roti")) return "wheel_cleaning";
  return null;
}

function tagsOverlap(productTags, roleTags) {
  const productSet = new Set((productTags || []).map((tag) => String(tag).toLowerCase()));
  return (roleTags || []).some((tag) => productSet.has(String(tag).toLowerCase()));
}

function rankCandidates(candidates, question, matchedFlowIds, debug) {
  console.log("[PIPELINE_STAGE_DEBUG]", { stage: "ranking_2.6_entering", count: candidates.length });

  const detectedUseCase = detectUseCase(question);
  const productRoles = loadProductRoles(debug);
  const tierOne = loadTierOne(debug);
  const tierOneIds = new Set(
    (tierOne.tierOneManufacturerIds || []).map((id) => Number(id)).filter(Number.isFinite)
  );
  const flowsById = loadFlows(debug);

  const rolesForMatchedFlows = new Set();
  for (const flowId of matchedFlowIds) {
    const flow = flowsById[flowId];
    for (const step of flow?.steps || []) {
      for (const role of step.roles || []) {
        rolesForMatchedFlows.add(String(role));
      }
    }
  }

  const ranked = candidates.map((candidate) => {
    let boost = 0;
    if (candidate.type !== "product") {
      return { ...candidate, finalScore: candidate.score };
    }

    const code = candidate.id.replace(/^product:/, "");
    const product = getProductByCode(code, debug);
    if (!product) {
      return { ...candidate, finalScore: candidate.score };
    }

    const productFlows = product.applicability?.flow || [];
    if (matchedFlowIds.some((flowId) => productFlows.includes(flowId))) {
      boost += 2.0;
    }

    for (const roleId of rolesForMatchedFlows) {
      const role = productRoles[roleId];
      if (role && tagsOverlap(product.tags, role.matchTags)) {
        boost += 1.5;
        break;
      }
    }

    const useCases = product.applicability?.use_case || product.use_case || [];
    if (
      detectedUseCase &&
      (useCases.includes(detectedUseCase) || (product.tags || []).includes(detectedUseCase))
    ) {
      boost += 1.0;
    }

    const description = `${product.short_description || ""} ${product.description || ""}`;
    if (
      product.ready_to_use === true ||
      /\b(ușor|rapid|simplu|usor)\b/i.test(description)
    ) {
      boost += 0.5;
    }

    const manufacturerId = Number(product.brand_id || product.manufacturer_id || product.manufacturerId);
    if (Number.isFinite(manufacturerId) && tierOneIds.has(manufacturerId)) {
      boost += 0.3;
    }

    return {
      ...candidate,
      finalScore: candidate.score + boost,
      _product: product
    };
  });

  ranked.sort((left, right) => right.finalScore - left.finalScore);

  console.log(
    "[PIPELINE_RANK_DEBUG]",
    ranked.slice(0, 5).map((candidate, index) => ({
      rank: index + 1,
      code: candidate.id,
      score: candidate.finalScore,
      source:
        Array.isArray(candidate.sources) &&
        candidate.sources.includes("grep") &&
        candidate.sources.includes("embed")
          ? "both"
          : Array.isArray(candidate.sources) && candidate.sources.includes("grep")
            ? "grep"
            : Array.isArray(candidate.sources) && candidate.sources.includes("embed")
              ? "embedding"
              : "unknown"
    }))
  );

  console.log("[PIPELINE_STAGE_DEBUG]", { stage: "rank_cap_entering", count: ranked.length });

  const rankDrops = [];
  const top = [];
  const perTypeCaps = [
    { types: new Set(["product"]), limit: 12 },
    { types: new Set(["knowledge", "knowledge_flow"]), limit: 5 },
    { types: new Set(["flow_step"]), limit: 3 }
  ];
  const cappedTypes = new Set([
    "product",
    "knowledge",
    "knowledge_flow",
    "flow_step"
  ]);

  for (const { types, limit } of perTypeCaps) {
    const ofType = ranked.filter((candidate) => types.has(candidate.type));
    let kept = 0;
    for (let i = 0; i < ofType.length; i += 1) {
      const candidate = ofType[i];
      const typeRank = i + 1;
      if (candidate.finalScore < 0.3) {
        rankDrops.push({
          code: candidate.id,
          type: candidate.type,
          rank: typeRank,
          reason: "score_below_floor"
        });
      } else if (kept >= limit) {
        rankDrops.push({
          code: candidate.id,
          type: candidate.type,
          rank: typeRank,
          reason: "rank_overflow"
        });
      } else {
        top.push(candidate);
        kept += 1;
      }
    }
  }

  for (const candidate of ranked) {
    if (cappedTypes.has(candidate.type)) continue;
    if (candidate.finalScore < 0.3) {
      rankDrops.push({
        code: candidate.id,
        type: candidate.type,
        rank: 0,
        reason: "score_below_floor"
      });
    } else {
      top.push(candidate);
    }
  }

  debug._rankDrops = rankDrops;

  console.log("[PIPELINE_STAGE_DEBUG]", {
    stage: "rank_cap_exiting",
    count: top.length,
    products: top.filter((candidate) => candidate.type === "product").length,
    knowledge: top.filter(
      (candidate) => candidate.type === "knowledge" || candidate.type === "knowledge_flow"
    ).length,
    flows: top.filter((candidate) => candidate.type === "flow_step").length
  });

  console.log("[PIPELINE_STAGE_DEBUG]", { stage: "ranking_2.6_exiting", count: top.length });

  return top;
}

function tokenSetFromField(value) {
  const parts = Array.isArray(value) ? value : [value];
  const tokens = new Set();
  for (const part of parts) {
    for (const token of String(part || "")
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter(Boolean)) {
      tokens.add(token);
    }
  }
  return tokens;
}

function intersectsNonEmpty(a, b) {
  for (const token of a) {
    if (b.has(token)) return true;
  }
  return false;
}

function inferBrandFromName(product, brandWhitelist, debug) {
  noteFileRead(debug, "data/brand-whitelist.json");
  const name = normalizeDiacritics(product.name || "");
  let best = null;
  for (const brand of brandWhitelist) {
    const normalizedBrand = normalizeDiacritics(brand);
    if (name.includes(normalizedBrand) && (!best || normalizedBrand.length > best.length)) {
      best = brand;
    }
  }
  return best;
}

function getKnowledgeIdsForFlowStep(candidateId) {
  const match = candidateId.match(/^knowledge_flow:([^:]+):([^:]+)$/);
  if (!match) return [];
  const [, flowId, stepId] = match;
  const flow = cache.flowsById?.[flowId];
  const step = (flow?.steps || []).find((entry) => String(entry.id) === stepId);
  return step?.knowledgeIds || [];
}

function applyDefensiveFilters(candidates, debug) {
  const enteringCount = candidates.length;
  const ruleDrops = {
    price_zero: 0,
    brand_null: 0,
    tag_disagreement: 0,
    broken_knowledge_ref: 0
  };
  const conflictsBefore = debug.conflicts_surfaced.length;

  loadKnowledge(debug);
  loadKnowledgeFlow(debug);
  loadFlows(debug);
  const brandWhitelist = loadBrandWhitelist(debug);
  const knowledgeKeys = new Set(cache.knowledgeById.keys());
  const knowledgeFlowKeys = new Set(cache.knowledgeFlowById.keys());
  const filtered = [];

  for (const candidate of candidates) {
    if (candidate.type === "product") {
      const code = candidate.id.replace(/^product:/, "");
      const product = candidate._product || getProductByCode(code, debug);
      if (!product) continue;

      if (Number(product.price) === 0) {
        debug.candidates_dropped.push({ code: candidate.id, reason: "§12: price_zero" });
        ruleDrops.price_zero += 1;
        continue;
      }

      if (product.brand == null) {
        inferBrandFromName(product, brandWhitelist, debug);
      }

      // §12 tag_disagreement: reuse buildEmbeddings.js passesTagEffectUseCaseCrossCheck so
      // runtime matches build-time §12 (PRODUCT_TYPE_TO_EFFECT / EFFECT_ALIASES semantics).
      // The old token-intersection heuristic flagged 2-of-3 "disagree" on unrelated tokens
      // and dropped every index-eligible survivor; index items already cleared this check.
      const crossCheck = passesTagEffectUseCaseCrossCheck(product);
      if (!crossCheck.ok) {
        debug.candidates_dropped.push({
          code: candidate.id,
          reason: "§12: tag_effect_use_case_disagreement"
        });
        ruleDrops.tag_disagreement += 1;
        continue;
      }

      filtered.push({ ...candidate, _product: product });
      continue;
    }

    if (candidate.type === "knowledge_flow") {
      const knowledgeIds = getKnowledgeIdsForFlowStep(candidate.id);
      let broken = false;
      for (const entryId of knowledgeIds) {
        const key = String(entryId);
        if (!knowledgeKeys.has(key) && !knowledgeFlowKeys.has(key)) {
          debug.broken_knowledge_refs.push(key);
          broken = true;
        }
      }
      if (broken) {
        debug.candidates_dropped.push({
          code: candidate.id,
          reason: "§12: broken_knowledge_ref"
        });
        ruleDrops.broken_knowledge_ref += 1;
        continue;
      }
      filtered.push(candidate);
      continue;
    }

    filtered.push(candidate);
  }

  const productsByUseCase = new Map();
  for (const candidate of filtered) {
    if (candidate.type !== "product") continue;
    const product = candidate._product || getProductByCode(candidate.id.replace(/^product:/, ""), debug);
    const useCases = product?.applicability?.use_case || product?.use_case || ["unknown"];
    for (const useCase of useCases) {
      if (!productsByUseCase.has(useCase)) productsByUseCase.set(useCase, []);
      productsByUseCase.get(useCase).push({
        code: candidate.id.replace(/^product:/, ""),
        tags: new Set((product.tags || []).map((tag) => String(tag).toLowerCase()))
      });
    }
  }

  for (const [topic, entries] of productsByUseCase.entries()) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        if (!intersectsNonEmpty(entries[i].tags, entries[j].tags)) {
          debug.conflicts_surfaced.push({
            topic,
            sources: [entries[i].code, entries[j].code],
            decision: "flagged"
          });
        }
      }
    }
  }

  console.log("[PIPELINE_STAGE_DEBUG]", {
    stage: "defensive_filters_2.7",
    entering: enteringCount,
    exiting: filtered.length,
    dropped: {
      price_zero: ruleDrops.price_zero,
      brand_null: ruleDrops.brand_null,
      tag_disagreement: ruleDrops.tag_disagreement,
      broken_knowledge_ref: ruleDrops.broken_knowledge_ref,
      conflict_flag: debug.conflicts_surfaced.length - conflictsBefore
    }
  });

  return filtered;
}

function hydrateCandidate(candidate, debug) {
  if (candidate.type === "product") {
    const product = candidate._product || getProductByCode(candidate.id.replace(/^product:/, ""), debug);
    return {
      ...candidate,
      name: product?.name || candidate.id,
      code: candidate.id.replace(/^product:/, ""),
      brand: product?.brand ?? null,
      price: product?.price ?? null,
      tags: product?.tags || [],
      applicability: product?.applicability || null,
      description: product?.description || product?.short_description || ""
    };
  }

  if (candidate.type === "knowledge") {
    loadKnowledge(debug);
    const entryId = candidate.id.replace(/^knowledge:/, "");
    const entry = cache.knowledgeById.get(entryId);
    return {
      ...candidate,
      entryId,
      title: entry?.title || entryId,
      body: entry?.content || entry?.body || ""
    };
  }

  if (candidate.type === "knowledge_flow") {
    loadKnowledgeFlow(debug);
    loadKnowledge(debug);
    const match = candidate.id.match(/^knowledge_flow:([^:]+):([^:]+)$/);
    const flowId = match?.[1] || "";
    const stepId = match?.[2] || "";
    const knowledgeIds = getKnowledgeIdsForFlowStep(candidate.id);
    const chunks = [];
    for (const kid of knowledgeIds) {
      const entry = cache.knowledgeFlowById.get(String(kid)) || cache.knowledgeById.get(String(kid));
      if (entry) {
        chunks.push(`${entry.title || kid}\n${entry.content || entry.body || ""}`.trim());
      }
    }
    return {
      ...candidate,
      entryId: candidate.id,
      title: `${flowId}:${stepId}`,
      body: chunks.join("\n\n")
    };
  }

  if (candidate.type === "flow_step") {
    loadFlows(debug);
    const match = candidate.id.match(/^flow:([^:]+):([^:]+)$/);
    const flowId = match?.[1] || "";
    const stepId = match?.[2] || "";
    const flow = cache.flowsById[flowId];
    const step = (flow?.steps || []).find((entry) => String(entry.id) === stepId);
    return {
      ...candidate,
      flowId,
      flowName: flow?.title || flow?.name || flowId,
      stepId,
      stepName: step?.title || step?.name || stepId,
      stepDescription: step?.description || step?.goal || step?.instructions || ""
    };
  }

  return candidate;
}

function composeRetrievedContext(filtered, debug) {
  const hydrated = filtered.map((candidate) => hydrateCandidate(candidate, debug));
  const products = hydrated.filter((candidate) => candidate.type === "product").slice(0, 5);
  const knowledge = hydrated
    .filter((candidate) => candidate.type === "knowledge" || candidate.type === "knowledge_flow")
    .slice(0, 5);

  const flowSteps = hydrated.filter((candidate) => candidate.type === "flow_step");
  const flowGroups = new Map();
  for (const step of flowSteps) {
    if (!flowGroups.has(step.flowId)) {
      flowGroups.set(step.flowId, {
        flowId: step.flowId,
        flowName: step.flowName,
        steps: []
      });
    }
    flowGroups.get(step.flowId).steps.push(step);
  }
  const flows = [...flowGroups.values()].slice(0, 3);

  const lines = [];

  lines.push("### Products");
  if (products.length === 0) {
    lines.push("(none)");
  } else {
    for (const product of products) {
      lines.push(`**${product.name}** (${product.code})`);
      lines.push(`Brand: ${product.brand || "—"}`);
      lines.push(`Price: ${product.price != null ? product.price : "—"} RON`);
      lines.push(`Tags: ${(product.tags || []).join(", ")}`);
      lines.push(`Applicability: ${JSON.stringify(product.applicability || {})}`);
      lines.push(product.description || "");
      lines.push("---");
    }
  }

  lines.push("");
  lines.push("### Knowledge");
  if (knowledge.length === 0) {
    lines.push("(none)");
  } else {
    for (const entry of knowledge) {
      lines.push(`**${entry.entryId}** — ${entry.title}`);
      lines.push(entry.body || "");
      lines.push("---");
    }
  }

  lines.push("");
  lines.push("### Flows");
  if (flows.length === 0) {
    lines.push("(none)");
  } else {
    for (const flow of flows) {
      lines.push(`**${flow.flowId}** — ${flow.flowName}`);
      lines.push("Steps:");
      for (const step of flow.steps) {
        lines.push(`- ${step.stepId}: ${step.stepName} — ${step.stepDescription}`);
      }
      lines.push("---");
    }
  }

  console.log("[PIPELINE_STAGE_DEBUG]", {
    stage: "context_composition_2.8",
    products: products.length,
    knowledge: knowledge.length,
    flows: flows.length,
    total: products.length + knowledge.length + flows.length
  });

  const consultedSources = {
    products: products.map((product) => product.code),
    knowledge: knowledge.map((entry) => entry.entryId),
    flows: flows.map((flow) => flow.flowId)
  };

  return { contextBlock: lines.join("\n"), consultedSources };
}

function parseMarkdownTables(text) {
  const tables = [];
  const regex = /(?:^|\n)(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split("\n").filter(Boolean);
    if (lines.length < 2) continue;
    const columns = lines[0]
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    const rows = lines.slice(2).map((line) =>
      line
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
    );
    tables.push({ title: null, columns, rows });
  }
  return tables;
}

function parseAnthropicOutput(text, consultedSources) {
  const answer = String(text || "");
  const parsed = {
    answer,
    tables: parseMarkdownTables(answer),
    buckets: [],
    clarifying_question: null,
    // §14 sources record what the pipeline placed in context, not model citations.
    sources: {
      products: [...(consultedSources?.products || [])],
      knowledge: [...(consultedSources?.knowledge || [])],
      flows: [...(consultedSources?.flows || [])]
    }
  };

  const blocks = answer.split(/\n\n/);
  const lastBlock = blocks[blocks.length - 1] || "";
  if (/^[^?]*\?\s*$/m.test(lastBlock.trim())) {
    parsed.clarifying_question = lastBlock.trim();
  }

  return parsed;
}

async function runPipeline({ question, sessionId, systemPrompt, anthropic, model }) {
  const debug = {
    files_read: [],
    artifact_versions: getArtifactVersions(),
    candidates_dropped: [],
    broken_knowledge_refs: [],
    conflicts_surfaced: []
  };

  loadFlows(debug);

  const window = loadConversationWindow(sessionId);
  const grepResult = runGrepRetrieval(question, window, debug);
  console.log("[PIPELINE_STAGE_DEBUG]", { stage: "grep_2.3", count: grepResult.candidates.length });

  const embedCandidates = await runEmbeddingRetrieval(question, window, debug);
  console.log("[PIPELINE_STAGE_DEBUG]", { stage: "embedding_2.4", count: embedCandidates.length });

  const merged = mergeCandidates(grepResult.candidates, embedCandidates, debug);
  const ranked = rankCandidates(merged, question, grepResult.matchedFlowIds, debug);
  const filtered = applyDefensiveFilters(ranked, debug);
  const { contextBlock, consultedSources } = composeRetrievedContext(filtered, debug);

  const preAnthropicProducts = consultedSources.products.length;
  const preAnthropicKnowledge = consultedSources.knowledge.length;
  const preAnthropicFlows = consultedSources.flows.length;
  console.log("[PIPELINE_STAGE_DEBUG]", {
    stage: "pre_anthropic_context",
    products: preAnthropicProducts,
    knowledge: preAnthropicKnowledge,
    flows: preAnthropicFlows
  });

  const windowBlock =
    window.length === 0
      ? "### Conversation window\n(none)"
      : `### Conversation window\n${window.map((turn) => `- ${turn.role}: ${turn.text}`).join("\n")}`;

  const userMessage = `${windowBlock}\n\n${contextBlock}\n\n### Customer question\n${question}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }]
  });

  const firstBlock = response.content?.[0];
  const outputText = firstBlock && firstBlock.type === "text" ? firstBlock.text : "";
  const parsed = parseAnthropicOutput(outputText, consultedSources);

  console.log("[PIPELINE_STAGE_DEBUG]", {
    stage: "parse_2.11_sources",
    products: parsed.sources.products.length,
    knowledge: parsed.sources.knowledge.length,
    flows: parsed.sources.flows.length
  });

  compactCandidatesDropped(debug);

  return {
    answer: parsed.answer,
    tables: parsed.tables,
    buckets: parsed.buckets,
    clarifying_question: parsed.clarifying_question,
    sources: parsed.sources,
    debug
  };
}

module.exports = {
  runPipeline,
  normalizeDiacritics,
  detectUseCase,
  mergeCandidates,
  assertAllowlist
};
