#!/usr/bin/env node
/**
 * Top 25 prompts regression gate (Notion deliverable).
 * Runs in a fresh Node process with golden-style stubs (see tests/golden/replayEngine.js).
 *
 * Usage:
 *   node scripts/top25-regression.js
 *   npm run test:top25
 */

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
const { evaluateTop25Expectation, evaluateSessionSlots } = require("../tests/regression/top25Evaluator");

const SUITE_PATH = path.join(__dirname, "..", "tests", "regression", "top25_prompt_cases.json");
const baseNow = 1700000000000;

async function main() {
  const suite = JSON.parse(fs.readFileSync(SUITE_PATH, "utf8"));
  if (!Array.isArray(suite.cases) || suite.cases.length !== 25) {
    console.error(`Expected exactly 25 cases in ${SUITE_PATH}, got ${suite.cases?.length}`);
    process.exit(1);
  }

  const products = loadFixtureProducts(null);
  let failed = 0;

  for (const c of suite.cases) {
    configureRuntime({ nowMs: baseNow });
    const handleChat = loadHandleChatFresh();
    sessionStore.resetGoldenConversationSessions();
    const sessionId = `top25-${c.id}-${baseNow}`;
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
      console.error(`[FAIL] ${c.id}: no interaction captured (appendInteractionLine)`);
      failed++;
      continue;
    }

    const rubric = evaluateTop25Expectation(entry, c.expect || {});
    const slotRubric = evaluateSessionSlots(
      sessionStore.getSession(sessionId),
      (c.expect && c.expect.sessionSlots) || {}
    );

    if (!rubric.pass || !slotRubric.pass) {
      const all = [...rubric.failures, ...slotRubric.failures];
      console.error(`[FAIL] ${c.id}: ${c.title}`);
      for (const line of all) {
        console.error(`       - ${line}`);
      }
      console.error(`       decision: ${JSON.stringify(entry.decision)}`);
      failed++;
    } else {
      console.log(`[ok]   ${c.id}`);
    }
  }

  resetRuntime();
  delete process.env.GOLDEN_REPLAY;

  if (failed > 0) {
    console.error(`\nTop 25 regression: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log("\nTop 25 regression: all cases passed");
  process.exit(0);
}

main();
