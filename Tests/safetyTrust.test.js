jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { executeFlow } = require("../services/flowExecutor");
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");
const fixtures = require("./safetyTrustFixtures.json");

function lastLogEntry() {
  const calls = appendInteractionLine.mock.calls;
  return calls[calls.length - 1][0];
}

/** P1.9 safety template prefix — assertions target the answer-first core line. */
function safetyBodyForReplyAssertions(reply) {
  let t = String(reply || "").trim();
  t = t.replace(/^—\s*Siguranță\s*—\s*\n?/i, "");
  return t.trim();
}

describe("Safety trust patch (Option A)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Raspuns LLM.");
    executeFlow.mockImplementation((flow) => ({
      reply: `Flow: ${flow.flowId}`,
      products: [{ id: 1, name: "Test", tags: [] }]
    }));
  });

  fixtures.forEach((f) => {
    it(f.id, async () => {
      const sessionId = `safety-fixture-${f.id}-${Date.now()}`;
      const steps = f.sessionPrep || [{ message: f.message }];
      let result;
      const flowCallsAfterEachStep = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const llmBefore = askLLM.mock.calls.length;
        result = await handleChat(step.message, "C1", [], sessionId);
        flowCallsAfterEachStep.push(executeFlow.mock.calls.length);
        if (f.id === "apc-piele-natural-merge" && i === steps.length - 1) {
          expect(askLLM.mock.calls.length).toBe(llmBefore);
        }
      }

      const log = lastLogEntry();
      const reply = String(result.reply || result.message || "");
      const ex = f.expect || {};

      if (ex.decisionAction != null) {
        expect(log.decision.action).toBe(ex.decisionAction);
      }
      if (ex.queryType != null) {
        expect(log.intent.queryType).toBe(ex.queryType);
      }
      if (ex.askedClarification != null) {
        expect(Boolean(log.askedClarification)).toBe(ex.askedClarification);
      }
      if (ex.blockedProductRouting != null) {
        expect(Boolean(log.blockedProductRouting)).toBe(ex.blockedProductRouting);
      }
      if (ex.safetyAnswerType != null) {
        expect(log.safetyAnswerType).toBe(ex.safetyAnswerType);
      }
      if (ex.replyHasQuestion) {
        expect(reply).toMatch(/\?/);
      }
      if (ex.replyStartsAnswerFirst) {
        const body = safetyBodyForReplyAssertions(reply);
        expect(/^(DEPINDE|DA|NU)[.\s]/i.test(body)).toBe(true);
      }
      if (ex.replyStartsWithNu) {
        const body = safetyBodyForReplyAssertions(reply);
        expect(/^NU[.\s]/i.test(body)).toBe(true);
      }
      if (ex.questionCountMax != null) {
        const n = (reply.match(/\?/g) || []).length;
        expect(n).toBeLessThanOrEqual(ex.questionCountMax);
      }
      if (ex.productsLength != null) {
        expect(Array.isArray(result.products) ? result.products.length : 0).toBe(ex.productsLength);
        expect(log.output.productsLength).toBe(ex.productsLength);
      }
      if (ex.noProductPitch) {
        expect(reply.toLowerCase()).not.toMatch(/iata recomand|recomandările|• soluție/i);
      }
      if (ex.executeFlowFlatSecondTurn) {
        expect(flowCallsAfterEachStep.length).toBeGreaterThanOrEqual(2);
        expect(flowCallsAfterEachStep[flowCallsAfterEachStep.length - 1]).toBe(flowCallsAfterEachStep[0]);
      }
    });
  });

  it("does not invoke executeFlow on a standalone safety turn", async () => {
    const sessionId = `safety-standalone-${Date.now()}`;
    const before = executeFlow.mock.calls.length;
    await handleChat("Pot folosi APC pe piele naturala?", "C1", [], sessionId);
    expect(executeFlow.mock.calls.length).toBe(before);
  });
});
