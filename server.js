require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");

const { searchProducts } = require("./services/search");
const { buildPrompt } = require("./services/promptBuilder");
const { getSettings, saveSettings } = require("./services/settingsService");
const { askLLM } = require("./services/llm");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const products = JSON.parse(fs.readFileSync("./data/products.json"));

function getClient(api_key) {
  return { id: "client1" };
}

// 📊 DATA
let stats = {
  conversations: 0,
  keywords: {},
  products: {}
};

let clicks = [];
let conversions = [];
let timeline = [];

// 💬 CHAT
app.post("/chat", async (req, res) => {
  try {
    const { message, api_key } = req.body;

    stats.conversations++;

    // timeline tracking
    timeline.push({
      time: Date.now()
    });

    // keywords
    const words = message.toLowerCase().split(" ");
    words.forEach(w => {
      if (!stats.keywords[w]) stats.keywords[w] = 0;
      stats.keywords[w]++;
    });

    const client = getClient(api_key);
    const settings = getSettings(client.id);

    let found = searchProducts(message, products);

    if (found.length === 0) {
      found = products.slice(0, 2);
    }

    found.forEach(p => {
      if (!stats.products[p.name]) stats.products[p.name] = 0;
      stats.products[p.name]++;
    });

    const prompt = buildPrompt({
      message,
      products: found,
      settings
    });

    const reply = await askLLM(prompt);

    res.json({ reply, products: found });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 🖱 CLICK
app.post("/track-click", (req, res) => {
  const { product, session_id } = req.body;

  clicks.push({
    product,
    session_id,
    time: Date.now()
  });

  res.sendStatus(200);
});

// 💰 CONVERSION
app.post("/track-conversion", (req, res) => {
  const { session_id, value } = req.body;

  conversions.push({
    session_id,
    value,
    time: Date.now()
  });

  res.sendStatus(200);
});

// 💸 revenue calc
function calculateRevenue() {
  return conversions.reduce((sum, c) => sum + c.value, 0);
}

// 📊 stats
app.get("/stats", (req, res) => {
  res.json({
    conversations: stats.conversations,
    keywords: stats.keywords,
    products: stats.products,
    clicks: clicks.length,
    conversions: conversions.length,
    revenue: calculateRevenue(),
    timeline
  });
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

app.listen(process.env.PORT, () => {
  console.log("🚀 running on http://localhost:" + process.env.PORT);
});
