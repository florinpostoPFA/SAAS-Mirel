const crypto = require("crypto");

function envTruthy(name, defaultWhenUnset = false) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") {
    return defaultWhenUnset;
  }
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

/**
 * Behind nginx: trust X-Forwarded-* so req.ip and req.protocol are correct.
 */
function applyTrustProxy(app) {
  if (envTruthy("TRUST_PROXY", false)) {
    const hops = Number(process.env.TRUST_PROXY_HOPS || 1);
    app.set("trust proxy", Number.isFinite(hops) && hops > 0 ? hops : 1);
  }
}

/**
 * /api/* only: stable request id, upstream path echo, one structured log line per response.
 */
function apiProxyObservability(logger) {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    const requestId =
      typeof incoming === "string" && incoming.trim()
        ? incoming.trim().slice(0, 128)
        : crypto.randomUUID();

    res.setHeader("x-request-id", requestId);
    res.setHeader("x-upstream-path", req.originalUrl || req.url || "");

    if (envTruthy("PROXY_ACCESS_LOG", true)) {
      const started = Date.now();
      res.on("finish", () => {
        logger.logInfo("HTTP_API", {
          requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          ms: Date.now() - started,
          ip: req.ip || req.socket.remoteAddress || null
        });
      });
    }

    next();
  };
}

module.exports = { applyTrustProxy, apiProxyObservability, envTruthy };
