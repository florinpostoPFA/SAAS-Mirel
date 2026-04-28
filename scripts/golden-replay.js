#!/usr/bin/env node
/**
 * Golden replay CLI — verify or refresh baselines.
 *
 * Usage:
 *   node scripts/golden-replay.js
 *   node scripts/golden-replay.js --update
 *   node scripts/golden-replay.js --case=low-signal-intent-level
 *
 * Env:
 *   GOLDEN_TRACE=1 — stderr JSON lines per step (for debugging)
 */

process.env.GOLDEN_REPLAY = "1";

const { mainCli } = require("../tests/golden/replayRunner");

mainCli().catch((err) => {
  console.error(err);
  process.exit(1);
});
