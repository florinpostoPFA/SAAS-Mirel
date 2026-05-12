#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Offline operational blueprint generator (CTO demo).
 * Reads demo/demo-topics.json + data/*.json + flows/*.json only.
 * No network, no LLM.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEMO_TOPICS = path.join(ROOT, "demo", "demo-topics.json");
const KNOWLEDGE_PATH = path.join(ROOT, "data", "knowledge.json");
const KNOWLEDGE_FLOW_PATH = path.join(ROOT, "data", "knowledge_flow.json");
const PRODUCTS_PATH = path.join(ROOT, "data", "products.json");
const FLOWS_DIR = path.join(ROOT, "flows");
const OUT_DIR = path.join(ROOT, "out");

const TOPIC_IDS = [
  "matte_paint_summer_maintenance",
  "ceramic_coating_maintenance_wash",
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function indexById(arr, idKey = "id") {
  const map = new Map();
  for (const item of arr || []) {
    const id = item && item[idKey];
    if (id != null) map.set(String(id), item);
  }
  return map;
}

function uniqSorted(ids) {
  return [...new Set((ids || []).map(String).filter(Boolean))].sort();
}

function uniqPreserveOrder(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    const s = String(id);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function findFlowById(flowId) {
  const files = fs.readdirSync(FLOWS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files.sort()) {
    const full = path.join(FLOWS_DIR, file);
    const j = readJson(full);
    if (String(j.flowId || "") === String(flowId)) {
      return { file, flow: j };
    }
  }
  return null;
}

function validateRefs({
  topicId,
  knowledgeIds,
  knowledgeFlowIds,
  knowledgeMap,
  knowledgeFlowMap,
}) {
  const missingK = [];
  const missingF = [];
  for (const id of knowledgeIds) {
    if (!knowledgeMap.has(String(id))) missingK.push(id);
  }
  for (const id of knowledgeFlowIds) {
    if (!knowledgeFlowMap.has(String(id))) missingF.push(id);
  }
  if (missingK.length || missingF.length) {
    const parts = [];
    if (missingK.length) {
      parts.push(`missing knowledge.json ids: ${missingK.join(", ")}`);
    }
    if (missingF.length) {
      parts.push(`missing knowledge_flow.json ids: ${missingF.join(", ")}`);
    }
    throw new Error(`Topic "${topicId}": ${parts.join(" | ")}`);
  }
}

/** Flow JSON step.knowledgeIds are resolved via knowledge_flow.json (see services/flowExecutor.js getKnowledgeEntryById). */
function validateFlowStepKnowledgeIds(topicId, ids, knowledgeFlowMap) {
  const missing = [];
  for (const id of ids) {
    if (!knowledgeFlowMap.has(String(id))) missing.push(id);
  }
  if (missing.length) {
    throw new Error(
      `Topic "${topicId}": flow step knowledge ids missing from knowledge_flow.json: ${missing.join(", ")}`
    );
  }
}

function resolveKnowledgeNodes(ids, source, map) {
  return uniqPreserveOrder(ids).map((id) => {
    const node = map.get(id);
    return {
      source,
      id,
      title: node?.title != null ? String(node.title) : "",
      content: node?.content != null ? String(node.content) : "",
    };
  });
}

