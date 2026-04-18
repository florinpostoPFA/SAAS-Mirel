/**
 * Append-only JSONL interaction logs (one JSON object per line).
 * Files: logs/YYYY-MM-DD.jsonl
 */

const fs = require("fs");
const path = require("path");
const { error: logError } = require("./logger");

const LOG_DIR = path.join(__dirname, "..", "logs");
const SOURCE = "interactionLog";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * @param {Record<string, unknown>} entry
 */
function appendInteractionLine(entry) {
  try {
    ensureLogDir();
    const day = new Date().toISOString().slice(0, 10);
    const filePath = path.join(LOG_DIR, `${day}.jsonl`);
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    const message = err && typeof err === "object" && "message" in err ? err.message : String(err);
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    logError(SOURCE, "Failed to append interaction log line", { error: message, code });
  }
}

module.exports = { appendInteractionLine, LOG_DIR };
