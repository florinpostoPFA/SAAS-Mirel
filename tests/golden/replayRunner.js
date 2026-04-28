/**
 * Golden replay: load fixtures, run handleChat steps, write actual/ + diffs.
 */

const fs = require("fs");
const path = require("path");

const { configureRuntime, resetRuntime } = require("../../services/runtimeContext");
const sessionStore = require("../../services/sessionStore");
const sessionService = require("../../services/sessionService");
const {
  loadHandleChatFresh,
  getLastCapturedInteraction,
  loadFixtureProducts
} = require("./replayEngine");
const { sanitizeGoldenSummary } = require("./sanitize");
const { stableStringify } = require("./canonicalize");
const { diffGoldenObjects, buildDiffMarkdown } = require("./diffGolden");

const GOLDEN_CASES = path.join(__dirname, "cases");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function listCaseDirs(filterName) {
  if (!fs.existsSync(GOLDEN_CASES)) return [];
  const dirs = fs
    .readdirSync(GOLDEN_CASES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const sorted = dirs.sort();
  if (!filterName) return sorted;
  return sorted.filter((n) => n === filterName);
}

function snapshotSessionStore(sessionId) {
  const s = sessionStore.getSession(sessionId);
  return JSON.parse(JSON.stringify(s));
}

function snapshotSessionService(sessionId) {
  const s = sessionService.peekSessionSnapshot(sessionId);
  return s || {};
}

/**
 * @returns {Promise<object>}
 */
async function runCase(caseDir, handleChat) {
  const inputPath = path.join(caseDir, "input.json");
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing input.json in ${caseDir}`);
  }
  const input = readJson(inputPath);
  if (input.version !== 1) {
    throw new Error(`Unsupported input version in ${inputPath}: ${input.version}`);
  }

  const sessionId = String(input.sessionId || "golden-session");
  const clientId = String(input.clientId || "C1");
  const nowMs = input.runtime && input.runtime.nowMs != null ? Number(input.runtime.nowMs) : 1700000000000;

  process.env.GOLDEN_REPLAY = "1";
  configureRuntime({ nowMs });

  sessionStore.resetGoldenConversationSessions();
  sessionService.resetGoldenTelemetrySessions();
  sessionStore.setSessionMutationHook(null);

  const initialPath = path.join(caseDir, "initial_state.json");
  if (fs.existsSync(initialPath)) {
    const initial = readJson(initialPath);
    const mergedSeed = {
      ...(initial.sessionStore || {}),
      ...(initial.sessionService || {}),
      ...(initial.session || {})
    };
    if (Object.keys(mergedSeed).length > 0) {
      sessionStore.seedGoldenConversationSession(sessionId, mergedSeed);
    }
  }

  const products = loadFixtureProducts(input.products);
  const mutations = [];

  sessionStore.setSessionMutationHook((evt) => {
    const sanitized = sanitizeGoldenSummary({
      type: evt.type,
      sessionId: evt.sessionId,
      before: evt.before,
      after: evt.after
    });
    if (JSON.stringify(sanitized.before) !== JSON.stringify(sanitized.after)) {
      mutations.push(sanitized);
    }
  });

  const stepsOut = [];
  const steps = Array.isArray(input.steps) ? input.steps : [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const message = String(step.message != null ? step.message : "");
    configureRuntime({ nowMs: nowMs + i * 1000 });

    await handleChat(message, clientId, products, sessionId);

    if (process.env.GOLDEN_TRACE === "1") {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          goldenTrace: "step_complete",
          caseId: path.basename(caseDir),
          step: i,
          message
        })
      );
    }

    const lastLog = getLastCapturedInteraction();
    stepsOut.push(
      sanitizeGoldenSummary({
        index: i,
        input: { message: step.message, clientId: step.clientId || clientId },
        outcome: lastLog
          ? {
              decision: lastLog.decision,
              intent: lastLog.intent,
              output: lastLog.output,
              assistantReply: lastLog.assistantReply,
              lowSignalDetected: lastLog.lowSignalDetected,
              pendingQuestion: lastLog.pendingQuestion
            }
          : null,
        sessionStoreAfter: snapshotSessionStore(sessionId),
        sessionServiceAfter: snapshotSessionService(sessionId),
        sessionMutations: [...mutations]
      })
    );
    mutations.length = 0;
  }

  sessionStore.setSessionMutationHook(null);

  return {
    version: 1,
    caseId: path.basename(caseDir),
    meta: input.meta || {},
    steps: stepsOut
  };
}

async function runAllCases({ caseFilter, update } = {}) {
  const handleChat = loadHandleChatFresh();
  const dirs = listCaseDirs(caseFilter);
  if (!dirs.length) {
    return { ok: false, error: caseFilter ? `No case named "${caseFilter}"` : "No cases in tests/golden/cases" };
  }

  const results = [];
  let failed = false;

  for (const name of dirs) {
    const caseDir = path.join(GOLDEN_CASES, name);
    const actualDir = path.join(caseDir, "actual");
    const expectedPath = path.join(caseDir, "expected", "summary.json");
    ensureDir(actualDir);

    const summary = await runCase(caseDir, handleChat);
    const sanitized = sanitizeGoldenSummary(summary);
    fs.writeFileSync(path.join(actualDir, "summary.json"), stableStringify(sanitized), "utf8");

    if (!fs.existsSync(expectedPath)) {
      if (update) {
        ensureDir(path.join(caseDir, "expected"));
        fs.writeFileSync(expectedPath, stableStringify(sanitized), "utf8");
        results.push({ case: name, status: "baseline_created" });
      } else {
        failed = true;
        results.push({
          case: name,
          status: "missing_expected",
          hint: `Create baseline: node scripts/golden-replay.js --update --case=${name}`
        });
      }
      continue;
    }

    if (update) {
      fs.writeFileSync(expectedPath, stableStringify(sanitized), "utf8");
      results.push({ case: name, status: "baseline_updated" });
      continue;
    }

    const expected = readJson(expectedPath);
    const { equal, pathDiffs } = diffGoldenObjects(expected, sanitized);
    if (!equal) {
      failed = true;
      const diffJson = {
        case: name,
        equal: false,
        pathDiffs
      };
      fs.writeFileSync(path.join(actualDir, "diff.json"), stableStringify(diffJson), "utf8");
      fs.writeFileSync(
        path.join(actualDir, "diff.md"),
        buildDiffMarkdown(pathDiffs),
        "utf8"
      );
      results.push({ case: name, status: "mismatch", diffPath: path.join(actualDir, "diff.md") });
    } else {
      results.push({ case: name, status: "ok" });
    }
  }

  resetRuntime();
  delete process.env.GOLDEN_REPLAY;

  return { ok: !failed, results };
}

function parseArgs(argv) {
  const out = { update: false, case: null, verify: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--update") out.update = true;
    else if (a === "--verify") out.verify = true;
    else if (a.startsWith("--case=")) out.case = a.slice("--case=".length);
    else if (a === "--case" && argv[i + 1]) {
      out.case = argv[++i];
    }
  }
  return out;
}

async function mainCli() {
  const opts = parseArgs(process.argv);
  const res = await runAllCases({ caseFilter: opts.case, update: opts.update });
  if (!res.ok) {
    console.error("Golden replay failed:");
    for (const r of res.results || []) {
      if (r.status === "mismatch") {
        console.error(`  - ${r.case}: see ${r.diffPath}`);
      }
      if (r.status === "missing_expected") {
        console.error(`  - ${r.case}: missing expected/summary.json — ${r.hint || "run --update"}`);
      }
    }
    if (res.error) console.error(res.error);
    process.exit(1);
  }
  for (const r of res.results || []) {
    console.log(`[golden] ${r.case}: ${r.status}`);
  }
}

module.exports = {
  runAllCases,
  runCase,
  listCaseDirs,
  mainCli,
  GOLDEN_CASES
};
