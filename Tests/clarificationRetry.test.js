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

describe("Clarification retry hint", () => {
  it("adds retry hint after two clarification turns", async () => {
    const sessionId = `clarif-retry-${Date.now()}`;

    const first = await postChat("Ce recomanzi pentru scaune?", sessionId);
    expect(first.statusCode).toBe(200);
    expect(first.body.reply).not.toContain("descrie problema si te ajut eu");

    const second = await postChat("nu stiu", sessionId);
    expect(second.statusCode).toBe(200);
    expect(second.body.reply).toContain("Daca nu esti sigur, descrie problema si te ajut eu.");
  });
});
