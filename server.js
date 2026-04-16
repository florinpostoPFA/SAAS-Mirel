require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const config = require("./config");
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
const { logInfo, error: logError } = require("./services/logger");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

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
app.post("/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    const result = await chatService.handleChat({
      message,
      sessionId: sessionId || "test-session"
    });

    res.json({
      reply: result.reply || result.message || "No response"
    });
  } catch (err) {
    logError("SERVER", "Chat error", { error: err.message });
    res.json({
      reply: "A apărut o eroare."
    });
  }
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
app.get("/settings", (req, res) => {
  const settings = settingsService.getSettings();
  res.json(settings);
});

app.post("/settings", (req, res) => {
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
    logInfo("SERVER", { event: "session_cleanup", cleanedCount });
  }
}, 60 * 60 * 1000); // 1 hour

if (require.main === module) {
  app.listen(config.server.port, () => {
    logInfo("SERVER", { event: "startup", port: config.server.port });
  });
}

module.exports = app;
