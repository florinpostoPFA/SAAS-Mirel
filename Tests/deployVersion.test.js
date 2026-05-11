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

describe("GET /api/health", () => {
  const app = require("../server");
  const logger = require("../services/logger");

  test("returns JSON contract for proxy /api/ prefix", async () => {
    const res = await request(app).get("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      path: "/api/health"
    });
    expect(res.headers["x-backend-sha"]).toBeDefined();
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(res.headers["x-upstream-path"]).toContain("/api/health");
  });

  test("echoes incoming x-request-id and emits HTTP_API log on finish", async () => {
    const spy = jest.spyOn(logger, "logInfo");
    const res = await request(app)
      .get("/api/health")
      .set("x-request-id", "edge-test-123");

    expect(res.headers["x-request-id"]).toBe("edge-test-123");
    expect(spy).toHaveBeenCalledWith(
      "HTTP_API",
      expect.objectContaining({
        requestId: "edge-test-123",
        method: "GET",
        path: "/api/health",
        status: 200
      })
    );
    spy.mockRestore();
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
