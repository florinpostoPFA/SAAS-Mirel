/**
 * Append-only JSONL interaction logs (one JSON object per line).
 * Files: logs/YYYY-MM-DD.jsonl
 *
 * schemaVersion:
 *   1 — legacy rows (no schemaVersion, traceId, host, traceContextMissing)
 *   2 — adds traceId (matches Logging v2 TURN_* / TURN_SUMMARY when present),
 *       host (os.hostname), traceContextMissing, schemaVersion
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { error: logError } = require("./logger");
const { getTraceStore } = require("./loggingV2");

const LOG_DIR = path.join(__dirname, "..", "logs");
const SOURCE = "interactionLog";

/** @type {string} */
const HOSTNAME_CACHED = os.hostname();

const INTERACTION_JSONL_SCHEMA_VERSION = 2;

function ensureLogDir() {
  const dir = process.env.INTERACTION_LOG_DIR
    ? path.resolve(process.env.INTERACTION_LOG_DIR)
    : LOG_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function normalizeTraceId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Build the object written to JSONL (single format for all callers).
 * traceId: AsyncLocalStorage store first (same source as TURN_SUMMARY), then entry.traceId.
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown>}
 */
function enrichInteractionExportRow(entry) {
  const safe = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  const store = getTraceStore();
  const fromStore = normalizeTraceId(store?.traceId);
  const fromEntry = normalizeTraceId(safe.traceId);
  const traceId = fromStore ?? fromEntry ?? null;
  const traceContextMissing = traceId == null;

  return {
    ...safe,
    schemaVersion: INTERACTION_JSONL_SCHEMA_VERSION,
    traceId,
    traceContextMissing,
    host: HOSTNAME_CACHED
  };
}

/**
 * @param {Record<string, unknown>} entry
 */
function appendInteractionLine(entry) {
  try {
    const dir = ensureLogDir();
    const row = enrichInteractionExportRow(entry);
    const day = new Date().toISOString().slice(0, 10);
    const filePath = path.join(dir, `${day}.jsonl`);
    fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
  } catch (err) {
    const message = err && typeof err === "object" && "message" in err ? err.message : String(err);
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    logError(SOURCE, "Failed to append interaction log line", { error: message, code });
  }
}

module.exports = {
  appendInteractionLine,
  enrichInteractionExportRow,
  LOG_DIR,
  INTERACTION_JSONL_SCHEMA_VERSION
};
