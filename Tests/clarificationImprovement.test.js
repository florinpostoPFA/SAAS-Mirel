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
    expect(res.body.reply).toContain("Ce suprafata este: textile, piele, plastic sau alcantara?");
    expect(res.body.reply).toContain("Nu esti sigur?");
  });

  it("does not ask interior/exterior when piele surface is explicit", async () => {
    const res = await postChat(
      "ce balsam pentru piele auto",
      `clarif-piele-infer-${Date.now()}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.reply).not.toContain("Este interior sau exterior?");
  });

  it("coating ceramic defaults to exterior, does NOT ask interior/exterior", async () => {
    const res = await postChat(
      "Recomanda un coating ceramic pentru masina",
      `clarif-context-${Date.now()}`
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.reply).not.toContain("Este interior sau exterior?");
  });
});
