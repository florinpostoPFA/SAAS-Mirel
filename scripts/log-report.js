#!/usr/bin/env node
/**
 * Daily JSONL log report (Epic 1.2 + 1.3).
 * Usage: node scripts/log-report.js [YYYY-MM-DD]
 * Default: today's date (UTC). Uses only Node fs.
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.INTERACTION_LOG_DIR
  ? path.resolve(process.env.INTERACTION_LOG_DIR)
  : path.join(__dirname, "..", "logs");

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      /* skip bad lines */
    }
  }
  return rows;
}

function topCounts(map, n) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function main() {
  const day = process.argv[2] || new Date().toISOString().slice(0, 10);
  const filePath = path.join(LOG_DIR, `${day}.jsonl`);
  const rows = parseJsonl(filePath);

  console.log(`Log report — ${day}`);
  console.log(`File: ${filePath}`);
  if (rows == null) {
    console.log("File not found.");
    process.exit(1);
  }
  if (rows.length === 0) {
    console.log("No rows.");
    process.exit(0);
  }

  const total = rows.length;
  const withAnalysis = rows.filter((r) => r && r.analysis && typeof r.analysis === "object");
  const m = withAnalysis.length;
  const denom = m > 0 ? m : total;

  let noProducts = 0;
  let clarificationLoops = 0;
  const failureTypeCounts = {};
  const failureMessages = {};
  const noProductMessages = {};
  const sessionTurns = {};

  for (const r of rows) {
    const sid = r.sessionId != null ? String(r.sessionId) : "unknown";
    sessionTurns[sid] = (sessionTurns[sid] || 0) + 1;

    const a = r.analysis;
    if (!a || typeof a !== "object") continue;

    if (a.failureType === "no_products") noProducts += 1;
    if (a.failureType === "clarification_loop") clarificationLoops += 1;

    if (a.failureType) {
      failureTypeCounts[a.failureType] = (failureTypeCounts[a.failureType] || 0) + 1;
      const msg = String(r.normalizedMessage || r.message || "").trim() || "(empty)";
      failureMessages[msg] = (failureMessages[msg] || 0) + 1;
      if (a.failureType === "no_products") {
        noProductMessages[msg] = (noProductMessages[msg] || 0) + 1;
      }
    }
  }

  const flowRows = withAnalysis.filter((r) => r.decision && r.decision.action === "flow");
  const flowOk = flowRows.filter((r) => r.analysis && r.analysis.conversionSuccess === true);
  const successfulFlowPct =
    flowRows.length > 0 ? (100 * flowOk.length) / flowRows.length : 0;

  const pct = (c) => (denom > 0 ? ((100 * c) / denom).toFixed(1) : "0.0");

  console.log("");
  console.log("— Epic 1.2 —");
  console.log(`Total rows:        ${total}`);
  console.log(`Rows with analysis: ${m}`);
  console.log(`% no_products:     ${pct(noProducts)}% (of rows with analysis)`);
  console.log(`% clarification_loop: ${pct(clarificationLoops)}% (of rows with analysis)`);
  console.log(
    `% successful flows: ${successfulFlowPct.toFixed(1)}% (${flowOk.length}/${flowRows.length} flow rows with conversionSuccess)`
  );

  console.log("");
  console.log("Top 10 repeated failure messages (any failureType):");
  topCounts(failureMessages, 10).forEach(([msg, c], i) => {
    console.log(`  ${i + 1}. (${c}) ${msg.length > 120 ? `${msg.slice(0, 117)}...` : msg}`);
  });

  console.log("");
  console.log("— Epic 1.3 —");
  console.log("Top 5 failureType counts:");
  topCounts(failureTypeCounts, 5).forEach(([k, c], i) => {
    console.log(`  ${i + 1}. ${k}: ${c}`);
  });

  console.log("");
  console.log("Top 5 messages (no_products):");
  topCounts(noProductMessages, 5).forEach(([msg, c], i) => {
    console.log(`  ${i + 1}. (${c}) ${msg.length > 120 ? `${msg.slice(0, 117)}...` : msg}`);
  });

  const sessionIds = Object.keys(sessionTurns);
  const turnCounts = sessionIds.map((id) => sessionTurns[id]);
  const avgTurns =
    sessionIds.length > 0 ? turnCounts.reduce((s, n) => s + n, 0) / sessionIds.length : 0;
  console.log("");
  console.log(`Average turns per session: ${avgTurns.toFixed(2)} (${sessionIds.length} sessions)`);
}

main();