function buildWorkflowFromTopic(topic, topicId, knowledgeMap, knowledgeFlowMap) {
  const steps = [];
  if (topic.baseFlowId) {
    const found = findFlowById(topic.baseFlowId);
    if (!found) {
      throw new Error(`Topic "${topicId}": baseFlowId "${topic.baseFlowId}" — no flows/*.json with matching flowId`);
    }
    const baseSteps = Array.isArray(found.flow.steps) ? found.flow.steps : [];
    const overrides = topic.overrides && topic.overrides.workflow ? topic.overrides.workflow : [];
    const byStepId = new Map(overrides.map((o) => [String(o.stepId || ""), o]));

    for (const step of baseSteps) {
      const sid = String(step.id || "");
      const ov = byStepId.get(sid);
      const baseFlowKnowledgeIds = uniqPreserveOrder(step.knowledgeIds || []);
      validateFlowStepKnowledgeIds(topicId, baseFlowKnowledgeIds, knowledgeFlowMap);

      const extraKnowledgeIds = uniqPreserveOrder((ov && ov.knowledgeIds) || []);
      const extraFlowIds = uniqPreserveOrder((ov && ov.knowledgeFlowIds) || []);
      validateRefs({
        topicId,
        knowledgeIds: extraKnowledgeIds,
        knowledgeFlowIds: extraFlowIds,
        knowledgeMap,
        knowledgeFlowMap,
      });

      const knowledgeResolved = [
        ...resolveKnowledgeNodes(baseFlowKnowledgeIds, "knowledge_flow", knowledgeFlowMap),
        ...resolveKnowledgeNodes(extraFlowIds, "knowledge_flow", knowledgeFlowMap),
        ...resolveKnowledgeNodes(extraKnowledgeIds, "knowledge", knowledgeMap),
      ];

      steps.push({
        stepId: sid || null,
        title: String(step.title || ""),
        goal: String(step.goal || ""),
        roles: Array.isArray(step.roles)
          ? [...step.roles]
          : Array.isArray(step.productRoles)
            ? [...step.productRoles]
            : [],
        knowledgeResolved,
      });
    }
  } else if (Array.isArray(topic.workflow)) {
    for (const w of topic.workflow) {
      const kid = uniqPreserveOrder(w.knowledgeIds || []);
      const kfid = uniqPreserveOrder(w.knowledgeFlowIds || []);
      validateRefs({
        topicId,
        knowledgeIds: kid,
        knowledgeFlowIds: kfid,
        knowledgeMap,
        knowledgeFlowMap,
      });
      steps.push({
        stepId: null,
        title: String(w.title || ""),
        goal: "",
        roles: [],
        knowledgeResolved: [
          ...resolveKnowledgeNodes(kfid, "knowledge_flow", knowledgeFlowMap),
          ...resolveKnowledgeNodes(kid, "knowledge", knowledgeMap),
        ],
      });
    }
  } else {
    throw new Error(`Topic "${topicId}": must define "workflow" or "baseFlowId"`);
  }
  return steps;
}

function buildBlueprint(topicId, topic, opts, ctx) {
  const { knowledgeMap, knowledgeFlowMap, products, resolveProducts } = ctx;

  const warningsIds = uniqSorted(topic.warningsKnowledgeIds || []);
  const mistakesIds = uniqSorted(topic.mistakesKnowledgeIds || []);
  const faqIds = uniqSorted(topic.faqKnowledgeIds || []);
  validateRefs({
    topicId,
    knowledgeIds: [...warningsIds, ...mistakesIds, ...faqIds],
    knowledgeFlowIds: [],
    knowledgeMap,
    knowledgeFlowMap,
  });

  const workflow = buildWorkflowFromTopic(topic, topicId, knowledgeMap, knowledgeFlowMap);

  const productRoles = uniqSorted(topic.productRoles || []);

  const blueprint = {
    topicId,
    title: String(topic.title || topicId),
    whyThisMatters: String(topic.whyThisMatters || ""),
    workflow,
    warnings: resolveKnowledgeNodes(warningsIds, "knowledge", knowledgeMap),
    mistakes: resolveKnowledgeNodes(mistakesIds, "knowledge", knowledgeMap),
    faq: resolveKnowledgeNodes(faqIds, "knowledge", knowledgeMap),
    maintenanceIntervalText: String(topic.maintenanceIntervalText || ""),
    productRoles,
    bundleSuggestions: Array.isArray(topic.bundleSuggestions)
      ? topic.bundleSuggestions.map(String)
      : [],
  };

  if (topic.baseFlowId) {
    blueprint.baseFlowId = String(topic.baseFlowId);
  }

  if (resolveProducts) {
    const { resolveProductsForRole } = require("../services/flowExecutor");
    const productsOut = [];
    for (const role of productRoles) {
      const matched = resolveProductsForRole(role, products);
      if (!matched.length) {
        productsOut.push({
          role,
          products: [],
          productsReason: "no_matching_products",
        });
      } else {
        productsOut.push({
          role,
          products: matched.map((p) => ({
            id: p.id,
            name: p.name,
            tags: Array.isArray(p.tags) ? [...p.tags] : [],
          })),
        });
      }
    }
    blueprint.products = productsOut;
  }

  return blueprint;
}

