#!/usr/bin/env node
/**
 * Ingest a day's interaction JSONL (logs/<YYYY-MM-DD>.jsonl) into the
 * Notion "2.0. Logs DB" as one database row per JSONL line.
 *
 * Designed to run BEFORE today's rotation:
 *   - default target date = yesterday in UTC
 *   - rotation in services/interactionLog.js is implicit (date-based filename)
 *
 * Idempotent: each row gets a deterministic EventId (sha256 over
 *   traceId|timestamp|message|index) stored in the Notion "EventId" rich_text
 *   property. Before insert, the script pulls the existing EventId set from the
 *   target database and skips duplicates locally — safe to re-run.
 *
 * Property mapping (Notion column -> source field):
 *   Event             title       `${date} ${level||'INFO'} ${decision.action||'unknown'} ${traceId.slice(0,8)}`
 *   Timestamp         date        row.timestamp || row.createdAt (if ISO-parseable)
 *   Ingested at       date        new Date().toISOString() at run time
 *   Level             select      row.level (when present)
 *   Service           select      row.service (when present)
 *   Env               select      row.env (when present)
 *   Decision action   select      row.decision.action
 *   FlowId            rich_text   row.decision.flowId
 *   Missing slot      rich_text   row.analysis.missingSlot ?? row.decision.missingSlot
 *   Slot: context     select      row.slots.context
 *   Slot: object      rich_text   row.slots.object
 *   Slot: surface     rich_text   row.slots.surface
 *   Intent type       rich_text   row.intent.type
 *   Intent queryType  select      row.intent.queryType
 *   User message      rich_text   row.normalizedMessage || row.message
 *   Feedback helpful  select      yes|no|none from row.feedback.helpful
 *   Feedback reason   rich_text   row.feedback.reason
 *   Host              rich_text   row.host
 *   SessionId         rich_text   row.sessionId
 *   TraceId           rich_text   row.traceId
 *   EventId           rich_text   sha256(traceId|timestamp|message|index)
 *   Raw JSON          rich_text   JSON.stringify(row), truncated at 10k chars + "...[TRUNCATED]"
 *
 * Notes on Notion types:
 *   - Selects are sent with `{ select: { name: <value> } }`. If your DB uses
 *     rich_text columns for any of the above selects (e.g. "Decision action"),
 *     Notion will reject those rows; the script will report them as failures
 *     so you can adjust the schema or the mapping.
 *   - rich_text values are auto-chunked into <=2000 char segments to satisfy
 *     Notion's per-segment limit.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const RICH_TEXT_CHUNK = 2000;
const RAW_JSON_MAX = 10000;
const TRUNC_SUFFIX = "...[TRUNCATED]";
const DEFAULT_CONCURRENCY = 4;
const QUERY_PAGE_SIZE = 100;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === "--date") out.date = argv[i + 1];
    else if (tok === "--file") out.file = argv[i + 1];
    else if (tok === "--concurrency") out.concurrency = Number(argv[i + 1]);
    else if (tok === "--max-rows") out.maxRows = Number(argv[i + 1]);
    else if (tok === "--dry-run") out.dryRun = true;
    else if (tok === "--allow-missing") out.allowMissing = true;
  }
  return out;
}

function yesterdayUtc(now = Date.now()) {
  return new Date(now - 86400000).toISOString().slice(0, 10);
}

function resolveLogFile({ file, date, logDir }) {
  if (file) return path.resolve(file);
  return path.join(logDir, `${date}.jsonl`);
}

function parseJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Log file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const valid = [];
  const invalid = [];
  lines.forEach((line, idx) => {
    try {
      valid.push(JSON.parse(line));
    } catch (err) {
      invalid.push({ index: idx, error: (err && err.message) || String(err) });
    }
  });
  return { valid, invalid, totalLines: lines.length };
}

function computeEventId(row, index) {
  const parts = [
    String(row?.traceId || ""),
    String(row?.timestamp || row?.createdAt || ""),
    String(row?.message || row?.normalizedMessage || ""),
    String(index)
  ].join("|");
  return crypto.createHash("sha256").update(parts).digest("hex");
}

function buildRawJsonText(row, maxLength = RAW_JSON_MAX) {
  const json = JSON.stringify(row);
  if (json.length <= maxLength) return json;
  const head = Math.max(0, maxLength - TRUNC_SUFFIX.length);
  return json.slice(0, head) + TRUNC_SUFFIX;
}

function chunkRichText(text) {
  const s = String(text == null ? "" : text);
  if (s.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < s.length; i += RICH_TEXT_CHUNK) {
    chunks.push({ type: "text", text: { content: s.slice(i, i + RICH_TEXT_CHUNK) } });
  }
  return chunks;
}

function rt(text) {
  return { rich_text: chunkRichText(text) };
}

function sel(name) {
  return { select: { name: String(name) } };
}

function dateProp(iso) {
  if (!iso) return null;
  const s = String(iso);
  if (Number.isNaN(Date.parse(s))) return null;
  return { date: { start: s } };
}

function pickNonEmpty(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function buildEventTitle({ row, date }) {
  const level = row?.level || "INFO";
  const action = (row?.decision && row.decision.action) || "unknown";
  const traceSuffix = row?.traceId ? ` ${String(row.traceId).slice(0, 8)}` : "";
  return `${date} ${level} ${action}${traceSuffix}`;
}

function helpfulValue(raw) {
  if (raw === true || raw === "yes" || raw === "true") return "yes";
  if (raw === false || raw === "no" || raw === "false") return "no";
  if (raw == null || raw === "") return "none";
  return String(raw);
}

function buildPageProperties({ row, date, eventId, ingestedAtIso }) {
  const props = {
    Event: {
      title: [{ type: "text", text: { content: buildEventTitle({ row, date }) } }]
    },
    EventId: rt(eventId),
    "Raw JSON": rt(buildRawJsonText(row))
  };

  const timestamp = dateProp(row?.timestamp || row?.createdAt);
  if (timestamp) props.Timestamp = timestamp;

  if (ingestedAtIso) props["Ingested at"] = { date: { start: ingestedAtIso } };

  const level = pickNonEmpty(row?.level);
  if (level) props.Level = sel(level);

  const service = pickNonEmpty(row?.service);
  if (service) props.Service = sel(service);

  const env = pickNonEmpty(row?.env);
  if (env) props.Env = sel(env);

  const action = pickNonEmpty(row?.decision && row.decision.action);
  if (action) props["Decision action"] = sel(action);

  const flowId = pickNonEmpty(row?.decision && row.decision.flowId);
  if (flowId) props.FlowId = rt(String(flowId));

  const missingSlot = pickNonEmpty(
    (row?.analysis && row.analysis.missingSlot) ||
      (row?.decision && row.decision.missingSlot)
  );
  if (missingSlot) props["Missing slot"] = rt(String(missingSlot));

  const ctx = pickNonEmpty(row?.slots && row.slots.context);
  if (ctx) props["Slot: context"] = sel(ctx);

  const obj = pickNonEmpty(row?.slots && row.slots.object);
  if (obj) props["Slot: object"] = rt(String(obj));

  const surface = pickNonEmpty(row?.slots && row.slots.surface);
  if (surface) props["Slot: surface"] = rt(String(surface));

  const intentType = pickNonEmpty(row?.intent && row.intent.type);
  if (intentType) props["Intent type"] = rt(String(intentType));

  const queryType = pickNonEmpty(row?.intent && row.intent.queryType);
  if (queryType) props["Intent queryType"] = sel(queryType);

  const userMessage = pickNonEmpty(row?.normalizedMessage || row?.message);
  if (userMessage) props["User message"] = rt(String(userMessage));

  if (row?.feedback && Object.prototype.hasOwnProperty.call(row.feedback, "helpful")) {
    props["Feedback helpful"] = sel(helpfulValue(row.feedback.helpful));
  }

  const feedbackReason = pickNonEmpty(row?.feedback && row.feedback.reason);
  if (feedbackReason) props["Feedback reason"] = rt(String(feedbackReason));

  const host = pickNonEmpty(row?.host);
  if (host) props.Host = rt(String(host));

  const sessionId = pickNonEmpty(row?.sessionId);
  if (sessionId) props.SessionId = rt(String(sessionId));

  const traceId = pickNonEmpty(row?.traceId);
  if (traceId) props.TraceId = rt(String(traceId));

  return props;
}

function buildPagePayload({ row, date, eventId, databaseId, ingestedAtIso }) {
  return {
    parent: { database_id: databaseId },
    properties: buildPageProperties({ row, date, eventId, ingestedAtIso })
  };
}

function notionHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };
}

async function fetchExistingEventIds({ apiKey, databaseId, notionPost = axios.post }) {
  const headers = notionHeaders(apiKey);
  const url = `${NOTION_API}/databases/${databaseId}/query`;
  const filter = { property: "EventId", rich_text: { is_not_empty: true } };
  const ids = new Set();
  let cursor;

  for (let safety = 0; safety < 200; safety += 1) {
    const body = { page_size: QUERY_PAGE_SIZE, filter };
    if (cursor) body.start_cursor = cursor;

    let res;
    try {
      res = await notionPost(url, body, { headers });
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "";
      if (/EventId/i.test(msg) && /(does not exist|not a property|could not find property)/i.test(msg)) {
        return { ids: new Set(), warning: msg };
      }
      throw err;
    }

    const data = res?.data || {};
    for (const result of data.results || []) {
      const cell = result?.properties?.EventId?.rich_text;
      if (Array.isArray(cell) && cell.length > 0) {
        const text = cell.map((t) => t?.plain_text || t?.text?.content || "").join("");
        if (text) ids.add(text);
      }
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return { ids };
}

async function postPage({ apiKey, payload, notionPost = axios.post }) {
  const res = await notionPost(`${NOTION_API}/pages`, payload, { headers: notionHeaders(apiKey) });
  return { id: res?.data?.id || null, url: res?.data?.url || null };
}

async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const concurrency = Math.max(1, Math.min(limit, items.length || 1));
  async function runner() {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const runners = Array.from({ length: concurrency }, runner);
  await Promise.all(runners);
  return results;
}

async function ingestDailyLogs(options = {}) {
  const logDir = options.logDir || path.join(__dirname, "..", "logs");
  const date = options.date || yesterdayUtc();
  const filePath = resolveLogFile({ file: options.file, date, logDir });
  const apiKey = options.apiKey || process.env.NOTION_API_KEY;
  const databaseId = options.databaseId || process.env.NOTION_DATABASE_ID;
  const notionPost = options.notionPost || axios.post;
  const concurrency = Number.isFinite(options.concurrency) && options.concurrency > 0
    ? options.concurrency
    : DEFAULT_CONCURRENCY;
  const onProgress = options.onProgress || (() => {});

  if (!options.dryRun && (!apiKey || !databaseId)) {
    throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required");
  }

  if (!fs.existsSync(filePath)) {
    if (options.allowMissing) {
      return {
        date,
        file: filePath,
        missing: true,
        totalLines: 0,
        validCount: 0,
        invalidCount: 0,
        considered: 0,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        invalidLines: [],
        dedupeWarning: null
      };
    }
    throw new Error(`Log file not found: ${filePath}`);
  }

  const parsed = parseJsonlFile(filePath);
  const ingestedAtIso = new Date().toISOString();

  let existing = new Set();
  let dedupeWarning = null;
  if (!options.dryRun) {
    const fetched = await fetchExistingEventIds({ apiKey, databaseId, notionPost });
    existing = fetched.ids;
    dedupeWarning = fetched.warning || null;
  }

  let rows = parsed.valid;
  if (Number.isFinite(options.maxRows) && options.maxRows > 0) {
    rows = rows.slice(0, options.maxRows);
  }

  const items = rows.map((row, index) => ({
    row,
    index,
    eventId: computeEventId(row, index)
  }));

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];
  const seen = new Set();

  await withConcurrency(items, concurrency, async (item) => {
    if (existing.has(item.eventId) || seen.has(item.eventId)) {
      skipped += 1;
      onProgress({ uploaded, skipped, failed, total: items.length });
      return;
    }
    seen.add(item.eventId);

    if (options.dryRun) {
      uploaded += 1;
      onProgress({ uploaded, skipped, failed, total: items.length });
      return;
    }

    const payload = buildPagePayload({
      row: item.row,
      date,
      eventId: item.eventId,
      databaseId,
      ingestedAtIso
    });
    try {
      await postPage({ apiKey, payload, notionPost });
      uploaded += 1;
    } catch (err) {
      failed += 1;
      const msg = err?.response?.data?.message || err?.message || String(err);
      errors.push({ index: item.index, eventId: item.eventId, error: msg });
    }
    onProgress({ uploaded, skipped, failed, total: items.length });
  });

  return {
    date,
    file: filePath,
    missing: false,
    totalLines: parsed.totalLines,
    validCount: parsed.valid.length,
    invalidCount: parsed.invalid.length,
    invalidLines: parsed.invalid,
    considered: items.length,
    uploaded,
    skipped,
    failed,
    errors,
    dedupeWarning
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let lastTick = 0;
  const result = await ingestDailyLogs({
    date: args.date,
    file: args.file,
    concurrency: args.concurrency,
    maxRows: args.maxRows,
    dryRun: args.dryRun,
    allowMissing: args.allowMissing,
    onProgress: ({ uploaded, skipped, failed, total }) => {
      const done = uploaded + skipped + failed;
      if (done === total || done - lastTick >= 10) {
        lastTick = done;
        process.stderr.write(
          `progress: uploaded=${uploaded} skipped=${skipped} failed=${failed} total=${total}\n`
        );
      }
    }
  });

  const summary = {
    date: result.date,
    file: result.file,
    missing: result.missing,
    totalLines: result.totalLines,
    validCount: result.validCount,
    invalidCount: result.invalidCount,
    considered: result.considered,
    uploaded: result.uploaded,
    skipped: result.skipped,
    failed: result.failed,
    dedupeWarning: result.dedupeWarning,
    errors: result.errors.slice(0, 10)
  };
  console.log(JSON.stringify(summary, null, 2));
  if (result.failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  yesterdayUtc,
  resolveLogFile,
  parseJsonlFile,
  computeEventId,
  buildRawJsonText,
  chunkRichText,
  buildEventTitle,
  helpfulValue,
  buildPageProperties,
  buildPagePayload,
  fetchExistingEventIds,
  postPage,
  withConcurrency,
  ingestDailyLogs,
  RAW_JSON_MAX,
  TRUNC_SUFFIX,
  RICH_TEXT_CHUNK,
  NOTION_API,
  NOTION_VERSION
};
