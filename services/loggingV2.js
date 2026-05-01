/**
 * Structured logging v2: trace propagation, stage timings, LLM telemetry, typed errors.
 * Lines are JSON with logVersion: 2 for migration-friendly filtering.
 */

"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const os = require("os");
const { getNowMs, getNowIso } = require("./runtimeContext");
const { AppError } = require("./appError");

const traceStorage = new AsyncLocalStorage();

const SPEC_VERSION = process.env.AI_SPEC_VERSION || process.env.SPEC_VERSION || "2.0.0";

const DEBUG_V2 = isTruthy(process.env.LOG_V2_DEBUG);
const LLM_DEBUG = isTruthy(process.env.LLM_DEBUG_LOG);
const COPY_PASTE_LINE = isTruthy(process.env.LOG_V2_COPY_PASTE);

/** Cached once — stable for process lifetime (manual triage / copy-paste). */
const HOSTNAME_CACHED = os.hostname();

/**
 * Host on every v2 row in production by default; dev off unless LOG_INCLUDE_HOST=1.
 * Opt out: LOG_INCLUDE_HOST=0
 */
function shouldIncludeHostInV2Row() {
  const v = String(process.env.LOG_INCLUDE_HOST || "").toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return process.env.NODE_ENV === "production";
}

function emitStageTimingToConsole() {
  return process.env.LOG_V2_TIMING !== "0";
}

let buildVersionCache = null;

function isTruthy(v) {
  return ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());
}

function getBuildVersion() {
  if (buildVersionCache != null) return buildVersionCache;
  let pkgVer = "unknown";
  try {
    pkgVer = require("../package.json").version;
  } catch (_) {
    /* ignore */
  }
  const sha = process.env.GIT_SHA || process.env.BUILD_SHA || process.env.COMMIT_SHA || null;
  buildVersionCache = sha ? `${pkgVer}+${sha}` : pkgVer;
  return buildVersionCache;
}

function getServiceEnv() {
  if (process.env.NODE_ENV === "production") return "prod";
  return "dev";
}

function truncate(str, max = 160) {
  if (str == null || typeof str !== "string") return str;
  return str.length <= max ? str : `${str.slice(0, max)}…`;
}

/**
 * @param {{ sessionId?: string }} [_meta]
 */
