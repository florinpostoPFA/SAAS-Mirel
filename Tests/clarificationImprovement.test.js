const request = require("supertest");

process.env.API_KEY = "test-api-key";

const API_KEY = process.env.API_KEY;

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

const app = require("../server");

const postChat = (message, sessionId) =>
  request(app)
    .post("/chat")
    .set("x-api-key", API_KEY)
    .send({ message, sessionId });

describe("Clarification improvement prompts", () => {
  it("asks improved surface clarification prompt", async () => {
    const res = await postChat(
      "Ce recomanzi pentru scaune?",
      `clarif-surface-${Date.now()}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.reply).toContain("Este textil, piele sau plastic?");
    expect(res.body.reply).toContain("spune-mi modelul masinii");
  });

  it("asks improved object clarification prompt", async () => {
    const res = await postChat(
      "Vreau ceva pentru interior textil",
      `clarif-object-${Date.now()}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.reply).toContain("Ce vrei sa cureti mai exact?");
    expect(res.body.reply).toContain("(ex: scaune, bord, geamuri)");
  });

  it("asks improved context clarification prompt", async () => {
    const res = await postChat(
      "Recomanda un coating ceramic pentru masina",
      `clarif-context-${Date.now()}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.reply).toContain("Este interior sau exterior?");
  });
});
