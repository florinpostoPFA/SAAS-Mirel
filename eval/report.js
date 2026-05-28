#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { listArchitectures } = require("../architectures");

const clarificationRate = require("./metrics/clarificationRate");
const fnRescueRate = require("./metrics/fnRescueRate");
const frictionChainLength = require("./metrics/frictionChainLength");
const tier1HitRate = require("./metrics/tier1HitRate");
const decisionStabilityIndex = require("./metrics/decisionStabilityIndex");

const RESULTS_ROOT = path.join(__dirname, "results", "v0");
const REPORTS_ROOT = path.join(__dirname, "reports", "v0");
const CORPUS_DIR = path.join(__dirname, "corpus", "v0");

function listTimestampDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function findLatestResultsTimestamp() {
  const dirs = listTimestampDirs(RESULTS_ROOT);
  if (!dirs.length) {
    throw new Error(`No replay result directories found in ${RESULTS_ROOT}`);
  }
  return dirs[dirs.length - 1];
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line));
}

function loadResults(resultsDir) {
  const rowsByArchitecture = {};
  if (!fs.existsSync(resultsDir)) return rowsByArchitecture;
  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  files.forEach((filename) => {
    const arch = filename.replace(/\.jsonl$/, "");
    rowsByArchitecture[arch] = readJsonl(path.join(resultsDir, filename));
  });
  return rowsByArchitecture;
}

function loadCorpus() {
  const turnsByFile = {};
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  files.forEach((filename) => {
    turnsByFile[filename] = readJsonl(path.join(CORPUS_DIR, filename));
  });
  return {
    turnsByFile,
    turnCountByFile: Object.fromEntries(
      Object.entries(turnsByFile).map(([name, turns]) => [name, turns.length])
    ),
    totalTurns: Object.values(turnsByFile).reduce((acc, turns) => acc + turns.length, 0)
  };
}

function formatMetricValue(value) {
  if (value === "N/A") return "N/A - stub";
  return String(value);
}

function buildMarkdown({
  timestamp,
  architectures,
  skippedArchitectures,
  corpus,
  totalReplayWallclockMs,
  reportWallclockMs,
  metrics
}) {
  const header = [
    "# Eval Harness v0 Report",
    "",
    `- Timestamp: ${timestamp}`,
    `- Corpus turn counts: ${JSON.stringify(corpus.turnCountByFile)}`,
    `- Total corpus turns: ${corpus.totalTurns}`,
    `- Total replay wall-clock (sum): ${totalReplayWallclockMs} ms`,
    `- Report generation wall-clock: ${reportWallclockMs} ms`,
    `- Skipped architectures: ${
      skippedArchitectures.length ? skippedArchitectures.map((a) => `${a} (N/A - stub)`).join(", ") : "none"
    }`,
    "",
    "## Metrics",
    ""
  ];

  const tableHeader = `| Metric | ${architectures.join(" | ")} |`;
  const tableSep = `| --- | ${architectures.map(() => "---").join(" | ")} |`;
  const rows = metrics.map((m) => {
    const values = architectures.map((arch) => formatMetricValue(m.perArchitecture[arch]));
    return `| ${m.label} | ${values.join(" | ")} |`;
  });

  return [...header, tableHeader, tableSep, ...rows, ""].join("\n");
}

function buildReportJson({
  timestamp,
  architectures,
  skippedArchitectures,
  corpus,
  totalReplayWallclockMs,
  reportWallclockMs,
  metrics
}) {
  return {
    timestamp,
    architectures,
    skippedArchitectures,
    corpus: {
      turnCountByFile: corpus.turnCountByFile,
      totalTurns: corpus.totalTurns
    },
    totalReplayWallclockMs,
    reportWallclockMs,
    metrics: Object.fromEntries(
      metrics.map((m) => [
        m.key,
        {
          perArchitecture: m.perArchitecture,
          perTurn: m.perTurn || []
        }
      ])
    )
  };
}

async function main() {
  const reportStarted = Date.now();
  const timestamp = process.argv[2] || findLatestResultsTimestamp();
  const resultsDir = path.join(RESULTS_ROOT, timestamp);
  const reportDir = path.join(REPORTS_ROOT, timestamp);
  const allArchitectures = listArchitectures();

  const resultsByArchitecture = loadResults(resultsDir);
  const corpus = loadCorpus();

  allArchitectures.forEach((arch) => {
    if (!resultsByArchitecture[arch]) {
      resultsByArchitecture[arch] = [];
    }
  });

  const skippedArchitectures = allArchitectures.filter(
    (arch) => !resultsByArchitecture[arch] || resultsByArchitecture[arch].length === 0
  );

  const metrics = [
    { key: "clarificationRate", label: "Clarification rate (%)", ...clarificationRate.compute(resultsByArchitecture, corpus) },
    { key: "fnRescueRate", label: "FN rescue rate (%)", ...fnRescueRate.compute(resultsByArchitecture, corpus) },
    { key: "frictionChainLength", label: "Friction-chain length (turns)", ...frictionChainLength.compute(resultsByArchitecture, corpus) },
    { key: "tier1HitRate", label: "Tier-1 hit rate (%)", ...tier1HitRate.compute(resultsByArchitecture, corpus) },
    { key: "decisionStabilityIndex", label: "Decision-stability index (%)", ...decisionStabilityIndex.compute(resultsByArchitecture, corpus) }
  ];

  const totalReplayWallclockMs = Object.values(resultsByArchitecture).reduce(
    (acc, rows) =>
      acc +
      rows.reduce((sum, row) => sum + (Number.isFinite(row.wallclockMs) ? row.wallclockMs : 0), 0),
    0
  );
  const reportWallclockMs = Date.now() - reportStarted;

  fs.mkdirSync(reportDir, { recursive: true });

  const reportJson = buildReportJson({
    timestamp,
    architectures: allArchitectures,
    skippedArchitectures,
    corpus,
    totalReplayWallclockMs,
    reportWallclockMs,
    metrics
  });
  const reportMd = buildMarkdown({
    timestamp,
    architectures: allArchitectures,
    skippedArchitectures,
    corpus,
    totalReplayWallclockMs,
    reportWallclockMs,
    metrics
  });

  fs.writeFileSync(path.join(reportDir, "report.json"), JSON.stringify(reportJson, null, 2), "utf8");
  fs.writeFileSync(path.join(reportDir, "report.md"), reportMd, "utf8");

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        timestamp,
        resultsDir,
        reportDir,
        totalReplayWallclockMs,
        reportWallclockMs
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
