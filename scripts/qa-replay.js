#!/usr/bin/env node
/**
 * QA replay against DEV (or QA_BASE_URL): POST /chat, write artifacts/*.
 *
 * Env:
 *   QA_BASE_URL — optional, default http://localhost:3001
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts");

const BASE_URL = (process.env.QA_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const TARGET_HOST = (() => {
  try {
    return new URL(BASE_URL).host;
  } catch {
    return "";
  }
})();

/** @typedef {{ message: string }} QaStep */
/** @typedef {{ id: string, steps: QaStep[], evaluate: (ctx: { turns: object[] }) => { pass: boolean, failureReason: string | null } }} QaCase */
/** @typedef {{ id: string, title: string, skipReason?: string|null, cases: QaCase[], skipped?: boolean }} QaTicketDef */

/** @type {QaTicketDef[]} */
const TICKETS = [
  {
    id: "log-28-04-decon-zero-products",
    title: "Logs 28.04 — Decontamination flow returned 0 products (unknownRole + bad fallback)",
    cases: [
      {
        id: "decontamination-flow-has-offerings",
        steps: [
          {
            message:
              "Cum fac pas cu pas decontaminarea chimica a vopselei exterioare? Vreau produse pentru fiecare etapa."
          }
        ],
        evaluate: ({ turns }) => {
          const reply = String(turns[turns.length - 1]?.reply || "");
          if (/^hai să clarificăm\. ce vrei exact să faci\?$/i.test(reply.trim())) {
            return { pass: false, failureReason: "decon_hit_duplicate_message_intent_level_guard" };
          }
          if (/Lipseste maparea de roluri|Role mapping is missing/i.test(reply)) {
            return { pass: false, failureReason: "decon_flow_role_mapping_dead_end" };
          }
          if (/Nu am gasit produse potrivite in lista disponibila\.?\s*$/i.test(reply.trim()) && reply.length < 120) {
            return { pass: false, failureReason: "decon_flow_empty_catalog_reply" };
          }
          const hasSignal =
            /Iata|recomand|•|produs|pas\s*\d|step/i.test(reply) || (reply.length > 160 && /\n/.test(reply));
          if (!hasSignal) {
            return { pass: false, failureReason: "decon_flow_no_products_or_steps_in_reply" };
          }
          return { pass: true, failureReason: null };
        }
      }
    ]
  },
  {
    id: "log-29-04-reco-misrouted-intent-level",
    title: "Logs 29.04 — Recommendation prompts misrouted to intent_level clarification",
    cases: [
      {
        id: "explicit-recommend-not-intent-level",
        steps: [
          {
            message: "Recomanda-mi te rog produse concrete pentru curatarea jantelor auto acasa."
          }
        ],
        evaluate: ({ turns }) => {
          const reply = String(turns[turns.length - 1]?.reply || "").trim();
          const r = reply.toLowerCase();
          if (/^hai să clarificăm\. ce vrei exact să faci\?$/i.test(reply)) {
            return { pass: false, failureReason: "generic_intent_level_clarification_duplicate_turn_guard" };
          }
          if (/^ce vrei sa cureti mai exact/i.test(reply)) {
            return { pass: false, failureReason: "generic_intent_level_style_hard_guard_reply" };
          }
          if (r.includes("ce categorie") && r.length < 220) {
            return { pass: false, failureReason: "vague_category_clarification_on_strong_recommend_prompt" };
          }
          const anchored =
            /jant|roti|wheel|felg|produs|recomand|•|solutie|cleaner/i.test(r) || (r.length > 200 && /\n/.test(r));
          if (!anchored) {
            return { pass: false, failureReason: "recommend_prompt_did_not_produce_jante_or_product_signal" };
          }
          return { pass: true, failureReason: null };
        }
      }
    ]
  },
  {
    id: "log-29-04-wheels-invalid-surface",
    title: "Logs 29.04 — Wheels intent ended with invalid surface (jante + textile)",
    cases: [
      {
        id: "jante-not-paired-with-textile-recommendation",
        steps: [
          {
            message:
              "Vreau sa curat jantele. Am la indemana doar un cleaner etichetat pentru textil — merge folosit?"
          }
        ],
        evaluate: ({ turns }) => {
          const reply = String(turns[turns.length - 1]?.reply || "");
          const r = reply.toLowerCase();
          if (/iata recomandarile/i.test(r) && /textil|țesut|mocheta/.test(r) && /jant|roti|wheel/.test(r)) {
            return { pass: false, failureReason: "reply_pairs_jante_with_textile_as_final_recommendation" };
          }
          if (/jant|roti/i.test(r) && /textil|țesut/i.test(r) && /(recomand|folose|produs|sigur)/i.test(r)) {
            const warns =
              /nu (e|este) potrivit|nu recomand|risc|evita|interzis|atentie|nu folosi|incompatibil/i.test(r);
            if (!warns && /merge|da,|poti folosi/i.test(r)) {
              return { pass: false, failureReason: "affirms_textile_cleaner_on_wheels_without_safety_pushback" };
            }
          }
          return { pass: true, failureReason: null };
        }
      }
    ]
  },
  {
    id: "log-29-04-session-reuse",
    title: "Logs 29.04 — sessionId reused across distinct conversations (breaks conversation counts)",
    cases: [
      {
        id: "distinct-sessions-stay-distinct-a",
        steps: [{ message: "Salut, vreau informatii despre polish exterior." }],
        evaluate: () => ({ pass: true, failureReason: null })
      },
      {
        id: "distinct-sessions-stay-distinct-b",
        steps: [{ message: "Salut, alt subiect: cum curat geamurile?" }],
        evaluate: () => ({ pass: true, failureReason: null })
      }
    ]
  },
  {
    id: "catalog-v2-refresh-coverage",
    title: "Catalog v2: refresh scripts + role→product coverage validation + artifact version logging",
    skipped: true,
    skipReason: "Not HTTP-testable against /chat; run catalog refresh and coverage scripts in CI or locally.",
    cases: []
  },
  {
    id: "wheel-tire-strict-filter-no-wipeout",
    title: "Wheel/tire strict filter: remove wipeout (strict pass without fallback)",
    cases: [
      {
        id: "strict-jante-query-not-full-wipeout",
        steps: [
          {
            message:
              "Am nevoie strict de produse pentru jante metalice vopsite, nu pentru anvelope si nu pentru caroserie."
          }
        ],
        evaluate: ({ turns }) => {
          const reply = String(turns[turns.length - 1]?.reply || "").trim();
          if (/^nu am gasit produse potrivite in lista disponibila\.?$/i.test(reply)) {
            return { pass: false, failureReason: "strict_wheel_query_wiped_out_to_empty_reply" };
          }
          return { pass: true, failureReason: null };
        }
      }
    ]
  },
  {
    id: "context-loss-mvp",
    title: "Context loss detection & recovery (MVP)",
    cases: [
      {
        id: "followup-stays-on-jante-guide",
        steps: [
          { message: "Vreau ghid pas cu pas pentru curatarea jantelor." },
          { message: "La pasul unde aplic solutia, cat timp o las sa actioneze?" }
        ],
        evaluate: ({ turns }) => {
          const last = String(turns[turns.length - 1]?.reply || "");
          const r = last.toLowerCase();
          const grounded = /jant|roti|wheel|solut|acid|pas|etalon|minute|clay|iron/i.test(r);
          const genericOnly =
            /^ce (suprafata|vrei sa)/i.test(last.trim()) && !grounded && last.length < 220;
          if (genericOnly) {
            return { pass: false, failureReason: "followup_lost_jante_context_generic_surface_prompt" };
          }
          if (!grounded && last.length < 100) {
            return { pass: false, failureReason: "followup_reply_too_thin_without_jante_or_procedure_signal" };
          }
          return { pass: true, failureReason: null };
        }
      }
    ]
  },
  {
    id: "log-trace-host-jsonl-rows",
    title: "Add traceId + host to logs/YYYY-MM-DD.jsonl interaction rows",
    skipped: true,
    skipReason: "Asserts server-side log files; replay only validates API fields where applicable (see trace ingest ticket).",
    cases: []
  },
  {
    id: "log-29-04-missing-trace-ingest",
    title: "Logs 29.04 — Missing traceId/host in ingested prod logs (0. Logs DB)",
    cases: [
      {
        id: "chat-response-includes-trace-id",
        steps: [{ message: "Salut, ma poti ajuta cu detailing?" }],
        evaluate: ({ turns }) => {
          const traceId = turns[turns.length - 1]?.traceId;
          if (traceId == null || String(traceId).trim() === "") {
            return { pass: false, failureReason: "missing_traceId_in_chat_json" };
          }
          if (String(traceId).length < 8) {
            return { pass: false, failureReason: "traceId_too_short" };
          }
          return { pass: true, failureReason: null };
        }
      }
    ]
  }
];

