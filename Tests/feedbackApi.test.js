const request = require("supertest");
const fs = require("fs");

process.env.API_KEY = "test-api-key";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const app = require("../server");

describe("POST /feedback", () => {
  beforeEach(() => {
    jest.spyOn(fs, "appendFileSync").mockImplementation(() => {});
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns 200 on valid payload and appends one JSONL row", async () => {
    const payload = {
      sessionId: "s-1",
      traceId: "t-1",
      rating: "up",
      comment: "helpful answer"
    };

    const res = await request(app).post("/feedback").send(payload);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);

    const appended = fs.appendFileSync.mock.calls[0][1];
    const parsed = JSON.parse(String(appended).trim());
    expect(parsed.sessionId).toBe("s-1");
    expect(parsed.traceId).toBe("t-1");
    expect(parsed.rating).toBe("up");
    expect(parsed.comment).toBe("helpful answer");
    expect(parsed.schemaVersion).toBe(1);
  });

  test("returns 400 when required fields are missing", async () => {
    const res = await request(app).post("/feedback").send({
      sessionId: "s-1",
      rating: "up"
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });

  test("returns 400 when rating is invalid", async () => {
    const res = await request(app).post("/feedback").send({
      sessionId: "s-1",
      traceId: "t-1",
      rating: "meh"
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });
});
