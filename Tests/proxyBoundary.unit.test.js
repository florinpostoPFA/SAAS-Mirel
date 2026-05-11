const { envTruthy, apiProxyObservability } = require("../services/proxyBoundary");

describe("proxyBoundary envTruthy", () => {
  afterEach(() => {
    delete process.env.FOO_FLAG;
  });

  test("defaults false when unset", () => {
    delete process.env.FOO_FLAG;
    expect(envTruthy("FOO_FLAG", false)).toBe(false);
  });

  test("treats 1 as true", () => {
    process.env.FOO_FLAG = "1";
    expect(envTruthy("FOO_FLAG", false)).toBe(true);
  });
});

describe("apiProxyObservability middleware", () => {
  test("sets headers and logs on finish", () => {
    const lines = [];
    const logger = {
      logInfo(tag, data) {
        lines.push({ tag, data });
      }
    };
    const mw = apiProxyObservability(logger);

    const headers = {};
    const finishFns = [];
    const req = {
      method: "GET",
      originalUrl: "/api/version",
      url: "/version",
      get() {
        return undefined;
      },
      ip: "10.0.0.1",
      socket: { remoteAddress: "127.0.0.1" }
    };
    const res = {
      statusCode: 200,
      setHeader(k, v) {
        headers[k.toLowerCase()] = v;
      },
      on(ev, fn) {
        if (ev === "finish") {
          finishFns.push(fn);
        }
      }
    };

    mw(req, res, () => {
      finishFns.forEach((fn) => fn());
    });

    expect(headers["x-request-id"]).toBeDefined();
    expect(headers["x-upstream-path"]).toBe("/api/version");
    expect(lines.some((l) => l.tag === "HTTP_API" && l.data.status === 200)).toBe(true);
  });
});
