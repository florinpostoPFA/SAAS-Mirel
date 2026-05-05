require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

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
const { validateFeedbackPayload, appendFeedbackRow } = require("./services/feedbackService");

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
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"]
}));
app.use(express.json());
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type,x-api-key");
    return res.sendStatus(204);
  }
  next();
});
app.use(express.static("public"));

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

// 💬 CHAT
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: "Prea multe cereri. Încearcă din nou peste un minut." },
  standardHeaders: true,
  legacyHeaders: false
});
app.post("/chat", chatLimiter, async (req, res) => {
  let canonicalSessionId;
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
    logger.logInfo("ARTIFACT_VERSIONS", artifactVersions);
    logger.logInfo("SERVER", { event: "startup", port: config.server.port });
  });
}

module.exports = app;
