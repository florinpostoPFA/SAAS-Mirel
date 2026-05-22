#!/usr/bin/env node
/**
 * Gate B — post-retag chat probes (Step 1.5).
 * In-process handleChat with askLLM stubbed; real catalog + real flowExecutor.
 *
 * Per-probe (all required): productsLength > 0; tier-1 manufacturerId present;
 * productsReason !== no_matching_products; productsReason !== tier_one_unavailable.
 *
 * Exit 0 if no FAIL; exit 1 if any FAIL (pre-retag baseline expected ≈0/N PASS).
 */
const fs = require("fs");
const path = require("path");
const {
  loadHandleChatForGateB,
  getLastCapturedInteraction,
  loadCatalog
} = require("./postRetagProbeRuntime");

const CORPUS_PATH = path.join(__dirname, "../Tests/postRetagProbes.corpus.json");
const TIER_ONE_IDS = new Set(["13", "39", "44", "70", "92"]);

function loadCorpus() {
  return JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
}

function extractProbeOutcome(handleResult, log) {
  const products = log?.output?.products || handleResult?.products || [];
  const productsLength = Array.isArray(products) ? products.length : 0;
  const productsReason =
    log?.output?.productsReason ??
    log?.decision?.productsReason ??
    handleResult?.productsReason ??
    null;

  return {
    products,
    productsLength,
    productsReason: productsReason != null ? String(productsReason) : null,
    decision: log?.decision || {},
    traceId: log?.traceId || handleResult?.traceId || null
  };
}

function evaluateProbe(outcome) {
  const fail = [];
  const warn = [];

  if (outcome.productsLength <= 0) {
    fail.push("productsLength=0");
  }

  const hasTierOne = (outcome.products || []).some((p) =>
    TIER_ONE_IDS.has(String(p.manufacturerId))
  );
  if (!hasTierOne) {
    fail.push("no tier-1 manufacturerId in products");
  }

  const reason = outcome.productsReason;
  if (reason === "no_matching_products") {
    fail.push("productsReason=no_matching_products");
  }
  if (reason === "tier_one_unavailable") {
    fail.push("productsReason=tier_one_unavailable");
  }

  let status = "PASS";
  if (fail.length > 0) {
    status = "FAIL";
  }

  return { status, fail, warn };
}

async function runProbe(handleChat, products, probe) {
  const sessionId = `gate-b-${probe.id}-${Date.now()}`;
  let handleResult;
  try {
    handleResult = await handleChat(probe.query, "C1", products, sessionId);
  } catch (err) {
    return {
      status: "FAIL",
      fail: [`handleChat threw: ${err.message}`],
      warn: [],
      outcome: { productsLength: 0, productsReason: null, products: [] }
    };
  }

  const log = getLastCapturedInteraction();
  const outcome = extractProbeOutcome(handleResult, log);
  const evaluated = evaluateProbe(outcome);
  return { ...evaluated, outcome };
}

function formatDetails(evaluated) {
  if (evaluated.fail.length === 0) {
    return `products=${evaluated.outcome.productsLength} reason=${evaluated.outcome.productsReason ?? "null"}`;
  }
  return evaluated.fail.join("; ");
}

async function runHarness() {
  const corpus = loadCorpus();
  const products = loadCatalog();
  const handleChat = loadHandleChatForGateB();

  const summary = {
    total: 0,
    pass: 0,
    fail: 0,
    warn: 0,
    byCategory: {}
  };

  const lines = [];

  for (const probe of corpus.probes) {
    summary.total += 1;
    if (!summary.byCategory[probe.category]) {
      summary.byCategory[probe.category] = { pass: 0, fail: 0, warn: 0, total: 0 };
    }
    summary.byCategory[probe.category].total += 1;

    const result = await runProbe(handleChat, products, probe);
    summary[result.status.toLowerCase()] += 1;
    summary.byCategory[probe.category][result.status.toLowerCase()] += 1;

    const brandSuffix = probe.brand ? ` [${probe.brand}]` : "";
    lines.push(
      `[${result.status}] ${probe.id} (${probe.category})${brandSuffix} "${probe.query}" — ${formatDetails(result)}`
    );
  }

  for (const line of lines) {
    console.log(line);
  }

  console.log("");
  console.log("=== Gate B summary ===");
  console.log(`total: ${summary.total}`);
  console.log(`pass: ${summary.pass}`);
  console.log(`fail: ${summary.fail}`);
  console.log(`warn: ${summary.warn}`);
  for (const [category, counts] of Object.entries(summary.byCategory)) {
    console.log(
      `  ${category}: ${counts.pass} pass, ${counts.fail} fail, ${counts.warn} warn (${counts.total} probes)`
    );
  }

  const exitCode = summary.fail > 0 ? 1 : 0;
  return { exitCode, summary };
}

async function main() {
  const { exitCode } = await runHarness();
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  TIER_ONE_IDS,
  loadCorpus,
  evaluateProbe,
  extractProbeOutcome,
  runHarness
};
