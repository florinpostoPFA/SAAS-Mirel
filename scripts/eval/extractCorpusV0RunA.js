#!/usr/bin/env node
/**
 * Run A — extract eval/corpus/v0/*.jsonl from Notion 2.0 Logs DB.
 * One-off data extraction; not part of the replay harness.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const NOTION_API = "https://api.notion.com/v1";
const PINNED = {
  catalogVersion: "bf2ca471f202",
  rolesVersion: "f701d80d60f4",
  flowsVersion: "8a40fae83864"
};

const SESSIONS = {
  "session_6c0f1348.jsonl": "6c0f1348-cc59-43b8-8616-472a1fccbe0b",
  "session_704783fb.jsonl": "704783fb-deb7-48a4-be6c-aece67ff79e0"
};

/** Firm FN events: traceId prefix (8 chars) + expected shelf label from audit. */
const AUDIT_FN10 = [
  {
    tracePrefix: null,
    sessionId: "704783fb-deb7-48a4-be6c-aece67ff79e0",
    messageIncludes: "recomandare de produse cu efect hidrofob",
    expectedDecisionLabel: "shelf_protect_hydrophobic"
  },
  {
    tracePrefix: null,
    sessionId: "6c0f1348-cc59-43b8-8616-472a1fccbe0b",
    messageIncludes: "vreau polish negru",
    expectedDecisionLabel: "shelf_polish"
  },
  {
    tracePrefix: null,
    sessionId: "6c0f1348-cc59-43b8-8616-472a1fccbe0b",
    messageIncludes: "polish",
    messageExact: "polish",
    expectedDecisionLabel: "shelf_polish"
  },
  {
    tracePrefix: null,
    sessionId: "704783fb-deb7-48a4-be6c-aece67ff79e0",
    messageIncludes: "ce-i mai bun ceara sau coating",
    expectedDecisionLabel: "shelf_protect_wax_or_coating"
  },
  {
    tracePrefix: "c2c642f0",
    sessionId: "6c0f1348-cc59-43b8-8616-472a1fccbe0b",
    messageIncludes: "vreu ceramica",
    expectedDecisionLabel: "shelf_ceramic_coating"
  },
  {
    tracePrefix: "da38a989",
    sessionId: "704783fb-deb7-48a4-be6c-aece67ff79e0",
    messageIncludes: "cum se face stratul ceramic pe vopsea",
    expectedDecisionLabel: "shelf_ceramic_coating"
  },
  {
    tracePrefix: null,
    sessionId: "6c0f1348-cc59-43b8-8616-472a1fccbe0b",
    messageIncludes: "vreau ceara",
    expectedDecisionLabel: "shelf_protect_wax"
  },
  {
    tracePrefix: null,
    sessionId: "6c0f1348-cc59-43b8-8616-472a1fccbe0b",
    messageIncludes: "vreau sa imi intretin masina",
    expectedDecisionLabel: "shelf_maintain"
  },
  {
    tracePrefix: null,
    sessionId: "704783fb-deb7-48a4-be6c-aece67ff79e0",
    messageIncludes: "recomanda un produs hidrofob",
    expectedDecisionLabel: "shelf_protect_hydrophobic"
  },
  {
    tracePrefix: null,
    sessionId: "704783fb-deb7-48a4-be6c-aece67ff79e0",
    messageIncludes: "recomanda-mi o solutie cu efect hidrofob",
    expectedDecisionLabel: "shelf_protect_hydrophobic"
  }
];

function notionHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
}

function parseRawJson(prop) {
  const text = (prop?.rich_text || []).map((t) => t.plain_text || t.text?.content || "").join("");
  if (!text) return null;
  const truncated = text.includes("...[TRUNCATED]");
  const jsonText = truncated ? text.slice(0, text.indexOf("...[TRUNCATED]")) : text;
  try {
    return { row: JSON.parse(jsonText), truncated };
  } catch {
    return null;
  }
}

