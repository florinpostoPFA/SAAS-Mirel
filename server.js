require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");

const config = require("./config");
const { handleChat } = require("./services/chatService");
const { getSettings, saveSettings } = require("./services/settingsService");
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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const productsCatalog = JSON.parse(fs.readFileSync("./data/products.json"));

function getClient(api_key) {
  return { id: config.server.defaultClientId };
}

// 💬 CHAT
app.post("/chat", async (req, res) => {
  try {
    const { message, api_key } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    const client = getClient(api_key);

    // Track conversation
    incrementConversation();
    trackTimeline();
    trackKeywords(message);

    // Handle chat - pass catalog as products
    const { reply, products: recommendedProducts } = await handleChat(message, client.id, productsCatalog);

    // Track products mentioned
    trackProducts(recommendedProducts);

    res.json({ reply, products: recommendedProducts });
  } catch (err) {
    console.error("Chat error:", err);
    const errorMessage = err.message || "Server error";
    res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === "development" ? err.stack : undefined
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
  const client = getClient(req.query.api_key);
  res.json(getSettings(client.id));
});

app.post("/settings", (req, res) => {
  const { api_key, settings } = req.body;
  const client = getClient(api_key);

  saveSettings(client.id, settings);

  res.json({ success: true });
});

// health
app.get("/health", (req, res) => {
  res.send("OK");
});

app.listen(config.server.port, () => {
  console.log("🚀 running on http://localhost:" + config.server.port);
});
