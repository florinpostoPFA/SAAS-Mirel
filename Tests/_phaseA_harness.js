#!/usr/bin/env node
"use strict";

/**
 * Phase A / F4 reachability harness — calls handleChat with stubbed LLM/flow.
 * Used by harnessReachability.test.js and manual repro runs.
 */

const path = require("path");
const fs = require("fs");

process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.TIER_ONE_GATE_ENABLED = process.env.TIER_ONE_GATE_ENABLED || "0";

const ROOT = path.join(__dirname, "..");

const CONVOS = {
  smoke: ["salut"],
  A1: ["Vreau sa protejez vopseaua exterioara", "Care e cel mai bun?"],
  A1breadth: ["cum curat scaunele"],
  A2: ["Protejez vopseaua exterioara", "Care e cel mai bun?"],
  A3: ["protejez vopseaua exterioara", "Care e cel mai bun?"],
  A3v3: ["Protejez vopseaua exterioara", "Recomanda produs"],
  A3v4: [
    "Protejez vopseaua exterioara",
    "Recomanda un produs bun pentru protejarea vopselei"
  ],
  A4: ["Protejez vopseaua exterioara", "De ce?"],
  Reg: ["cum curat cotiera"]
};

function stubService(name, exports) {
  const resolved = path.join(ROOT, "services", name);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    path: resolved,
    loaded: true,
    exports
  };
}

function clearServiceCache(names) {
  for (const name of names) {
    const resolved = path.join(ROOT, "services", name);
    if (require.cache[resolved]) delete require.cache[resolved];
  }
}

function loadFreshHandleChat() {
  clearServiceCache([
    "chatService.js",
    path.join("llm", "index.js"),
    "flowExecutor.js",
    "interactionLog.js",
    "slotInferenceFromMessage.js"
  ]);
  stubService(path.join("llm", "index.js"), {
    askLLM: async () => "Răspuns harness stub."
  });
  stubService("flowExecutor.js", {
    executeFlow: async (flow) => ({
      reply: `Flow: ${flow?.flowId || "unknown"}`,
      products: [{ id: "stub-1", name: "Stub Product", tags: ["exterior", "paint"] }]
    })
  });
  stubService("interactionLog.js", {
    appendInteractionLine: () => {},
    enrichInteractionExportRow: (e) => e,
    INTERACTION_JSONL_SCHEMA_VERSION: 2,
    LOG_DIR: "/tmp"
  });
  return require(path.join(ROOT, "services", "chatService")).handleChat;
}

function expectStageReached(traces, stage, { turn = null, minCount = 1 } = {}) {
  const matches = traces.filter((t) => {
    if (t.stage !== stage) return false;
    if (turn != null && t.turn !== turn) return false;
    return true;
  });
  if (matches.length < minCount) {
    const seen = [...new Set(traces.map((t) => `T${t.turn}:${t.stage}`))];
    throw new Error(
      `Expected stage "${stage}"${turn != null ? ` on turn ${turn}` : ""} (min ${minCount}); ` +
        `got ${matches.length}. Seen: ${seen.join(", ")}`
    );
  }
  return matches;
}

async function runConvo(messages, { sessionId, runLabel, captureTraces = true } = {}) {
  const sessionLifecycle = require(path.join(ROOT, "services", "sessionLifecycle"));
  const logger = require(path.join(ROOT, "services", "logger"));

  const traces = [];
  const perTurn = [];
  const realLogInfo = logger.logInfo;

  if (captureTraces) {
    logger.logInfo = (event, payload) => {
      if (event === "SLOT_TRACE") {
        traces.push({ run: runLabel, ...payload });
      }
      return realLogInfo(event, payload);
    };
  }

  const handleChat = loadFreshHandleChat();
  global.__PHASE_A_ACTIVE__ = Boolean(captureTraces);
  const sid = sessionId || `harness-${runLabel}-${Date.now()}`;
  sessionLifecycle.resetAllSessions();

  const minimalProducts = [
    {
      id: "stub-textile",
      name: "Textile Cleaner Stub",
      tags: ["textile", "cleaner", "interior"],
      manufacturerId: "9",
      searchText: "scaune textile tapiterie"
    },
    {
      id: "stub-tire",
      name: "Tire Dressing Stub",
      tags: ["tire_dressing", "tires", "exterior"],
      manufacturerId: "9",
      searchText: "anvelope jante"
    }
  ];

  try {
    for (let i = 0; i < messages.length; i++) {
      global.__PHASE_A_TURN__ = i + 1;
      const reply = await handleChat(messages[i], "C1", minimalProducts, sid);
      const snap = sessionLifecycle.peekSessionSnapshot(sid);
      perTurn.push({
        turn: i + 1,
        message: messages[i],
        sessionSlots: JSON.parse(JSON.stringify(snap?.slots || {})),
        pendingQuestion: snap?.pendingQuestion ?? null,
        decisionTrace: reply?.decisionTrace ?? null
      });
    }
  } finally {
    if (captureTraces) {
      logger.logInfo = realLogInfo;
    }
    global.__PHASE_A_ACTIVE__ = false;
    global.__PHASE_A_TURN__ = null;
    sessionLifecycle.resetAllSessions();
  }

  return { traces, perTurn, sessionId: sid };
}

async function main() {
  const runLabel = process.argv[2] || "smoke";
  const messages = CONVOS[runLabel];
  if (!messages) {
    console.error(`Unknown run: ${runLabel}`);
    process.exit(2);
  }
  const result = await runConvo(messages, { runLabel, sessionId: `harness-${runLabel}` });
  const outPath = path.join(ROOT, "Tests", `_phaseA_out_${runLabel}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ runLabel, outPath, perTurn: result.perTurn }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  CONVOS,
  runConvo,
  expectStageReached,
  loadFreshHandleChat
};