function ensureArtifactsDirFresh() {
  fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function extractTraceId(body, headers) {
  if (body && body.traceId != null && String(body.traceId).trim() !== "") {
    return String(body.traceId).trim();
  }
  const h = headers || {};
  const fromHeader =
    h["x-trace-id"] ||
    h["x-request-id"] ||
    h["x-correlation-id"] ||
    h["traceparent"];
  if (fromHeader && String(fromHeader).trim()) {
    const tp = String(fromHeader).trim();
    if (tp.startsWith("00-")) {
      const parts = tp.split("-");
      return parts[1] || tp;
    }
    return tp;
  }
  return null;
}

/**
 * @param {string} initialSessionId
 * @param {QaCase} qaCase
 * @param {string} ticketId
 * @param {string} ticketTitle
 * @param {(line: object) => void} appendLog
 */
async function runCase(initialSessionId, qaCase, ticketId, ticketTitle, appendLog) {
  let sessionId = initialSessionId;
  const turns = [];
  let finalPass = true;
  let finalFailureReason = null;

  for (let turnIndex = 0; turnIndex < qaCase.steps.length; turnIndex++) {
    const step = qaCase.steps[turnIndex];
    const message = String(step.message || "");
    const ts = new Date().toISOString();
    let httpStatus = 0;
    let reply = "";
    let traceId = null;

    try {
      const res = await axios.post(
        `${BASE_URL}/chat`,
        { message, sessionId },
        {
          validateStatus: () => true,
          timeout: 180000,
          headers: { "Content-Type": "application/json" }
        }
      );
      httpStatus = res.status;
      const body = res.data && typeof res.data === "object" ? res.data : {};
      reply = String(body.reply ?? body.message ?? "");
      traceId = extractTraceId(body, res.headers);
      if (body.sessionId != null && String(body.sessionId).trim() !== "") {
        sessionId = String(body.sessionId).trim();
      }
    } catch (err) {
      httpStatus = err.response?.status || 0;
      reply = err.message || "request_error";
      traceId = extractTraceId(err.response?.data, err.response?.headers);
    }

    turns.push({
      ts,
      message,
      httpStatus,
      reply,
      traceId,
      sessionId,
      host: TARGET_HOST
    });

    const interim =
      httpStatus !== 200
        ? { pass: false, failureReason: `http_status_${httpStatus}` }
        : qaCase.evaluate({ turns });
    finalPass = interim.pass;
    finalFailureReason = interim.failureReason;

    appendLog({
      ts,
      ticketId,
      ticketTitle,
      caseId: qaCase.id,
      turnIndex,
      message,
      httpStatus,
      reply,
      traceId,
      sessionId,
      host: TARGET_HOST,
      pass: finalPass,
      failureReason: finalFailureReason
    });
  }

  return { turns, pass: finalPass, failureReason: finalFailureReason };
}

async function main() {
  ensureArtifactsDirFresh();
  const ndjsonPath = path.join(ARTIFACTS_DIR, "replay-log.ndjson");
  const summaryPath = path.join(ARTIFACTS_DIR, "summary.json");

  /** Unique per process so DEV session store does not treat replay as duplicate userMessage vs lastUserMessage. */
  const runNonce = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

  /** @type {object[]} */
  const logLines = [];
  const appendLog = (line) => {
    logLines.push(line);
  };

  const summaryTickets = [];

  for (const ticket of TICKETS) {
    if (ticket.skipped || ticket.cases.length === 0) {
      summaryTickets.push({
        ticketId: ticket.id,
        title: ticket.title,
        status: "skipped",
        reason: ticket.skipReason || "no_cases",
        cases: []
      });
      continue;
    }

    const caseResults = [];
    let ticketPass = true;
    let ticketFailureReason = null;

    if (ticket.id === "log-29-04-session-reuse") {
      const initialA = `qa-${runNonce}-session-isolation-a`;
      const initialB = `qa-${runNonce}-session-isolation-b`;
      const c0 = ticket.cases[0];
      const c1 = ticket.cases[1];
      const r0 = await runCase(initialA, c0, ticket.id, ticket.title, appendLog);
      const r1 = await runCase(initialB, c1, ticket.id, ticket.title, appendLog);
      const sid0 = r0.turns[r0.turns.length - 1]?.sessionId;
      const sid1 = r1.turns[r1.turns.length - 1]?.sessionId;
      const sessionOk = sid0 && sid1 && sid0 !== sid1;
      if (!sessionOk) {
        ticketPass = false;
        ticketFailureReason = `expected_distinct_session_ids_got_${sid0}_and_${sid1}`;
        for (let i = logLines.length - 1, patched = 0; i >= 0 && patched < 2; i--) {
          const row = logLines[i];
          if (row && row.ticketId === ticket.id && (row.caseId === c0.id || row.caseId === c1.id)) {
            row.pass = false;
            row.failureReason = ticketFailureReason;
            patched++;
          }
        }
      }
      caseResults.push({
        caseId: c0.id,
        pass: sessionOk,
        failureReason: sessionOk ? null : ticketFailureReason
      });
      caseResults.push({
        caseId: c1.id,
        pass: sessionOk,
        failureReason: sessionOk ? null : ticketFailureReason
      });
      summaryTickets.push({
        ticketId: ticket.id,
        title: ticket.title,
        status: ticketPass ? "pass" : "fail",
        reason: ticketFailureReason,
        cases: caseResults
      });
      continue;
    }

    for (const qaCase of ticket.cases) {
      const initialSessionId = `qa-${runNonce}-${ticket.id}-${qaCase.id}`;
      const { pass, failureReason } = await runCase(
        initialSessionId,
        qaCase,
        ticket.id,
        ticket.title,
        appendLog
      );
      caseResults.push({ caseId: qaCase.id, pass, failureReason });
      if (!pass) {
        ticketPass = false;
        ticketFailureReason = ticketFailureReason || failureReason;
      }
    }

    summaryTickets.push({
      ticketId: ticket.id,
      title: ticket.title,
      status: ticketPass ? "pass" : "fail",
      reason: ticketPass ? null : ticketFailureReason,
      cases: caseResults
    });
  }

  fs.writeFileSync(ndjsonPath, `${logLines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    runNonce,
    tickets: summaryTickets
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const requiredFailed = summaryTickets.some((t) => t.status === "fail");
  process.exit(requiredFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
