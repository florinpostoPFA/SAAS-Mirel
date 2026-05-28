"use strict";

const request = require("supertest");
const { getArtifactVersions } = require("../services/artifactVersions");
const { getSession, resetGoldenConversationSessions } = require("../services/sessionStore");

const NAME = "current";
const VERSION = "1.0.0";

let app;

function lazyLoadApp() {
  if (!app) {
    if (!process.env.EVAL_HARNESS_INSTALLED) {
      require("../eval/bootstrapReplayHarness").install();
    }
    app = require("../server");
  }
  return app;
}

function readLastInteractionLine() {
  const il = require("../services/interactionLog");
  if (il.appendInteractionLine && typeof il.appendInteractionLine.mock === "function") {
    const calls = il.appendInteractionLine.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : null;
  }
  return require("../eval/bootstrapReplayHarness").getLastInteractionLine();
}

function normalizeSlots(slots) {
  const s = slots && typeof slots === "object" ? slots : {};
  return {
    context: s.context ?? null,
    surface: s.surface ?? null,
    object: s.object ?? null
  };
}

function mapDecision(httpDecision, logEntry) {
  const fromLog = logEntry?.decision;
  const fromHttp = httpDecision;
  const action =
    fromLog?.action ?? fromHttp?.action ?? null;
  return {
    action,
    flowId: fromLog?.flowId ?? fromHttp?.flowId ?? null,
    missingSlot: fromLog?.missingSlot ?? fromHttp?.missingSlot ?? null,
    reasonCode: fromLog?.reasonCode ?? fromHttp?.reasonCode ?? null
  };
}

function mapOutput(httpBody, logEntry) {
  const reply = String(httpBody?.reply ?? httpBody?.message ?? logEntry?.assistantReply ?? "");
  const outputType = logEntry?.output?.type ?? null;
  const products = logEntry?.output?.products ?? null;
  return {
    type: outputType,
    reply,
    products
  };
}

function checkVersionMismatch({ catalogVersion, rolesVersion, flowsVersion }) {
  const live = getArtifactVersions();
  const mismatches = [];
  if (catalogVersion && live.catalogVersion !== catalogVersion) {
    mismatches.push({
      field: "catalogVersion",
      expected: catalogVersion,
      actual: live.catalogVersion
    });
  }
  if (rolesVersion && live.rolesVersion !== rolesVersion) {
    mismatches.push({
      field: "rolesVersion",
      expected: rolesVersion,
      actual: live.rolesVersion
    });
  }
  if (flowsVersion && live.flowsVersion !== flowsVersion) {
    mismatches.push({
      field: "flowsVersion",
      expected: flowsVersion,
      actual: live.flowsVersion
    });
  }
  return mismatches.length ? mismatches : null;
}

function resetSessionState() {
  resetGoldenConversationSessions();
  require("../eval/bootstrapReplayHarness").clearLastInteractionLine();
}

/**
 * @param {object} params
 * @param {object} params.session — { sessionId, slots?, slotMeta? }
 * @param {string} params.message
 * @param {object} [params.slotMeta]
 * @param {string} params.catalogVersion
 * @param {string} params.rolesVersion
 * @param {string} params.flowsVersion
 */
async function applyTurn({
  session,
  message,
  slotMeta,
  catalogVersion,
  rolesVersion,
  flowsVersion
}) {
  const started = Date.now();
  const apiKey = process.env.API_KEY || "test-api-key";
  const sessionId = String(session?.sessionId || "eval-replay-default");

  const input = {
    message,
    currentSlots: normalizeSlots(session?.slots),
    catalogVersion,
    rolesVersion,
    flowsVersion,
    slotMeta: slotMeta || session?.slotMeta || null
  };

  const versionMismatch = checkVersionMismatch({ catalogVersion, rolesVersion, flowsVersion });

  try {
    require("../eval/bootstrapReplayHarness").clearLastInteractionLine();

    const res = await request(lazyLoadApp())
      .post("/chat")
      .set("x-api-key", apiKey)
      .send({ message, sessionId, clientId: "eval-replay" });

    if (res.statusCode >= 400) {
      return {
        slotsAfter: normalizeSlots(session?.slots),
        decision: {
          action: null,
          flowId: null,
          missingSlot: null,
          reasonCode: null
        },
        output: { type: null, reply: "", products: null },
        wallclockMs: Date.now() - started,
        httpStatus: res.statusCode,
        error: {
          message: `HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`,
          stack: null
        },
        ...(versionMismatch ? { versionMismatch } : {})
      };
    }

    const logEntry = readLastInteractionLine();
    const persisted = getSession(sessionId);
    const slotsAfter = normalizeSlots(logEntry?.slots || persisted?.slots || session?.slots);

    if (session && typeof session === "object") {
      session.slots = { ...slotsAfter };
    }

    const result = {
      slotsAfter,
      decision: mapDecision(res.body?.decision, logEntry),
      output: mapOutput(res.body, logEntry),
      wallclockMs: Date.now() - started,
      httpStatus: res.statusCode
    };

    if (versionMismatch) {
      result.versionMismatch = versionMismatch;
    }

    return result;
  } catch (err) {
    return {
      slotsAfter: normalizeSlots(session?.slots),
      decision: { action: null, flowId: null, missingSlot: null, reasonCode: null },
      output: { type: null, reply: "", products: null },
      wallclockMs: Date.now() - started,
      error: {
        message: err?.message || String(err),
        stack: err?.stack || null
      },
      ...(versionMismatch ? { versionMismatch } : {})
    };
  }
}

module.exports = {
  name: NAME,
  version: VERSION,
  applyTurn,
  resetSessionState
};
