/**
 * Gate B probe runtime: in-process handleChat with askLLM stubbed, real flowExecutor + catalog.
 * Mirrors tests/golden/replayEngine.js but does NOT mock flow (tier-1 routing must be real).
 */
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");

function resolveService(relPath) {
  return path.join(ROOT, "services", relPath);
}

const capturedInteractions = [];

function stubModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    path: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports
  };
}

function clearModuleCache(resolvedPath) {
  if (require.cache[resolvedPath]) {
    delete require.cache[resolvedPath];
  }
}

/**
 * @returns {import("../services/chatService").handleChat}
 */
function loadHandleChatForGateB() {
  process.env.GOLDEN_REPLAY = "1";
  const llmPath = resolveService(path.join("llm", "index.js"));
  const logPath = resolveService("interactionLog.js");
  const chatPath = resolveService("chatService.js");
  const flowPath = resolveService("flowExecutor.js");

  capturedInteractions.length = 0;

  [chatPath, llmPath, logPath, flowPath].forEach(clearModuleCache);

  stubModule(llmPath, {
    askLLM: async () => "Produs recomandat pentru aceasta categorie."
  });

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const realInteractionLog = require(logPath);
  stubModule(logPath, {
    appendInteractionLine: (entry) => {
      try {
        capturedInteractions.push(
          JSON.parse(JSON.stringify(realInteractionLog.enrichInteractionExportRow(entry)))
        );
      } catch {
        capturedInteractions.push({ _raw: String(entry) });
      }
    },
    enrichInteractionExportRow: realInteractionLog.enrichInteractionExportRow,
    INTERACTION_JSONL_SCHEMA_VERSION: realInteractionLog.INTERACTION_JSONL_SCHEMA_VERSION,
    LOG_DIR: realInteractionLog.LOG_DIR
  });

  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(chatPath).handleChat;
}

function getLastCapturedInteraction() {
  return capturedInteractions.length
    ? capturedInteractions[capturedInteractions.length - 1]
    : null;
}

function getAllCapturedInteractions() {
  return [...capturedInteractions];
}

function clearCapturedInteractions() {
  capturedInteractions.length = 0;
}

function loadCatalog() {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "products.json"), "utf8")
  );
}

module.exports = {
  ROOT,
  loadHandleChatForGateB,
  getLastCapturedInteraction,
  getAllCapturedInteractions,
  clearCapturedInteractions,
  loadCatalog
};
