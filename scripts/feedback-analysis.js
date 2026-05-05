#!/usr/bin/env node
const path = require("path");
const { parseJsonlFile } = require("./uploadLogsToNotion");
const { sanitizePreview } = require("../utils/logSanitizer");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--date") out.date = argv[i + 1];
    if (argv[i] === "--feedback-file") out.feedbackFile = argv[i + 1];
    if (argv[i] === "--interactions-file") out.interactionsFile = argv[i + 1];
  }
  return out;
}

function analyzeFeedbackLinking(interactions, feedbackRows) {
  const interactionByTraceId = new Map();
  for (const row of interactions) {
    if (!row?.traceId) continue;
    if (!interactionByTraceId.has(row.traceId)) {
      interactionByTraceId.set(row.traceId, row);
    }
  }

  const byRating = {};
  let linked = 0;
  const downJoined = [];

  for (const feedback of feedbackRows) {
    const rating = String(feedback?.rating || "unknown");
    byRating[rating] = (byRating[rating] || 0) + 1;
    const traceId = feedback?.traceId;
    const interaction = traceId ? interactionByTraceId.get(traceId) : null;
    if (interaction) linked += 1;

    if (rating === "down") {
      downJoined.push({
        traceId: traceId || null,
        linked: Boolean(interaction),
        messagePreview: sanitizePreview(interaction?.normalizedMessage || interaction?.message || "", 120),
        decisionAction: interaction?.decision?.action || null,
        missingSlot: interaction?.decision?.missingSlot || null,
        productsLength: Number(interaction?.output?.productsLength || 0)
      });
    }
  }

  const totalFeedback = feedbackRows.length;
  const linkedPct = totalFeedback > 0 ? Number(((linked / totalFeedback) * 100).toFixed(1)) : 0;
  return {
    totalFeedback,
    linked,
    linkedPct,
    byRating,
    topDownTraces: downJoined.slice(0, 5)
  };
}

function reportLines(summary) {
  return [
    `total_feedback=${summary.totalFeedback}`,
    `linked=${summary.linked}`,
    `linked_pct=${summary.linkedPct}`,
    `by_rating=${JSON.stringify(summary.byRating)}`,
    `top_down=${JSON.stringify(summary.topDownTraces)}`
  ];
}

function runAnalysis(options = {}) {
  const logDir = options.logDir || path.join(__dirname, "..", "logs");
  const date = options.date || new Date().toISOString().slice(0, 10);
  const interactionsFile = options.interactionsFile || path.join(logDir, `${date}.jsonl`);
  const feedbackFile = options.feedbackFile || path.join(logDir, "feedback.jsonl");
  const interactions = parseJsonlFile(interactionsFile);
  const feedback = parseJsonlFile(feedbackFile);
  return analyzeFeedbackLinking(interactions, feedback);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = runAnalysis(args);
  reportLines(summary).forEach((line) => console.log(line));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  analyzeFeedbackLinking,
  reportLines,
  runAnalysis
};
