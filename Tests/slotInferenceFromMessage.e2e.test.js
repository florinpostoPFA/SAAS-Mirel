"use strict";

const request = require("supertest");

process.env.API_KEY = "test-api-key";

const API_KEY = process.env.API_KEY;

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/logger", () => {
  const actual = jest.requireActual("../services/logger");
  return {
    ...actual,
    logInfo: jest.fn((...args) => actual.logInfo(...args))
  };
});

const { askLLM } = require("../services/llm");
const { executeFlow } = require("../services/flowExecutor");
const { appendInteractionLine } = require("../services/interactionLog");
const logger = require("../services/logger");
const app = require("../server");

function lastInteraction() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

function pipelineStagesFromCalls() {
  return logger.logInfo.mock.calls
    .filter((c) => c[0] === "CHAT_PIPELINE_STAGE")
    .map((c) => c[1].pipelineStage);
}

function assertNotContextSurfaceClarification(res, entry) {
  const missing = entry?.decision?.missingSlot ?? res.body?.decision?.missingSlot;
  expect(missing).not.toBe("context");
  expect(missing).not.toBe("surface");
  const reply = String(res.body.reply || "").toLowerCase();
  expect(reply).not.toMatch(/interior sau exterior|exterior sau interior/i);
  expect(reply).not.toMatch(/ce suprafat|care suprafat|pentru ce suprafat/i);
}

const postChat = (message, sessionId) =>
  request(app)
    .post("/chat")
    .set("x-api-key", API_KEY)
    .send({ message, sessionId, clientId: "C1" });

describe("slotInferenceFromMessage — friction turns E2E (HTTP)", () => {
  let sessionId;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionId = `token-inf-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    askLLM.mockResolvedValue(
      "Recomand un produs de protectie hidrofoba pentru exterior, aplicat pe suprafata curata."
    );
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow ${flow.flowId}`,
      products: [
        {
          id: "hydro-1",
          name: "Coating Hidrofob Test",
          description: "Protectie hidrofoba exterior.",
          short_description: "Hidrofob.",
          tags: ["exterior", "paint", "coating", "hydrophobic", "protect"]
        }
      ]
    }));
  });

  const FRICTION_E2E = [
    {
      id: 2,
      message: "recomanda un produs hidrofob",
      expectSlots: { context: "exterior", action: "protect" }
    },
    {
      id: 3,
      message: "recomanda-mi o solutie cu efect hidrofob",
      expectSlots: { context: "exterior", action: "protect" }
    },
    {
      id: 4,
      message: "cum curat urmele de calcar de pe caroseria exterioara",
      expectSlots: { context: "exterior", surface: "paint", action: "clean" }
    },
    {
      id: 5,
      message: "pe vopseaua de la exterior",
      expectSlots: { context: "exterior", surface: "paint" },
      slotsMayComeFromExtract: true
    }
  ];

  test.each(FRICTION_E2E)(
    "friction turn $id applies token inference without context/surface clarification",
    async (turn) => {
      const res = await postChat(turn.message, `${sessionId}-${turn.id}`);

      expect(res.statusCode).toBe(200);
      const entry = lastInteraction();
      assertNotContextSurfaceClarification(res, entry);

      if (!turn.slotsMayComeFromExtract) {
        expect(entry?.tokenInferenceApplied).toBe(true);
        expect(Array.isArray(entry?.tokenInferenceMatches)).toBe(true);
        expect(entry.tokenInferenceMatches.length).toBeGreaterThan(0);
      }

      for (const [slotKey, slotValue] of Object.entries(turn.expectSlots)) {
        expect(entry?.slots?.[slotKey]).toBe(slotValue);
        if (!turn.slotsMayComeFromExtract) {
          expect(
            entry.tokenInferenceMatches.some(
              (m) => m.slotKey === slotKey && m.slotValue === slotValue
            )
          ).toBe(true);
        }
      }

      if (!turn.slotsMayComeFromExtract) {
        expect(pipelineStagesFromCalls()).toContain("token_inference");
        expect(
          logger.logInfo.mock.calls.some(
            (c) => c[0] === "TOKEN_SLOT_INFERENCE" && c[1]?.applied === true
          )
        ).toBe(true);
      }
    }
  );
});
