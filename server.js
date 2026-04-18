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
const { logInfo, error: logError, warn: logWarn } = require("./services/logger");


const rateLimit = require("express-rate-limit");
const app = express();
const API_KEY = process.env.API_KEY;
export default function ProductAIDashboard() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi, I’m Turbo. How can I help you today?"
    }
  ]);

  const [input, setInput] = useState("");

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const response = await fetch("https://postosaas.com/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input })
      });
      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply }
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error contacting server" }
      ]);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center py-10 px-4">
      {/* ...existing code... */}
    </div>
  );
}
app.use(cors());
app.use(express.json());
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
  try {
    const { message, sessionId, feedback } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Te rog să scrii un mesaj pentru asistent." });
    }
    if (message.length > 500) {
      return res.status(400).json({ error: "Mesaj prea lung. Te rog să reformulezi." });
    }

    const result = await chatService.handleChat({
      message,
      sessionId: sessionId || "test-session",
      feedback
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
    logInfo("SERVER", { event: "session_cleanup", cleanedCount });
  }
}, 60 * 60 * 1000); // 1 hour

if (require.main === module) {
  if (!API_KEY) {
    logWarn("SERVER", "API_KEY is not configured. Protected routes will reject all requests.");
  }

  app.listen(config.server.port, () => {
    logInfo("SERVER", { event: "startup", port: config.server.port });
  });
}

module.exports = app;
