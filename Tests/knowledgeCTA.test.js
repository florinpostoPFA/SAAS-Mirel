const request = require("supertest");

process.env.API_KEY = "test-api-key";

const API_KEY = process.env.API_KEY;

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const app = require("../server");
const chatService = require("../services/chatService");
const { askLLM } = require("../services/llm");
const { appendSoftKnowledgeCtaIfEligible } = chatService.__test;
const { appendInteractionLine } = require("../services/interactionLog");

const postChat = (message, sessionId) =>
  request(app)
    .post("/chat")
    .set("x-api-key", API_KEY)
    .send({ message, sessionId });

describe("Soft CTA in knowledge replies", () => {
  it("appends CTA when decision is knowledge and products are empty", () => {
    const out = appendSoftKnowledgeCtaIfEligible(
      { action: "knowledge" },
      { reply: "Spuma alcalina are putere mare de curatare.", products: [] }
    );

    expect(out.reply).toContain("Daca vrei, iti pot recomanda produsele potrivite.");
  });

  it("does not append CTA when action is not knowledge", () => {
    const out = appendSoftKnowledgeCtaIfEligible(
      { action: "clarification" },
      { reply: "Este interior sau exterior?", products: [] }
    );

    expect(out.reply).toBe("Este interior sau exterior?");
  });

  it("does not append CTA when knowledge already has products", () => {
    const out = appendSoftKnowledgeCtaIfEligible(
      { action: "knowledge" },
      { reply: "Iata recomandarile.", products: [{ id: "p1" }] }
    );

    expect(out.reply).toBe("Iata recomandarile.");
  });

  it("chat route includes CTA for knowledge no-products replies", async () => {
    const sessionId = `knowledge-cta-${Date.now()}`;
    askLLM.mockResolvedValue("pH neutru inseamna o formula mai blanda pentru suprafete sensibile.");
    const res = await postChat("Ce inseamna pH neutru la sampon auto?", sessionId);

    expect(res.statusCode).toBe(200);
    expect(res.body.reply).toContain("Daca vrei, iti pot recomanda produsele potrivite.");

    const calls = appendInteractionLine.mock.calls;
    const last = calls.length ? calls[calls.length - 1][0] : null;
    expect(last?.decision?.action).toBe("knowledge");
  });
});
