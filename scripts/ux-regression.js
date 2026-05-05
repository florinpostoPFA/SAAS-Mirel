#!/usr/bin/env node
"use strict";

process.env.GOLDEN_REPLAY = "1";

const fs = require("fs");
const path = require("path");
const { configureRuntime, resetRuntime } = require("../services/runtimeContext");
const sessionStore = require("../services/sessionStore");
const {
  loadHandleChatFresh,
  getLastCapturedInteraction,
  loadFixtureProducts
} = require("../tests/golden/replayEngine");
const { evaluateUXExpectation } = require("../tests/ux/uxEvaluator");

const SUITE_PATH = path.join(__dirname, "..", "tests", "ux", "ux_prompts.json");
const baseNow = 1700000000000;

async function main() {
  const suite = JSON.parse(fs.readFileSync(SUITE_PATH, "utf8"));
  if (!Array.isArray(suite.cases) || suite.cases.length < 15) {
    console.error(`Expected at least 15 UX cases in ${SUITE_PATH}, got ${suite.cases?.length}`);
    process.exit(1);
  }

  const products = loadFixtureProducts(null);
  let failed = 0;

  for (const c of suite.cases) {
    configureRuntime({ nowMs: baseNow });
    const handleChat = loadHandleChatFresh();
    sessionStore.resetGoldenConversationSessions();
    const sessionId = `ux-${c.id}-${baseNow}`;
    const steps = Array.isArray(c.steps) ? c.steps : [];

    if (steps.length === 0) {
      console.error(`[FAIL] ${c.id}: no steps`);
      failed++;
      continue;
    }

    try {
      for (let i = 0; i < steps.length; i++) {
        configureRuntime({ nowMs: baseNow + i * 1000 });
        await handleChat(String(steps[i]), "C1", products, sessionId);
      }
    } catch (err) {
      console.error(`[FAIL] ${c.id}: threw`, err && err.message ? err.message : err);
      failed++;
      continue;
    }

    const entry = getLastCapturedInteraction();
    if (!entry) {
      console.error(`[FAIL] ${c.id}: no interaction captured`);
      failed++;
      continue;
    }

    const rubric = evaluateUXExpectation(entry, c.expect || {});
    if (!rubric.pass) {
      console.error(`[FAIL] ${c.id}: ${c.title}`);
      for (const line of rubric.failures) {
        console.error(`       - ${line}`);
      }
      console.error(`       reply: ${JSON.stringify(entry.assistantReply)}`);
      failed++;
    } else {
      console.log(`[ok]   ${c.id}`);
    }
  }

  resetRuntime();
  delete process.env.GOLDEN_REPLAY;

  if (failed > 0) {
    console.error(`\nUX regression: ${failed} case(s) failed`);
    process.exit(1);
  }

  console.log("\nUX regression: all cases passed");
  process.exit(0);
}

main();
