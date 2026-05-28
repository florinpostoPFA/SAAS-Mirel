"use strict";

/**
 * Install in-process test doubles before loading server.js (CLI replay path).
 * Jest tests use jest.mock instead; current.js reads from either path.
 */

const path = require("path");

let installed = false;
let lastInteractionLine = null;

function install() {
  if (installed) return;
  installed = true;
  process.env.API_KEY = process.env.API_KEY || "test-api-key";
  process.env.NODE_ENV = process.env.NODE_ENV || "test";

  const root = path.join(__dirname, "..");

  const loggerPath = require.resolve(path.join(root, "services/logger"));
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      logInfo: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    }
  };

  const llmPath = require.resolve(path.join(root, "services/llm"));
  require.cache[llmPath] = {
    id: llmPath,
    filename: llmPath,
    loaded: true,
    exports: {
      askLLM: async () =>
        "Recomand un produs potrivit pentru cerinta ta, cu aplicare pe suprafata curata."
    }
  };

  const flowPath = require.resolve(path.join(root, "services/flowExecutor"));
  require.cache[flowPath] = {
    id: flowPath,
    filename: flowPath,
    loaded: true,
    exports: {
      executeFlow: async (flow) => ({
        reply: `Flow ${flow?.flowId || "unknown"}`,
        products: [
          {
            id: "eval-replay-1",
            name: "Produs eval replay",
            tags: ["exterior", "paint", "cleaner"]
          }
        ]
      })
    }
  };

  const logPath = require.resolve(path.join(root, "services/interactionLog"));
  require.cache[logPath] = {
    id: logPath,
    filename: logPath,
    loaded: true,
    exports: {
      appendInteractionLine: (entry) => {
        lastInteractionLine = entry;
      }
    }
  };

  process.env.EVAL_HARNESS_INSTALLED = "1";
  process.env.EVAL_REPLAY = "1";
}

function isInstalled() {
  return installed;
}

function getLastInteractionLine() {
  return lastInteractionLine;
}

function clearLastInteractionLine() {
  lastInteractionLine = null;
}

module.exports = {
  install,
  isInstalled,
  getLastInteractionLine,
  clearLastInteractionLine
};
