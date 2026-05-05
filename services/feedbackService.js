const fs = require("fs");
const path = require("path");

const FEEDBACK_SCHEMA_VERSION = 1;
const FEEDBACK_FILE_PATH = path.join(__dirname, "..", "logs", "feedback.jsonl");
const VALID_RATINGS = new Set(["up", "down"]);

function validateFeedbackPayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const sessionId = String(body.sessionId || "").trim();
  const traceId = String(body.traceId || "").trim();
  const rating = String(body.rating || "").trim().toLowerCase();
  const commentRaw = body.comment == null ? "" : String(body.comment);
  const comment = commentRaw.trim().slice(0, 500);

  if (!sessionId) return { ok: false, error: "sessionId is required" };
  if (!traceId) return { ok: false, error: "traceId is required" };
  if (!VALID_RATINGS.has(rating)) return { ok: false, error: "rating must be up or down" };
  if (body.comment != null && typeof body.comment !== "string") {
    return { ok: false, error: "comment must be a string" };
  }

  return {
    ok: true,
    value: { sessionId, traceId, rating, comment }
  };
}

function appendFeedbackRow(feedback, options = {}) {
  const filePath = options.filePath || FEEDBACK_FILE_PATH;
  const timestamp = options.timestamp || new Date().toISOString();
  const env = options.env || process.env.NODE_ENV || "dev";
  const service = options.service || "api";
  const row = {
    timestamp,
    env,
    service,
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    sessionId: feedback.sessionId,
    traceId: feedback.traceId,
    rating: feedback.rating,
    comment: feedback.comment || ""
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

module.exports = {
  FEEDBACK_FILE_PATH,
  FEEDBACK_SCHEMA_VERSION,
  VALID_RATINGS,
  validateFeedbackPayload,
  appendFeedbackRow
};