function blueprintToMarkdown(bp) {
  const lines = [];
  lines.push(`# ${bp.title}`);
  lines.push("");
  lines.push(`**Topic ID:** \`${bp.topicId}\``);
  if (bp.baseFlowId) {
    lines.push(`**Base flow:** \`${bp.baseFlowId}\``);
  }
  lines.push("");
  lines.push("## Why this matters");
  lines.push("");
  lines.push(bp.whyThisMatters || "—");
  lines.push("");
  lines.push("## Workflow");
  lines.push("");
  (bp.workflow || []).forEach((step, i) => {
    lines.push(`### ${i + 1}. ${step.title}`);
    if (step.goal) {
      lines.push("");
      lines.push(step.goal);
    }
    if (step.roles && step.roles.length) {
      lines.push("");
      lines.push(`**Roles:** ${step.roles.join(", ")}`);
    }
    lines.push("");
    for (const kn of step.knowledgeResolved || []) {
      lines.push(`#### (${kn.source}) ${kn.title}`);
      lines.push("");
      lines.push(kn.content);
      lines.push("");
    }
  });
  lines.push("## Warnings");
  lines.push("");
  for (const w of bp.warnings || []) {
    lines.push(`- **${w.title}**  `);
    lines.push(`  ${w.content.replace(/\n/g, " ")}`);
  }
  lines.push("");
  lines.push("## Common mistakes");
  lines.push("");
  for (const m of bp.mistakes || []) {
    lines.push(`- **${m.title}**  `);
    lines.push(`  ${m.content.replace(/\n/g, " ")}`);
  }
  lines.push("");
  lines.push("## FAQ");
  lines.push("");
  for (const f of bp.faq || []) {
    lines.push(`- **${f.title}**  `);
    lines.push(`  ${f.content.replace(/\n/g, " ")}`);
  }
  lines.push("");
  lines.push("## Maintenance interval");
  lines.push("");
  lines.push(bp.maintenanceIntervalText || "—");
  lines.push("");
  lines.push("## Product roles (canonical)");
  lines.push("");
  lines.push((bp.productRoles || []).map((r) => `- \`${r}\``).join("\n") || "—");
  lines.push("");
  if (bp.products) {
    lines.push("## Resolved products (opt-in)");
    lines.push("");
    for (const block of bp.products) {
      lines.push(`### Role: \`${block.role}\``);
      if (block.productsReason) {
        lines.push(`_${block.productsReason}_`);
      }
      for (const p of block.products || []) {
        lines.push(`- **${p.name}** (\`${p.id}\`) — tags: ${(p.tags || []).join(", ")}`);
      }
      lines.push("");
    }
  }
  lines.push("## Bundle suggestions");
  lines.push("");
  for (const b of bp.bundleSuggestions || []) {
    lines.push(`- ${b}`);
  }
  lines.push("");
  return lines.join("\n");
}

function parseArgs(argv) {
  const out = { topic: null, all: false, resolveProducts: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--resolveProducts") out.resolveProducts = true;
    else if (a === "--topic" && argv[i + 1]) {
      out.topic = argv[++i];
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.all && !opts.topic) {
    console.error("Usage: node scripts/op-demo.js --topic <topicId> [--resolveProducts]");
    console.error("   or: node scripts/op-demo.js --all [--resolveProducts]");
    process.exit(1);
  }

  const topicsConfig = readJson(DEMO_TOPICS);
  const knowledge = readJson(KNOWLEDGE_PATH);
  const knowledgeFlow = readJson(KNOWLEDGE_FLOW_PATH);
  const knowledgeMap = indexById(knowledge);
  const knowledgeFlowMap = indexById(knowledgeFlow);

  let products = [];
  if (opts.resolveProducts) {
    products = readJson(PRODUCTS_PATH);
    if (!Array.isArray(products)) {
      throw new Error("products.json must be a JSON array");
    }
  }

  const ctx = {
    knowledgeMap,
    knowledgeFlowMap,
    products,
    resolveProducts: opts.resolveProducts,
  };

  const topicIds = opts.all ? [...TOPIC_IDS] : [opts.topic];
  for (const topicId of topicIds) {
    if (!TOPIC_IDS.includes(topicId)) {
      throw new Error(`Unknown topic "${topicId}". Expected one of: ${TOPIC_IDS.join(", ")}`);
    }
    const topic = topicsConfig[topicId];
    if (!topic || typeof topic !== "object") {
      throw new Error(`demo-topics.json missing key "${topicId}"`);
    }

    const blueprint = buildBlueprint(topicId, topic, opts, ctx);

    if (!fs.existsSync(OUT_DIR)) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
    }
    const jsonPath = path.join(OUT_DIR, `${topicId}.json`);
    const mdPath = path.join(OUT_DIR, `${topicId}.md`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
    fs.writeFileSync(mdPath, blueprintToMarkdown(blueprint), "utf8");
    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);
  }
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
