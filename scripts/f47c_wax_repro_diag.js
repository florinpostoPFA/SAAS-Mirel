#!/usr/bin/env node
"use strict";

/**
 * F47c diagnosis — local wax 2-turn repro log capture.
 * NOT production code. Run: node scripts/f47c_wax_repro_diag.js
 */

process.env.TIER_ONE_GATE_ENABLED = "1";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const runner = `
process.env.TIER_ONE_GATE_ENABLED = "1";
const Module = require("module");
const orig = Module._load;
Module._load = function(req, parent, isMain) {
  if (req.endsWith("services/llm")) return { askLLM: async () => "stub" };
  if (req.endsWith("services/flowExecutor")) return { executeFlow: () => ({ reply: "", products: [] }) };
  if (req.endsWith("services/interactionLog")) return { appendInteractionLine: () => {} };
  return orig.apply(this, arguments);
};
const products = require("./data/products.json");
const { handleChat } = require("./services/chatService");

(async () => {
  const sid = "f47c-repro-session";
  console.log("=== F47c local repro — wax 2-turn ===");
  console.log("T1: vreau sa dau cu ceara la exterior");
  await handleChat("vreau sa dau cu ceara la exterior", "C1", products, sid);
  console.log("T2: vopsea");
  const r2 = await handleChat("vopsea", "C1", products, sid);
  console.log("T2_OUTCOME", JSON.stringify({
    productsCount: (r2.products || []).length,
    messagePreview: String(r2.message || "").slice(0, 150)
  }));
})();
`;

const result = spawnSync("node", ["-e", runner], {
  cwd: path.join(__dirname, ".."),
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024
});

const raw = (result.stdout || "") + (result.stderr || "");
const keepPatterns = [
  /^=== F47c/,
  /^T[12]:/,
  /^T2_OUTCOME/,
  /HARD_FILTER/,
  /TIER_ONE_GATE/,
  /TIER_ONE_UNAVAILABLE/,
  /SELECTION_DEBUG/,
  /SLOT_CHECK_SOURCE/,
  /DECISION_PAYLOAD/,
  /FINAL_DECISION/,
  /Found \d+ product/,
  /productsReason/
];

const filtered = raw
  .split("\n")
  .filter((line) => keepPatterns.some((re) => re.test(line)))
  .map((line) => line.replace(/sessionId":"[^"]+"/g, 'sessionId":"[REDACTED]"'))
  .map((line) => line.replace(/traceId":"[^"]+"/g, 'traceId":"[REDACTED]"'));

const header = [
  "# F47c local repro log",
  "# main: 7f48d50780c517c27220ab78d16daf2aa70d4a3c",
  "# prod trace: b45310a2-4c82-47aa-b8f3-329c2c637d1f",
  "# prod session: 326b24ae-7f26-4821-a923-8cdb8a8a0f59",
  "# T2 prod slots: context=exterior surface=paint object=caroserie action=protect",
  "# T2 prod slotMeta: object=confirmed others=inferred",
  "# T2 prod intent.tags: [exterior, wax, paint]",
  ""
];

const outPath = path.join(__dirname, "..", "f47c_local_repro.log");
fs.writeFileSync(outPath, header.concat(filtered).join("\n") + "\n");
console.log(`Wrote ${filtered.length} filtered lines to ${outPath}`);
if (result.status !== 0) {
  console.error("Repro subprocess exit", result.status);
  process.exit(result.status || 1);
}
