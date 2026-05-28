#!/usr/bin/env node
"use strict";

/**
 * Eval harness v0 — replay corpus turns through a pluggable architecture.
 * Run B: current architecture only → eval/results/v0/<ISO-timestamp>/current.jsonl
 */

const fs = require("fs");
const path = require("path");

require("../eval/bootstrapReplayHarness").install();

const { getArchitecture } = require("../architectures");
const { seedGoldenConversationSession } = require("../services/sessionStore");

const CORPUS_DIR = path.join(__dirname, "corpus", "v0");
const RESULTS_ROOT = path.join(__dirname, "results", "v0");

const SESSION_BY_CORPUS = {
  "session_6c0f1348.jsonl": "6c0f1348-cc59-43b8-8616-472a1fccbe0b",
  "session_704783fb.jsonl": "704783fb-deb7-48a4-be6c-aece67ff79e0"
};

function listCorpusFiles() {
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
}

function readCorpusLines(filename) {
  const raw = fs.readFileSync(path.join(CORPUS_DIR, filename), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${filename} line ${idx + 1}: ${err.message}`);
      }
    });
}

function resolveSessionId(corpusFile, turn) {
  if (SESSION_BY_CORPUS[corpusFile]) {
    return SESSION_BY_CORPUS[corpusFile];
  }
  return `eval-${corpusFile.replace(/\.jsonl$/, "")}-turn-${turn.turnIdx}`;
}

function normalizeSlots(slots) {
  const s = slots && typeof slots === "object" ? slots : {};
  return {
    context: s.context ?? null,
    surface: s.surface ?? null,
    object: s.object ?? null
  };
}

function seedSessionSlots(sessionId, currentSlots) {
  seedGoldenConversationSession(sessionId, {
    slots: normalizeSlots(currentSlots)
  });
}

function buildInput(turn) {
  return {
    message: turn.message,
    currentSlots: normalizeSlots(turn.currentSlots),
    catalogVersion: turn.catalogVersion,
    rolesVersion: turn.rolesVersion,
    flowsVersion: turn.flowsVersion
  };
}

function buildResultRow({
  corpusFile,
  turn,
  input,
  archResult
}) {
  const row = {
    corpusFile,
    turnIdx: turn.turnIdx,
    input,
    slotsAfter: archResult.slotsAfter,
    decision: archResult.decision,
    output: archResult.output,
    wallclockMs: archResult.wallclockMs
  };
  if (archResult.error) {
    row.error = archResult.error;
  }
  if (archResult.versionMismatch) {
    row.versionMismatch = archResult.versionMismatch;
  }
  return row;
}

async function replayCorpus({ architectureName = "current", outDir }) {
  const arch = getArchitecture(architectureName);
  const startedAll = Date.now();
  const rows = [];
  let previousCorpusFile = null;
  let session = null;
  for (const corpusFile of listCorpusFiles()) {
    const turns = readCorpusLines(corpusFile);
    const isAuditStyle = !SESSION_BY_CORPUS[corpusFile];

    if (corpusFile !== previousCorpusFile) {
      arch.resetSessionState();
      previousCorpusFile = corpusFile;
      session = null;
    }

    for (const turn of turns) {
      const sessionId = resolveSessionId(corpusFile, turn);

      if (!session || session.sessionId !== sessionId) {
        session = { sessionId, slots: normalizeSlots(turn.currentSlots) };
        if (isAuditStyle || turn.turnIdx === 0) {
          seedSessionSlots(sessionId, turn.currentSlots);
          session.slots = normalizeSlots(turn.currentSlots);
        }
      } else if (turn.turnIdx === 0) {
        seedSessionSlots(sessionId, turn.currentSlots);
        session.slots = normalizeSlots(turn.currentSlots);
      }

      const input = buildInput(turn);
      const archResult = await arch.applyTurn({
        session,
        message: turn.message,
        slotMeta: turn.slotMeta,
        catalogVersion: turn.catalogVersion,
        rolesVersion: turn.rolesVersion,
        flowsVersion: turn.flowsVersion
      });

      rows.push(
        buildResultRow({
          corpusFile,
          turn,
          input,
          archResult
        })
      );
    }
  }

  const outPath = path.join(outDir, `${architectureName}.jsonl`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    outPath,
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf8"
  );

  return {
    outPath,
    rowCount: rows.length,
    totalWallclockMs: Date.now() - startedAll,
    rows
  };
}

async function main() {
  const archName = process.argv[2] || "current";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(RESULTS_ROOT, stamp);
  const summary = await replayCorpus({ architectureName: archName, outDir });

  const errors = summary.rows.filter((r) => r.error);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        architecture: archName,
        outPath: summary.outPath,
        turns: summary.rowCount,
        totalWallclockMs: summary.totalWallclockMs,
        errorCount: errors.length
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  replayCorpus,
  listCorpusFiles,
  readCorpusLines,
  CORPUS_DIR,
  SESSION_BY_CORPUS
};
