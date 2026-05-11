const request = require("supertest");

process.env.API_KEY = process.env.API_KEY || "test-api-key";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { getDeployVersion } = require("../services/deployVersion");

describe("getDeployVersion", () => {
  const origSha = process.env.GIT_SHA;
  const origTime = process.env.BUILD_TIME;

  afterEach(() => {
    if (origSha === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = origSha;
    if (origTime === undefined) delete process.env.BUILD_TIME;
    else process.env.BUILD_TIME = origTime;
  });

  test("returns unknown sha when GIT_SHA unset", () => {
    delete process.env.GIT_SHA;
    delete process.env.BUILD_TIME;
    expect(getDeployVersion()).toEqual({ sha: "unknown", buildTime: "" });
  });

  test("returns trimmed env values", () => {
    process.env.GIT_SHA = "  abc12  ";
    process.env.BUILD_TIME = " 2026-05-11T00:00:00Z ";
    expect(getDeployVersion()).toEqual({
      sha: "abc12",
      buildTime: "2026-05-11T00:00:00Z"
    });
  });
});

describe("GET /api/version", () => {
  const app = require("../server");

  test("returns JSON with sha and buildTime keys", async () => {
    const res = await request(app).get("/api/version");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        sha: expect.any(String),
        buildTime: expect.any(String)
      })
    );
    expect(res.headers["x-backend-sha"]).toBe(res.body.sha);
  });
});
