"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const loggingV2 = require("../services/loggingV2");
const interactionLog = require("../services/interactionLog");

describe("interactionLog JSONL export (schema v2)", () => {
  const origEnv = process.env.INTERACTION_LOG_DIR;
  let tmpDir;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.INTERACTION_LOG_DIR;
    } else {
      process.env.INTERACTION_LOG_DIR = origEnv;
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = null;
  });

  it("appendInteractionLine writes schemaVersion, host, and traceId from trace store", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-log-test-"));
    process.env.INTERACTION_LOG_DIR = tmpDir;

    const traceId = "00000000-0000-4000-8000-00000000abcd";
    loggingV2.runWithTraceContext(
      {
        traceId,
        sessionId: "sess-1",
        clientId: "c1",
        service: "chatService"
      },
      () => {
        interactionLog.appendInteractionLine({
          message: "hello",
          sessionId: "sess-1",
          assistantReply: "hi",
          decision: { action: "knowledge", flowId: null, missingSlot: null, hardGuardFallback: false },
          output: { type: "reply", products: [], productsLength: 0, productsReason: null },
          intent: { queryType: null, type: null, tags: null }
        });
      }
    );

    const day = new Date().toISOString().slice(0, 10);
    const filePath = path.join(tmpDir, `${day}.jsonl`);
    const line = fs.readFileSync(filePath, "utf8").trim();
    const row = JSON.parse(line);

    expect(row.schemaVersion).toBe(2);
    expect(row.host).toBe(os.hostname());
    expect(row.traceId).toBe(traceId);
    expect(row.traceContextMissing).toBe(false);
    expect(row.message).toBe("hello");
  });

  it("enrichInteractionExportRow sets traceId null and traceContextMissing when no trace context", () => {
    const row = interactionLog.enrichInteractionExportRow({
      message: "x",
      sessionId: "s",
      traceId: null
    });
    expect(row.traceId).toBeNull();
    expect(row.traceContextMissing).toBe(true);
    expect(row.schemaVersion).toBe(2);
    expect(typeof row.host).toBe("string");
    expect(row.host.length).toBeGreaterThan(0);
  });

  it("traceId matches TURN_SUMMARY for the same turn (correlation)", () => {
    const captured = [];
    const origLog = console.log;
    console.log = (payload) => {
      if (typeof payload === "string") {
        try {
          const o = JSON.parse(payload);
          if (o.event === "TURN_SUMMARY") captured.push(o);
        } catch {
          /* ignore non-JSON lines */
        }
      }
    };

    try {
      loggingV2.runWithTraceContext(
        {
          traceId: "11111111-1111-4111-8111-111111111111",
          sessionId: "corr-sess",
          clientId: "c",
          service: "chatService"
        },
        () => {
          const enriched = interactionLog.enrichInteractionExportRow({
            traceId: "11111111-1111-4111-8111-111111111111",
            decision: { action: "knowledge" },
            queryType: null,
            intentType: null,
            tags: null,
            artifactVersions: null
          });
          loggingV2.emitTurnSummary(
            {
              traceId: enriched.traceId,
              sessionId: "corr-sess",
              decision: { action: "knowledge" },
              queryType: null,
              intentType: null,
              tags: null,
              artifactVersions: null
            },
            { reply: "ok" },
            "reply",
            []
          );
          expect(captured.length).toBe(1);
          expect(captured[0].traceId).toBe(enriched.traceId);
        }
      );
    } finally {
      console.log = origLog;
    }
  });
});
