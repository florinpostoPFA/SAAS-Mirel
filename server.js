require("dotenv").config();
const fs = require("fs");
const path = require("path");

const deployVersionEnvPath = path.join(__dirname, "deploy-version.env");
if (fs.existsSync(deployVersionEnvPath)) {
  require("dotenv").config({ path: deployVersionEnvPath, override: true });
}

const express = require("express");
const cors = require("cors");

const config = require("./config");
const { computeSurfaceAssistEnabled } = require("./services/surfaceAssistFeature");
const chatService = require("./services/chatService");
const { autoTagProduct } = require("./services/autoTagService");
const settingsService = require("./services/settingsService");
const {
  incrementConversation,
  trackKeywords,
  trackProducts,
  getStats
} = require("./services/statsService");
const {
  trackClick,
  trackConversion,
  trackTimeline,
  getClicks,
  getConversions,
  getTimeline
} = require("./services/trackingService");
const logger = require("./services/logger");
const { normalizeChatSessionIdFromBody } = require("./services/chatSessionId");
const { getArtifactVersions } = require("./services/artifactVersions");
const { getDeployVersion } = require("./services/deployVersion");
const { validateFeedbackPayload, appendFeedbackRow } = require("./services/feedbackService");
const { applyTrustProxy, apiProxyObservability } = require("./services/proxyBoundary");
const loggingV2 = require("./services/loggingV2");
const { appendInteractionLine } = require("./services/interactionLog");

const surfaceAssistStartup = computeSurfaceAssistEnabled({
  env: process.env,
  settings: settingsService.getSettings(),
  config
});
logger.logInfo("SURFACE_ASSIST_FEATURE_STARTUP", {
  effective: surfaceAssistStartup.effective,
  enabledSources: surfaceAssistStartup.enabledSources,
  rawEnvValue: surfaceAssistStartup.rawEnvValue
});

const rateLimit = require("express-rate-limit");
const app = express();
const API_KEY = process.env.API_KEY;

applyTrustProxy(app);

app.use((req, res, next) => {
  const { sha } = getDeployVersion();
  res.setHeader("x-backend-sha", sha);
  next();
});

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "x-request-id"],
  exposedHeaders: [
    "x-backend-sha",
    "x-request-id",
    "x-upstream-path"
  ]
}));
app.use(express.json());

app.use("/api", apiProxyObservability(logger));

app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type,x-api-key,x-request-id");
    res.header(
      "Access-Control-Expose-Headers",
      "x-backend-sha,x-request-id,x-upstream-path"
    );
    return res.sendStatus(204);
  }
  next();
});
app.use(express.static("public"));

const FRONTEND_BUILD_PATH = path.join(__dirname, "frontend", "build");
const FRONTEND_INDEX = path.join(FRONTEND_BUILD_PATH, "index.html");
const frontendBuildExists = fs.existsSync(FRONTEND_INDEX);
if (frontendBuildExists) {
  app.use(express.static(FRONTEND_BUILD_PATH, { redirect: false }));
}