function normalizeSlots(slots) {
  const s = slots && typeof slots === "object" ? slots : {};
  return {
    context: s.context ?? null,
    surface: s.surface ?? null,
    object: s.object ?? null
  };
}

function normalizeMessage(row, props) {
  const fromProp =
    (props["User message"]?.rich_text || []).map((t) => t.plain_text || "").join("") || "";
  return String(row?.normalizedMessage || row?.message || fromProp || "").trim();
}

async function querySession({ apiKey, databaseId, sessionId }) {
  const url = `${NOTION_API}/databases/${databaseId}/query`;
  const results = [];
  let cursor;
  for (let page = 0; page < 50; page += 1) {
    const body = {
      page_size: 100,
      filter: { property: "SessionId", rich_text: { equals: sessionId } }
    };
    if (cursor) body.start_cursor = cursor;
    const res = await axios.post(url, body, { headers: notionHeaders(apiKey) });
    const data = res.data || {};
    results.push(...(data.results || []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return results;
}

function rowFromNotionPage(page) {
  const props = page.properties || {};
  const parsed = parseRawJson(props["Raw JSON"]);
  if (!parsed?.row) return null;
  const row = parsed.row;
  const timestamp =
    row.timestamp ||
    props.Timestamp?.date?.start ||
    page.created_time ||
    null;
  const message = normalizeMessage(row, props);
  const prodCatalog = row.catalogVersion || row.artifactVersions?.catalogVersion || null;
  const prodRoles = row.rolesVersion || row.artifactVersions?.rolesVersion || null;
  const prodFlows = row.flowsVersion || row.artifactVersions?.flowsVersion || null;
  return {
    row,
    message,
    timestamp,
    traceId: row.traceId || null,
    prodVersions: { catalog: prodCatalog, roles: prodRoles, flows: prodFlows },
    truncated: parsed.truncated
  };
}

function buildCorpusLine(turnIdx, timestamp, message, currentSlots, versionSkips) {
  return {
    turnIdx,
    timestamp,
    message,
    currentSlots: normalizeSlots(currentSlots),
    catalogVersion: PINNED.catalogVersion,
    rolesVersion: PINNED.rolesVersion,
    flowsVersion: PINNED.flowsVersion,
    ...(versionSkips.length ? { _versionMismatchLogged: versionSkips } : {})
  };
}

function sessionToCorpus(pages, sessionId) {
  const entries = [];
  const versionSkips = [];

  for (const page of pages) {
    const parsed = rowFromNotionPage(page);
    if (!parsed) continue;
    entries.push(parsed);
    const { prodVersions, traceId } = parsed;
    for (const [key, prod, pinnedKey] of [
      ["catalog", prodVersions.catalog, "catalogVersion"],
      ["roles", prodVersions.roles, "rolesVersion"],
      ["flows", prodVersions.flows, "flowsVersion"]
    ]) {
      if (prod && prod !== PINNED[pinnedKey]) {
        versionSkips.push({
          sessionId,
          traceId,
          field: pinnedKey,
          prod: prod,
          pinned: PINNED[pinnedKey]
        });
      }
    }
  }

  entries.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

  let prevSlots = {};
  const lines = [];
  entries.forEach((entry, idx) => {
    const skipsForTurn = versionSkips.filter((s) => s.traceId === entry.traceId);
    const line = buildCorpusLine(
      idx,
      entry.timestamp,
      entry.message,
      prevSlots,
      skipsForTurn
    );
    lines.push(line);
    prevSlots = normalizeSlots(entry.row.slots || prevSlots);
  });

  return { lines, versionSkips };
}

function normMsg(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

function matchAuditFn(entry, spec) {
  const msg = normMsg(entry.message);
  const needle = normMsg(spec.messageIncludes);
  if (!msg.includes(needle)) return false;
  if (spec.messageExact && msg !== normMsg(spec.messageExact)) return false;
  if (spec.tracePrefix && !String(entry.traceId || "").startsWith(spec.tracePrefix)) {
    return false;
  }
  if (entry.row.sessionId && entry.row.sessionId !== spec.sessionId) return false;
  return true;
}

async function main() {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !databaseId) {
    throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID required");
  }

  const outDir = path.join(__dirname, "..", "..", "eval", "corpus", "v0");
  fs.mkdirSync(outDir, { recursive: true });

  const allVersionSkips = [];
  const summary = {};

  for (const [filename, sessionId] of Object.entries(SESSIONS)) {
    const pages = await querySession({ apiKey, databaseId, sessionId });
    const { lines, versionSkips } = sessionToCorpus(pages, sessionId);
    allVersionSkips.push(...versionSkips);
    const body = lines.map((l) => {
      const { _versionMismatchLogged, ...rest } = l;
      return JSON.stringify(rest);
    });
    fs.writeFileSync(path.join(outDir, filename), `${body.join("\n")}\n`, "utf8");
    summary[filename] = { turns: lines.length, sessionId };
  }

  const sessionPages = {};
  for (const sessionId of new Set(AUDIT_FN10.map((e) => e.sessionId))) {
    sessionPages[sessionId] = await querySession({ apiKey, databaseId, sessionId });
  }

  const parsedBySession = {};
  for (const [sid, pages] of Object.entries(sessionPages)) {
    parsedBySession[sid] = pages.map(rowFromNotionPage).filter(Boolean);
  }

  const auditLines = [];
  const auditMisses = [];

  AUDIT_FN10.forEach((spec, auditIdx) => {
    const pool = parsedBySession[spec.sessionId] || [];
    let hit = pool.find((e) => matchAuditFn(e, spec));
    if (!hit && spec.tracePrefix) {
      hit = pool.find((t) => String(t.traceId || "").startsWith(spec.tracePrefix));
    }
    if (!hit) {
      auditMisses.push({ auditIdx, spec });
      return;
    }
    const sorted = [...pool].sort((a, b) =>
      String(a.timestamp).localeCompare(String(b.timestamp))
    );
    const turnIdx = sorted.findIndex((e) => e.traceId === hit.traceId);
    let currentSlots = {};
    if (turnIdx > 0) {
      currentSlots = normalizeSlots(sorted[turnIdx - 1].row.slots || {});
    }
    const skips = [];
    for (const [prod, field, pinnedKey] of [
      [hit.prodVersions.catalog, "catalog", "catalogVersion"],
      [hit.prodVersions.roles, "roles", "rolesVersion"],
      [hit.prodVersions.flows, "flows", "flowsVersion"]
    ]) {
      if (prod && prod !== PINNED[pinnedKey]) {
        skips.push({ traceId: hit.traceId, field, prod, pinned: PINNED[pinnedKey] });
      }
    }
    if (skips.length) allVersionSkips.push(...skips.map((s) => ({ sessionId: spec.sessionId, ...s })));

    auditLines.push(
      JSON.stringify({
        turnIdx: auditIdx,
        timestamp: hit.timestamp,
        message: hit.message,
        currentSlots: normalizeSlots(currentSlots),
        catalogVersion: PINNED.catalogVersion,
        rolesVersion: PINNED.rolesVersion,
        flowsVersion: PINNED.flowsVersion,
        expectedDecisionLabel: spec.expectedDecisionLabel
      })
    );
  });

  fs.writeFileSync(
    path.join(outDir, "auditFn10.jsonl"),
    auditLines.length ? `${auditLines.join("\n")}\n` : "",
    "utf8"
  );
  summary["auditFn10.jsonl"] = {
    turns: auditLines.length,
    misses: auditMisses.length
  };

  console.log(
    JSON.stringify(
      { summary, versionSkipCount: allVersionSkips.length, auditMisses, versionSkips: allVersionSkips },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.response?.data || err);
  process.exit(1);
});
