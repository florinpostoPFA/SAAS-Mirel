"use strict";

process.env.API_KEY = "test-api-key";
process.env.EVAL_REPLAY = "1";

jest.mock("../../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../../services/logger", () => ({
  logInfo: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const fs = require("fs");
const path = require("path");

const { askLLM } = require("../../services/llm");
const { executeFlow } = require("../../services/flowExecutor");
const { applyTurn, resetSessionState } = require("../../architectures/current");
const { getArchitecture } = require("../../architectures");

const FIXTURE_CORPUS = path.join(__dirname, "fixtures", "replaySmokeCorpus.jsonl");
const FIXTURE_DETERMINISM = path.join(__dirname, "fixtures", "replayDeterminism5.jsonl");
const SMOKE_SESSION_ID = "6c0f1348-cc59-43b8-8616-472a1fccbe0b";

function readFixtureLines() {
  return fs
    .readFileSync(FIXTURE_CORPUS, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function expectResultShape(row) {
  expect(typeof row.corpusFile).toBe("string");
  expect(typeof row.turnIdx).toBe("number");
  expect(row.input).toMatchObject({
    message: expect.any(String),
    catalogVersion: expect.any(String),
    rolesVersion: expect.any(String),
    flowsVersion: expect.any(String)
  });
  for (const key of ["context", "surface", "object"]) {
    expect(row.input.currentSlots).toHaveProperty(key);
    expect(row.slotsAfter).toHaveProperty(key);
  }
  expect(row.decision).toHaveProperty("action");
  expect(row.output).toMatchObject({ reply: expect.any(String) });
  expect(typeof row.wallclockMs).toBe("number");
  expect(row.error).toBeUndefined();
}

function normalizeDeterminismRows(rows) {
  return rows.map((row) => {
    const clean = { ...row };
    delete clean.wallclockMs;
    return clean;
  });
}

async function runFiveTurnSliceRun(runIdx) {
  const lines = fs
    .readFileSync(FIXTURE_DETERMINISM, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  const { seedGoldenConversationSession } = require("../../services/sessionStore");
  const sessionId = `determinism-6c0f1348-run-${runIdx}`;
  let session = {
    sessionId,
    slots: { ...lines[0].currentSlots }
  };
  seedGoldenConversationSession(sessionId, { slots: session.slots });

  const rows = [];
  for (const turn of lines) {
    const archResult = await applyTurn({
      session,
      message: turn.message,
      catalogVersion: turn.catalogVersion,
      rolesVersion: turn.rolesVersion,
      flowsVersion: turn.flowsVersion
    });
    rows.push({
      corpusFile: "session_6c0f1348.jsonl",
      turnIdx: turn.turnIdx,
      input: {
        message: turn.message,
        currentSlots: turn.currentSlots,
        catalogVersion: turn.catalogVersion,
        rolesVersion: turn.rolesVersion,
        flowsVersion: turn.flowsVersion
      },
      slotsAfter: archResult.slotsAfter,
      decision: archResult.decision,
      output: archResult.output,
      wallclockMs: archResult.wallclockMs,
      ...(archResult.error ? { error: archResult.error } : {})
    });
  }
  return rows;
}

describe("eval runReplay smoke", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSessionState();
    askLLM.mockResolvedValue(
      "Recomand un produs potrivit pentru cerinta ta, cu aplicare pe suprafata curata."
    );
    executeFlow.mockImplementation(async (flow) => ({
      reply: `Flow ${flow?.flowId || "unknown"}`,
      products: [{ id: "smoke-1", name: "Produs smoke", tags: ["exterior"] }]
    }));
  });

  it("registry loads current architecture", () => {
    const arch = getArchitecture("current");
    expect(arch.name).toBe("current");
    expect(typeof arch.applyTurn).toBe("function");
  });

  it("candidateA stub throws", async () => {
    const arch = getArchitecture("candidateA");
    await expect(
      arch.applyTurn({
        session: { sessionId: "x", slots: {} },
        message: "test",
        catalogVersion: "bf2ca471f202",
        rolesVersion: "f701d80d60f4",
        flowsVersion: "8a40fae83864"
      })
    ).rejects.toThrow("candidateA not implemented — Step D");
  });

  it("replays 3 fixture turns through current without throw", async () => {
    const lines = readFixtureLines();
    expect(lines).toHaveLength(3);

    const { seedGoldenConversationSession } = require("../../services/sessionStore");

    let session = {
      sessionId: SMOKE_SESSION_ID,
      slots: { ...lines[0].currentSlots }
    };
    seedGoldenConversationSession(SMOKE_SESSION_ID, { slots: session.slots });

    const rows = [];

    for (let i = 0; i < lines.length; i++) {
      const turn = lines[i];
      const corpusFile = i < 2 ? "session_6c0f1348.jsonl" : "auditFn10.jsonl";

      if (i === 2) {
        resetSessionState();
        session = {
          sessionId: "eval-auditFn10-turn-0",
          slots: { ...turn.currentSlots }
        };
        seedGoldenConversationSession(session.sessionId, { slots: session.slots });
      }

      const archResult = await applyTurn({
        session,
        message: turn.message,
        catalogVersion: turn.catalogVersion,
        rolesVersion: turn.rolesVersion,
        flowsVersion: turn.flowsVersion
      });

      rows.push({
        corpusFile,
        turnIdx: turn.turnIdx,
        input: {
          message: turn.message,
          currentSlots: turn.currentSlots,
          catalogVersion: turn.catalogVersion,
          rolesVersion: turn.rolesVersion,
          flowsVersion: turn.flowsVersion
        },
        slotsAfter: archResult.slotsAfter,
        decision: archResult.decision,
        output: archResult.output,
        wallclockMs: archResult.wallclockMs,
        ...(archResult.error ? { error: archResult.error } : {})
      });
    }

    expect(rows).toHaveLength(3);
    rows.forEach(expectResultShape);
  });

  it("is deterministic across 3 runs on a 5-turn real slice (ignoring wallclockMs)", async () => {
    resetSessionState();
    const run1 = await runFiveTurnSliceRun(1);
    resetSessionState();
    const run2 = await runFiveTurnSliceRun(2);
    resetSessionState();
    const run3 = await runFiveTurnSliceRun(3);

    expect(run1).toHaveLength(5);
    expect(run2).toHaveLength(5);
    expect(run3).toHaveLength(5);

    const n1 = normalizeDeterminismRows(run1);
    const n2 = normalizeDeterminismRows(run2);
    const n3 = normalizeDeterminismRows(run3);

    expect(JSON.stringify(n1)).toBe(JSON.stringify(n2));
    expect(JSON.stringify(n2)).toBe(JSON.stringify(n3));
  });
});