function createTraceId(_meta = {}) {
  try {
    return require("crypto").randomUUID();
  } catch (_) {
    const sid = String(_meta.sessionId || "na").slice(0, 48);
    return `tr_${sid}_${getNowMs()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * @param {object} base
 * @param {string} base.traceId
 * @param {string} [base.sessionId]
 * @param {string} [base.clientId]
 * @param {string} [base.requestId]
 * @param {string} [base.service]
 * @param {() => Promise<any> | any} fn
 */
function runWithTraceContext(base, fn) {
  const store = {
    traceId: base.traceId,
    sessionId: base.sessionId ?? null,
    clientId: base.clientId ?? null,
    requestId: base.requestId ?? null,
    service: base.service || "chatService",
    turnStartMs: getNowMs(),
    stages: {},
    routingStage: null,
    clarificationStage: null,
    searchStage: null,
    responseStage: null
  };
  return traceStorage.run(store, () => fn(store));
}

function getTraceStore() {
  return traceStorage.getStore();
}

function baseFields(event, extra = {}) {
  const s = getTraceStore();
  const row = {
    logVersion: 2,
    ts: getNowIso(),
    nowMs: getNowMs(),
    event,
    specVersion: SPEC_VERSION,
    buildVersion: getBuildVersion(),
    env: getServiceEnv(),
    service: s?.service || extra.service || "unknown",
    clientId: s?.clientId ?? null,
    requestId: s?.requestId ?? null,
    ...extra
  };
  row.service = s?.service || row.service || "unknown";
  row.traceId = s?.traceId ?? row.traceId ?? "__missing_trace_context__";
  row.sessionId = s?.sessionId ?? row.sessionId ?? "__missing_session_id__";
  if (shouldIncludeHostInV2Row()) {
    row.host = HOSTNAME_CACHED;
  }
  return row;
}

/**
 * Single-line summary for manual copy/paste (Notion, tickets). Uses same host as v2 rows when enabled.
 * @param {Record<string, unknown>} row
 */
function formatLogLineForCopyPaste(row) {
  const host = row.host != null && row.host !== "" ? row.host : HOSTNAME_CACHED;
  const outcome = row.meta && typeof row.meta === "object" ? row.meta.outcome : null;
  const outcomeStr =
    outcome && typeof outcome === "object"
      ? [
          outcome.decisionAction != null ? String(outcome.decisionAction) : "",
          outcome.outputType != null ? String(outcome.outputType) : "",
          outcome.queryType != null ? String(outcome.queryType) : ""
        ]
          .filter(Boolean)
          .join("/")
      : "";
  return [
    `ts=${row.ts ?? ""}`,
    `env=${row.env ?? ""}`,
    `host=${host}`,
    `service=${row.service ?? ""}`,
    `traceId=${row.traceId ?? ""}`,
    `sessionId=${row.sessionId ?? ""}`,
    `event=${row.event ?? ""}`,
    `outcome=${outcomeStr}`
  ].join(" ");
}

function writeRow(row) {
  const jsonLine = JSON.stringify(row);
  console.log(jsonLine);
  if (COPY_PASTE_LINE && row.event === "TURN_SUMMARY") {
    console.log(formatLogLineForCopyPaste(row));
  }
}

/**
 * @param {{ messageLen?: number, messagePreview?: string }} [meta]
 */
function emitTurnStart(meta = {}) {
  const preview =
    (DEBUG_V2 || LLM_DEBUG) && meta.messagePreview
      ? { messagePreview: truncate(String(meta.messagePreview), 120) }
      : {};
  writeRow(
    baseFields("TURN_START", {
      stage: "turn",
      ok: true,
      meta: {
        messageLen: meta.messageLen != null ? meta.messageLen : null,
        ...preview
      }
    })
  );
}

function recordStageTiming(stage, durationMs, opts = {}) {
  const { ok = true, meta = {} } = opts;
  const s = getTraceStore();
  if (s) {
    s.stages[stage] = {
      durationMs,
      ok,
      ...(DEBUG_V2 ? meta : pickSafeMeta(meta))
    };
  }
  if (!emitStageTimingToConsole()) return;
  writeRow(
    baseFields("STAGE_TIMING", {
      stage,
      durationMs,
      ok,
      meta: DEBUG_V2 ? meta : pickSafeMeta(meta)
    })
  );
}

function pickSafeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const allow = [
    "queryType",
    "productCount",
    "knowledgeHits",
    "path",
    "earlyExit",
    "flushedAtEnd",
    "incomplete",
    "reason"
  ];
  const out = {};
  for (const k of allow) {
    if (meta[k] !== undefined) out[k] = meta[k];
  }
  return out;
}

function beginStage(stage) {
  const t0 = getNowMs();
  let ended = false;
  return {
    end(opts = {}) {
      if (ended) return;
      ended = true;
      recordStageTiming(stage, Math.max(0, getNowMs() - t0), opts);
    }
  };
}

async function withStageTimer(stage, fn) {
  const h = beginStage(stage);
  try {
    const r = await fn();
    h.end({ ok: true });
    return r;
  } catch (e) {
    h.end({ ok: false, meta: { errorCode: e && e.code, messageLen: e && e.message ? e.message.length : 0 } });
    throw e;
  }
}

/**
 * @param {object} p
 * @param {string} p.model
 * @param {string} p.provider
 * @param {number} p.durationMs
 * @param {{ prompt?: number, completion?: number, total?: number } | null} p.tokens
 * @param {{ currency?: string, amount?: number } | null} [p.cost]
 * @param {string} [p.stage]
 * @param {Record<string, unknown>} [p.debugMeta]
 */
function emitLlmCall(p) {
  const { model, provider, durationMs, tokens, cost, stage = "llm", debugMeta = {}, ok = true } = p;
  const meta = {
    model,
    provider,
    tokens: tokens || null,
    cost: cost || null
  };
  if (LLM_DEBUG || DEBUG_V2) {
    Object.assign(meta, debugMeta);
  }
  writeRow(
    baseFields("LLM_CALL", {
      stage,
      durationMs,
      ok,
      meta
    })
  );
}

/**
 * @param {Error} err
 * @param {{ stage?: string }} [opts]
 */
function emitError(err, opts = {}) {
  const stage = opts.stage || "unknown";
  const isApp = err instanceof AppError;
  const row = baseFields("ERROR", {
    stage,
    ok: false,
    error: {
      code: isApp ? err.code : "UNHANDLED",
      category: isApp ? err.category : "UNKNOWN",
      message: err.message || String(err),
      ...(getServiceEnv() !== "prod" && err.stack ? { stack: err.stack } : {})
    }
  });
  writeRow(row);
}

/**
 * Flush routing/clarification stages if still open (early returns).
 * @param {object} interactionRef
 */
function flushStagesForEarlyExit(interactionRef) {
  const s = getTraceStore();
  if (!s) return;
  if (s.routingStage) {
    s.routingStage.end({
      ok: true,
      meta: {
        earlyExit: true,
        queryType: interactionRef?.queryType ?? null
      }
    });
    s.routingStage = null;
  }
  if (s.clarificationStage) {
    s.clarificationStage.end({
      ok: true,
      meta: { flushedAtEnd: true }
    });
    s.clarificationStage = null;
  }
  if (s.searchStage) {
    s.searchStage.end({ ok: true, meta: { flushedAtEnd: true } });
    s.searchStage = null;
  }
  if (s.responseStage) {
    s.responseStage.end({ ok: true, meta: { flushedAtEnd: true } });
    s.responseStage = null;
  }
}

/**
 * @param {object} interactionRef
 * @param {object} finalResult
 * @param {string} finalOutputType
 * @param {unknown[]} finalProducts
 */
function emitTurnSummary(interactionRef, finalResult, finalOutputType, finalProducts) {
  const s = getTraceStore();
  const action = interactionRef?.decision?.action ?? null;
  const clarification =
    action === "clarification" ||
    Boolean(interactionRef?.safetyTelemetry?.askedClarification) ||
    Boolean(interactionRef?.contextInferenceTelemetry?.contextClarificationAsked);
  const productCount = Array.isArray(finalProducts) ? finalProducts.length : 0;
  const replyLen =
    finalResult && typeof finalResult === "object"
      ? String(finalResult.reply ?? finalResult.message ?? "").length
      : 0;
  const artifactVersions = interactionRef?.artifactVersions || null;
  const outcome = {
    queryType: interactionRef?.queryType ?? null,
    intentType: interactionRef?.intentType ?? null,
    decisionAction: action,
    clarification,
    productCount,
    outputType: finalOutputType ?? null,
    replyLen,
    catalogVersion: artifactVersions?.catalogVersion ?? null,
    rolesVersion: artifactVersions?.rolesVersion ?? null,
    flowsVersion: artifactVersions?.flowsVersion ?? null
  };

  if (!s) {
    writeRow(
      baseFields("TURN_SUMMARY", {
        stage: "turn",
        durationMs: null,
        ok: true,
        meta: {
          outcome,
          traceStoreMissing: true
        },
        traceId: interactionRef?.traceId,
        sessionId: interactionRef?.sessionId,
        service: "chatService"
      })
    );
    return;
  }

  const durationMsTotal = Math.max(0, getNowMs() - s.turnStartMs);
  writeRow(
    baseFields("TURN_SUMMARY", {
      stage: "turn",
      durationMs: durationMsTotal,
      ok: true,
      meta: {
        stages: s.stages,
        outcome
      }
    })
  );
}

function startRoutingStage() {
  const s = getTraceStore();
  if (!s) return;
  s.routingStage = beginStage("routing");
}

function endRoutingStage(meta = {}) {
  const s = getTraceStore();
  if (!s?.routingStage) return;
  s.routingStage.end({ ok: true, meta });
  s.routingStage = null;
}

function startClarificationStage() {
  const s = getTraceStore();
  if (!s) return;
  if (s.clarificationStage != null) return;
  s.clarificationStage = beginStage("clarification");
}

function endClarificationStage(meta = {}) {
  const s = getTraceStore();
  if (!s?.clarificationStage) return;
  s.clarificationStage.end({ ok: true, meta });
  s.clarificationStage = null;
}

/**
 * @template T
 * @param {() => T} fn
 * @param {Record<string, unknown> | ((result: T) => Record<string, unknown>)} [endMeta]
 * @returns {T}
 */
function withSearchPhaseSync(fn, endMeta = {}) {
  const s = getTraceStore();
  endClarificationStage({ reason: "search_start" });
  if (s?.searchStage) {
    s.searchStage.end({ ok: true, meta: { chain: true } });
    s.searchStage = null;
  }
  if (s) s.searchStage = beginStage("search");
  const handle = s?.searchStage;
  try {
    const r = fn();
    const meta = typeof endMeta === "function" ? endMeta(r) : endMeta;
    if (handle && s && s.searchStage === handle) {
      handle.end({ ok: true, meta: meta || {} });
      s.searchStage = null;
    }
    return r;
  } catch (e) {
    if (handle && s && s.searchStage === handle) {
      handle.end({ ok: false, meta: {} });
      s.searchStage = null;
    }
    throw e;
  }
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {Record<string, unknown> | ((result: T) => Record<string, unknown>)} [endMeta]
 * @returns {Promise<T>}
 */
async function withSearchPhaseAsync(fn, endMeta = {}) {
  const s = getTraceStore();
  endClarificationStage({ reason: "search_start" });
  if (s?.searchStage) {
    s.searchStage.end({ ok: true, meta: { chain: true } });
    s.searchStage = null;
  }
  if (s) s.searchStage = beginStage("search");
  const handle = s?.searchStage;
  try {
    const r = await fn();
    const meta = typeof endMeta === "function" ? endMeta(r) : endMeta;
    if (handle && s && s.searchStage === handle) {
      handle.end({ ok: true, meta: meta || {} });
      s.searchStage = null;
    }
    return r;
  } catch (e) {
    if (handle && s && s.searchStage === handle) {
      handle.end({ ok: false, meta: {} });
      s.searchStage = null;
    }
    throw e;
  }
}

module.exports = {
  SPEC_VERSION,
  createTraceId,
  runWithTraceContext,
  getTraceStore,
  emitTurnStart,
  beginStage,
  withStageTimer,
  recordStageTiming,
  emitLlmCall,
  emitError,
  flushStagesForEarlyExit,
  emitTurnSummary,
  startRoutingStage,
  endRoutingStage,
  startClarificationStage,
  endClarificationStage,
  withSearchPhaseSync,
  withSearchPhaseAsync,
  formatLogLineForCopyPaste,
  shouldIncludeHostInV2Row,
  DEBUG_V2,
  LLM_DEBUG,
  COPY_PASTE_LINE
};
