/**
 * @jest-environment node
 */

const loggingV2 = require("../services/loggingV2");
const { configureRuntime, resetRuntime } = require("../services/runtimeContext");
const { AppError, ERROR_CATEGORIES } = require("../services/appError");

describe("loggingV2 trace propagation", () => {
  afterEach(() => {
    delete process.env.GOLDEN_REPLAY;
    delete process.env.LOG_V2_TIMING;
    resetRuntime();
  });

  test("traceId is stable across nested async withStageTimer", async () => {
    process.env.LOG_V2_TIMING = "0";
    const traceId = loggingV2.createTraceId({ sessionId: "sess-a" });
    const seen = [];

    await loggingV2.runWithTraceContext({ traceId, sessionId: "sess-a", clientId: "c1" }, async () => {
      seen.push(loggingV2.getTraceStore().traceId);
      await loggingV2.withStageTimer("nested", async () => {
        seen.push(loggingV2.getTraceStore().traceId);
        await Promise.resolve();
        seen.push(loggingV2.getTraceStore().traceId);
      });
    });

    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(traceId);
  });
});

describe("loggingV2 stage timing with fixed clock", () => {
  const originalGolden = process.env.GOLDEN_REPLAY;

  afterEach(() => {
    process.env.GOLDEN_REPLAY = originalGolden;
    delete process.env.LOG_V2_TIMING;
    resetRuntime();
    jest.restoreAllMocks();
  });

  test("beginStage/endStage uses getNowMs deltas deterministically", () => {
    process.env.GOLDEN_REPLAY = "1";
    process.env.LOG_V2_TIMING = "1";
    const lines = [];
    jest.spyOn(console, "log").mockImplementation((msg) => lines.push(msg));

    configureRuntime({ nowMs: 1_000 });
    loggingV2.runWithTraceContext({ traceId: "tr-fixed", sessionId: "s1" }, () => {
      const h = loggingV2.beginStage("probe");
      configureRuntime({ nowMs: 1_050 });
      h.end({ ok: true, meta: { queryType: "product_search" } });
    });

    const timing = lines.map((l) => JSON.parse(l)).find((r) => r.event === "STAGE_TIMING");
    expect(timing).toBeDefined();
    expect(timing.stage).toBe("probe");
    expect(timing.durationMs).toBe(50);
    expect(timing.traceId).toBe("tr-fixed");
  });
});

describe("AppError", () => {
  test("serializes fields for structured error logs", () => {
    const err = new AppError("OPENAI_RATE_LIMIT", "Slow down", {
      category: ERROR_CATEGORIES.LLM,
      httpStatus: 429,
      details: { retryAfter: 2 }
    });
    expect(err.toJSON()).toEqual({
      name: "AppError",
      code: "OPENAI_RATE_LIMIT",
      category: "LLM",
      message: "Slow down",
      httpStatus: 429,
      details: { retryAfter: 2 }
    });
  });
});

describe("loggingV2 host + copy-paste helpers", () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origIncHost = process.env.LOG_INCLUDE_HOST;
  const origCopyPaste = process.env.LOG_V2_COPY_PASTE;

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    process.env.LOG_INCLUDE_HOST = origIncHost;
    process.env.LOG_V2_COPY_PASTE = origCopyPaste;
    jest.restoreAllMocks();
  });

  test("includes host by default when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.LOG_INCLUDE_HOST;
    expect(loggingV2.shouldIncludeHostInV2Row()).toBe(true);
    const lines = [];
    jest.spyOn(console, "log").mockImplementation((msg) => lines.push(msg));
    loggingV2.runWithTraceContext({ traceId: "t-host", sessionId: "s-host", service: "chatService" }, () => {
      loggingV2.emitTurnStart({ messageLen: 1 });
    });
    const row = JSON.parse(lines[0]);
    expect(row.host).toBeTruthy();
    expect(row.traceId).toBe("t-host");
    expect(row.sessionId).toBe("s-host");
  });

  test("host omitted in non-prod unless LOG_INCLUDE_HOST=1", () => {
    process.env.NODE_ENV = "test";
    delete process.env.LOG_INCLUDE_HOST;
    expect(loggingV2.shouldIncludeHostInV2Row()).toBe(false);
  });

  test("LOG_INCLUDE_HOST=0 disables host even in production", () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_INCLUDE_HOST = "0";
    expect(loggingV2.shouldIncludeHostInV2Row()).toBe(false);
  });

  test("LOG_V2_COPY_PASTE adds a second line for TURN_SUMMARY", () => {
    jest.isolateModules(() => {
      process.env.LOG_V2_COPY_PASTE = "1";
      const loggingV2Fresh = require("../services/loggingV2");
      const lines = [];
      jest.spyOn(console, "log").mockImplementation((msg) => lines.push(msg));
      loggingV2Fresh.runWithTraceContext(
        { traceId: "t-cp", sessionId: "s-cp", service: "chatService" },
        () => {
          loggingV2Fresh.emitTurnSummary(
            {
              traceId: "t-cp",
              sessionId: "s-cp",
              queryType: "selection",
              intentType: null,
              decision: { action: "clarification", flowId: null, missingSlot: "context" },
              safetyTelemetry: null,
              contextInferenceTelemetry: null,
              artifactVersions: null
            },
            { reply: "ok" },
            "question",
            []
          );
        }
      );
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const summary = JSON.parse(lines[lines.length - 2]);
      expect(summary.event).toBe("TURN_SUMMARY");
      expect(lines[lines.length - 1]).toContain("traceId=t-cp");
      expect(lines[lines.length - 1]).toContain("sessionId=s-cp");
      expect(lines[lines.length - 1]).toContain("event=TURN_SUMMARY");
    });
  });

  test("formatLogLineForCopyPaste builds compact line", () => {
    const line = loggingV2.formatLogLineForCopyPaste({
      ts: "2026-01-01T00:00:00.000Z",
      env: "prod",
      host: "worker-1",
      service: "chatService",
      traceId: "tid",
      sessionId: "sid",
      event: "TURN_SUMMARY",
      meta: {
        outcome: {
          decisionAction: "knowledge",
          outputType: "reply",
          queryType: "procedural"
        }
      }
    });
    expect(line).toMatch(/traceId=tid/);
    expect(line).toMatch(/host=worker-1/);
    expect(line).toMatch(/outcome=knowledge\/reply\/procedural/);
  });
});

describe("loggingV2 emitError", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("ERROR event includes typed AppError fields", () => {
    const lines = [];
    jest.spyOn(console, "log").mockImplementation((msg) => lines.push(msg));

    loggingV2.runWithTraceContext({ traceId: "tr-err", sessionId: "s9" }, () => {
      loggingV2.emitError(
        new AppError("ROUTE_BAD", "bad route", { category: ERROR_CATEGORIES.ROUTING }),
        { stage: "routing" }
      );
    });

    const row = JSON.parse(lines[0]);
    expect(row.logVersion).toBe(2);
    expect(row.event).toBe("ERROR");
    expect(row.stage).toBe("routing");
    expect(row.error).toMatchObject({
      code: "ROUTE_BAD",
      category: "ROUTING",
      message: "bad route"
    });
  });
});
