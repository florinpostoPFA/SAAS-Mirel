#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { runConvo } = require("./_phaseA_harness");

const ROOT = path.join(__dirname, "..");
const MESSAGES = [
  "interior scaune textile",
  "cat costa abonamentul",
  "bună ziua",
  "vreau sa cumpar o solutie pentru anvelope"
];

async function main() {
  const outPath = process.argv[2] || path.join(ROOT, "Tests", "_f7_baseline_results.json");
  const { perTurn } = await runConvo(MESSAGES, {
    runLabel: "F7",
    sessionId: `f7-${Date.now()}`,
    captureTraces: false
  });

  const turns = perTurn.map((t, i) => ({
    turn: i + 1,
    message: t.message,
    pendingQuestion: t.pendingQuestion,
    pendingSlot: t.pendingQuestion?.slot ?? null,
    turnsSinceArmed: t.pendingQuestion?.turnsSinceArmed ?? null,
    decision: t.decisionTrace
      ? {
          action: t.decisionTrace.action,
          missingSlot: t.decisionTrace.missingSlot,
          reasonCode: t.decisionTrace.reasonCode
        }
      : null,
    sessionSlots: t.sessionSlots
  }));

  const pendingSurvivedAll =
    turns[1].pendingSlot != null &&
    turns[2].pendingSlot != null &&
    turns[3].pendingSlot != null;

  const result = {
    messages: MESSAGES,
    turns,
    pendingSurvivedAll,
    t1ArmedIntentLevel: turns[0].pendingSlot === "intent_level"
  };

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ outPath, pendingSurvivedAll, turns: turns.map((t) => ({
    turn: t.turn,
    pendingSlot: t.pendingSlot,
    turnsSinceArmed: t.turnsSinceArmed,
    action: t.decision?.action
  })) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
