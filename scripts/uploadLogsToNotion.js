#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { sanitizePreview } = require("../utils/logSanitizer");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") out.file = argv[i + 1];
    if (token === "--date") out.date = argv[i + 1];
  }
  return out;
}

function resolveLogFile({ file, date, logDir }) {
  if (file) return path.resolve(file);
  const day = date || new Date().toISOString().slice(0, 10);
  return path.join(logDir, `${day}.jsonl`);
}

function parseJsonlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Log file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildLogSummary(rows, sourceFile) {
  const actionCounts = {};
  const failureCounts = {};
  let noMatchingProducts = 0;

  for (const row of rows) {
    const action = String(row?.decision?.action || "unknown");
    actionCounts[action] = (actionCounts[action] || 0) + 1;

    if (row?.output?.productsReason === "no_matching_products") {
      noMatchingProducts += 1;
    }

    const failureType = row?.analysis?.failureType;
    if (failureType) {
      failureCounts[failureType] = (failureCounts[failureType] || 0) + 1;
    }
  }

  const topFailures = Object.entries(failureCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const previews = rows.slice(0, 5).map((row) => ({
    traceId: row.traceId || null,
    sessionId: row.sessionId || null,
    messagePreview: sanitizePreview(row.normalizedMessage || row.message || "", 120),
    replyPreview: sanitizePreview(row.reply || row.assistantReply || "", 120)
  }));

  return {
    sourceFile,
    totalRows: rows.length,
    actionCounts,
    noMatchingProducts,
    topFailures,
    previews
  };
}

function summaryToBlocks(summary, title) {
  const lines = [
    `Source file: ${summary.sourceFile}`,
    `Total rows: ${summary.totalRows}`,
    `no_matching_products: ${summary.noMatchingProducts}`,
    `Action counts: ${JSON.stringify(summary.actionCounts)}`,
    `Top failures: ${JSON.stringify(summary.topFailures)}`
  ];
  return [
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: title } }] }
    },
    ...lines.map((line) => ({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: line } }] }
    })),
    ...summary.previews.map((preview) => ({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `[${preview.traceId || "no-trace"}] ${preview.messagePreview}`
            }
          }
        ]
      }
    }))
  ];
}

async function createNotionLogPage({
  apiKey,
  databaseId,
  title,
  summary,
  notionPost = axios.post
}) {
  const payload = {
    parent: { database_id: databaseId },
    properties: {
      Name: {
        title: [{ type: "text", text: { content: title } }]
      }
    },
    children: summaryToBlocks(summary, title)
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };

  try {
    const response = await notionPost("https://api.notion.com/v1/pages", payload, { headers });
    return response.data?.url || null;
  } catch (error) {
    const fallbackPayload = {
      ...payload,
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }]
        }
      }
    };
    const response = await notionPost("https://api.notion.com/v1/pages", fallbackPayload, { headers });
    return response.data?.url || null;
  }
}

async function runUpload(options = {}) {
  const logDir = options.logDir || path.join(__dirname, "..", "logs");
  const filePath = resolveLogFile({
    file: options.file,
    date: options.date,
    logDir
  });
  const rows = parseJsonlFile(filePath);
  const summary = buildLogSummary(rows, filePath);
  const apiKey = options.apiKey || process.env.NOTION_API_KEY;
  const databaseId = options.databaseId || process.env.NOTION_DATABASE_ID;
  if (!apiKey || !databaseId) {
    throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required");
  }
  const titleDate = options.date || path.basename(filePath, ".jsonl");
  const title = `Log upload - ${titleDate}`;
  const notionUrl = await createNotionLogPage({
    apiKey,
    databaseId,
    title,
    summary,
    notionPost: options.notionPost
  });

  return { notionUrl, title, summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { notionUrl } = await runUpload(args);
  console.log(notionUrl);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  resolveLogFile,
  parseJsonlFile,
  buildLogSummary,
  createNotionLogPage,
  runUpload
};
