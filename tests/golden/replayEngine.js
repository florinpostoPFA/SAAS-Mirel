/**
 * Loads chatService with LLM / flow / interaction log stubbed (no network, no log files).
 * Must be used before any other code requires chatService in the same process.
 */

const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..", "..");

function resolveService(name) {
  return path.join(ROOT, "services", name);
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

function clearCachedService(name) {
  const p = resolveService(name);
  if (require.cache[p]) delete require.cache[p];
}

/**
 * Install stubs and return a fresh handleChat bound to stubbed deps.
 * Call once per process (or after invalidateHandleChat).
 */
function loadHandleChatFresh() {
  const llmPath = resolveService(path.join("llm", "index.js"));
  const flowPath = resolveService("flowExecutor.js");
  const logPath = resolveService("interactionLog.js");
  const chatPath = resolveService("chatService.js");

  capturedInteractions.length = 0;

  [chatPath, llmPath, flowPath, logPath].forEach((p) => {
    if (require.cache[p]) delete require.cache[p];
  });

  stubModule(llmPath, {
    askLLM: async () => "Răspuns golden determinist."
  });

  stubModule(flowPath, {
    executeFlow: async (flow) => ({
      reply: `Flow: ${flow && flow.flowId}`,
      products: [{ id: 1, name: "GoldenStub", tags: ["exterior"] }]
    })
  });

  stubModule(logPath, {
    appendInteractionLine: (entry) => {
      try {
        capturedInteractions.push(JSON.parse(JSON.stringify(entry)));
      } catch {
        capturedInteractions.push({ _raw: String(entry) });
      }
    },
    LOG_DIR: path.join(ROOT, "logs")
  });

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mod = require(chatPath);
  return mod.handleChat;
}

function getLastCapturedInteraction() {
  return capturedInteractions.length
    ? capturedInteractions[capturedInteractions.length - 1]
    : null;
}

function getAllCapturedInteractions() {
  return [...capturedInteractions];
}

function loadFixtureProducts(ref) {
  if (ref == null) {
    const catalog = path.join(ROOT, "data", "products.json");
    return JSON.parse(fs.readFileSync(catalog, "utf8"));
  }
  if (Array.isArray(ref)) return ref;
  if (ref === "minimal") {
    return [
      {
        id: "g1",
        name: "Golden Product",
        tags: ["exterior", "cleaning"],
        price: 10
      }
    ];
  }
  throw new Error(`golden input.json products: expected null, array, or "minimal", got ${typeof ref}`);
}

module.exports = {
  ROOT,
  loadHandleChatFresh,
  getLastCapturedInteraction,
  getAllCapturedInteractions,
  loadFixtureProducts,
  resolveService
};
