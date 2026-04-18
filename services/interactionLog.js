/**
 * Append-only JSONL interaction logs (one JSON object per line).
 * Files: logs/YYYY-MM-DD.jsonl
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * @param {Record<string, unknown>} entry
 */
function appendInteractionLine(entry) {
  ensureLogDir();
  const day = new Date().toISOString().slice(0, 10);
  const filePath = path.join(LOG_DIR, `${day}.jsonl`);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

module.exports = { appendInteractionLine, LOG_DIR };
