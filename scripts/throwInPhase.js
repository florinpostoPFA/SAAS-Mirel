#!/usr/bin/env node
"use strict";

const { appendInteractionLine } = require("../services/interactionLog");
const { buildPageProperties } = require("./ingestDailyLogsToNotion");

const PHASES = ["intent", "slots", "routing", "retrieval", "assistant_reply", "unknown"];

function buildSyntheticErrorRow(phase, idx) {
  return {
    timestamp: new Date().toISOString(),
    traceId: `phase-trace-${idx + 1}`,
    sessionId: `phase-session-${idx + 1}`,
    level: "ERROR",
    phase,
    service: "chatService",
    env: process.env.NODE_ENV === "production" ? "prod" : "dev",
    message: `synthetic throw in ${phase}`,
    assistantReply: "A apărut o eroare.",
    decision: {
      action: "error",
      flowId: null,
      missingSlot: null
    },
    output: {
      type: "error",
      products: [],
      productsLength: 0
    },
    error: {
      name: "SyntheticPhaseError",
      message: `synthetic throw in ${phase}`
    }
  };
}

function main() {
  const snippet = [];
  PHASES.forEach((phase, idx) => {
    const row = buildSyntheticErrorRow(phase, idx);
    appendInteractionLine(row);
    const notionProps = buildPageProperties({
      row,
      date: new Date().toISOString().slice(0, 10),
      eventId: `event-${idx + 1}`,
      ingestedAtIso: new Date().toISOString()
    });
    snippet.push({
      phase,
      level: notionProps?.Level?.select?.name || null,
      traceId: row.traceId
    });
  });

  console.log(JSON.stringify({ ok: true, rows: snippet }, null, 2));
}

if (require.main === module) {
  main();
}