function checkApiKey(req, res, next) {
  const apiKey = req.header("x-api-key");

  if (!API_KEY || !apiKey || apiKey !== API_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  next();
}

function loadProducts() {
  const filePath = path.join(__dirname, "data", "products.json");
  const data = fs.readFileSync(filePath, "utf-8");
  const products = JSON.parse(data);

  return products.map(product => ({
    ...product,
    aiTags: autoTagProduct(product)
  }));
}

const productsCatalog = loadProducts();

function getClient(api_key) {
  return { id: config.server.defaultClientId };
}

function mapStageToPhase(stage) {
  const s = String(stage || "").toLowerCase();
  if (s.includes("intent")) return "intent";
  if (s.includes("slot")) return "slots";
  if (s.includes("route")) return "routing";
  if (s.includes("search") || s.includes("retriev")) return "retrieval";
  if (s.includes("reply") || s.includes("llm")) return "assistant_reply";
  return "unknown";
}

function buildErrorInteractionEntry({ message, sessionId, error, traceId, phase }) {
  return {
    sessionId,
    traceId,
    level: "ERROR",
    phase: phase || "unknown",
    service: "server",
    env: process.env.NODE_ENV === "production" ? "prod" : "dev",
    message: typeof message === "string" ? message : "",
    assistantReply: "A apărut o eroare.",
    decision: {
      action: "error",
      flowId: null,
      missingSlot: null,
      hardGuardFallback: false
    },
    output: {
      type: "error",
      products: [],
      productsLength: 0,
      productsReason: "exception_fallback"
    },
    intent: {
      queryType: null,
      type: null,
      tags: null
    },
    error: {
      message: error && error.message ? String(error.message) : String(error),
      name: error && error.name ? String(error.name) : "Error"
    }
  };
}

async function appendInteractionLineWithTimeout(entry, timeoutMs = 1000) {
  await Promise.race([
    Promise.resolve().then(() => appendInteractionLine(entry)),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`interaction_log_timeout_${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

async function emitGlobalErrorTurnLog({ stage, error, sessionId, message }) {
  const traceId = loggingV2.createTraceId({ sessionId });
  const phase = mapStageToPhase(stage);
  await loggingV2.runWithTraceContext(
    { traceId, sessionId, service: "server" },
    async () => {
      loggingV2.emitError(error, { stage });
      const entry = buildErrorInteractionEntry({ message, sessionId, error, traceId, phase });
      try {
        await appendInteractionLineWithTimeout(entry, 1000);
      } catch (logErr) {
        console.error(
          JSON.stringify({
            loggerFailed: true,
            stage,
            phase,
            traceId,
            sessionId,
            logError: logErr && logErr.message ? String(logErr.message) : String(logErr),
            originalError: error && error.message ? String(error.message) : String(error)
          })
        );
      }
    }
  );
}

// 💬 CHAT
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: "Prea multe cereri. Încearcă din nou peste un minut." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.EVAL_REPLAY === "1"
});
app.post("/chat", chatLimiter, async (req, res) => {
  let canonicalSessionId;
  let currentPhase = "intent";
  try {
    const { message, feedback } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Te rog să scrii un mesaj pentru asistent." });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: "Mesaj prea lung. Te rog să reformulezi." });
    }

    const normalized = normalizeChatSessionIdFromBody(req.body);
    canonicalSessionId = normalized.canonicalSessionId;
    if (normalized.prodWarnTestSession && process.env.NODE_ENV === "production") {
      logger.warn("SERVER", "Chat session id rejected (test-session) in production; assigned new id", {
        badSessionId: true,
        originalValue: "test-session",
        path: req.path
      });
    }

    currentPhase = "assistant_reply";
    const result = await chatService.handleChat({
      message,
      sessionId: canonicalSessionId,
      feedback
    });

    res.json({
      reply: result.reply || result.message || "No response",
      sessionId: canonicalSessionId,
      traceId: result.traceId != null ? result.traceId : null,
      decision: result.decisionTrace != null ? result.decisionTrace : null
    });
  } catch (err) {
    logger.error("SERVER", "Chat error", { error: err.message });
    const sessionIdForClient =
      canonicalSessionId != null && String(canonicalSessionId).length > 0
        ? canonicalSessionId
        : require("crypto").randomUUID();
    await emitGlobalErrorTurnLog({
      stage: currentPhase,
      error: err,
      sessionId: sessionIdForClient,
      message: req.body && typeof req.body.message === "string" ? req.body.message : ""
    });
    res.json({
      reply: "A apărut o eroare.",
      sessionId: sessionIdForClient,
      traceId: null
    });
  }
});

app.post("/feedback", (req, res) => {
  const validation = validateFeedbackPayload(req.body);
  if (!validation.ok) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  appendFeedbackRow(validation.value);
  return res.status(200).json({ ok: true });
});

// 🖱 CLICK
app.post("/track-click", (req, res) => {
  const { product, session_id } = req.body;
  trackClick(product, session_id);
  res.sendStatus(200);
});

// 💰 CONVERSION
app.post("/track-conversion", (req, res) => {
  const { session_id, value } = req.body;
  trackConversion(session_id, value);
  res.sendStatus(200);
});

// 📊 stats
app.get("/stats", (req, res) => {
  res.json(getStats(getClicks(), getConversions(), getTimeline()));
});

// ⚙️ settings
app.get("/settings", checkApiKey, (req, res) => {
  const settings = settingsService.getSettings();
  res.json(settings);
});

app.post("/settings", checkApiKey, (req, res) => {
  settingsService.saveSettings(req.body);
  res.json({ success: true });
});

app.get("/products", (req, res) => {
  const products = loadProducts();
  res.json(products);
});

// health
app.get("/health", (req, res) => {
  res.send("OK");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true, path: "/api/health" });
});

app.get("/api/version", (req, res) => {
  res.json(getDeployVersion());
});

// SPA fallback: any unmatched GET that doesn't look like a file
// returns the React app's index.html so client-side routing can handle it
// (e.g. direct navigation / hard refresh on /blog/<slug>).
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api/")) return next();
  if (path.extname(req.path)) return next();
  if (!frontendBuildExists) return next();
  res.sendFile(FRONTEND_INDEX);
});

// Session cleanup - run every hour
const { cleanupOldSessions } = require("./services/sessionService");
setInterval(() => {
  const cleanedCount = cleanupOldSessions();
  if (cleanedCount > 0) {
    logger.logInfo("SERVER", { event: "session_cleanup", cleanedCount });
  }
}, 60 * 60 * 1000); // 1 hour

if (require.main === module) {
  if (!API_KEY) {
    logger.warn("SERVER", "API_KEY is not configured. Protected routes will reject all requests.");
  }

  app.listen(config.server.port, () => {
    const artifactVersions = getArtifactVersions();
    const deployVersion = getDeployVersion();
    logger.logInfo("ARTIFACT_VERSIONS", artifactVersions);
    logger.logInfo("SERVER", {
      event: "startup",
      port: config.server.port,
      deploySha: deployVersion.sha,
      deployBuildTime: deployVersion.buildTime || null
    });
  });
}

module.exports = app;
