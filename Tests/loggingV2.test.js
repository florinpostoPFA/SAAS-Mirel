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
