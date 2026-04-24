const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "../data/settings.json");

const DEFAULT_SETTINGS = {
  max_products: 3,
  delay_recommendation: true,
  tone: "friendly",
  response_style: "persuasive",
  sales_mode: "soft",
  ask_questions: true,
  max_questions: 2,
  greeting_enabled: true,
  surface_assist_enabled: false,
  tagRules: "",
  cta: "Vezi produsul",
  fallback_message: "Hai sa vedem cum te pot ajuta mai bine. Spune-mi, te intereseaza curatare interior, exterior sau alt tip de produs?"
};

function getSettings() {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(data);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed
    };
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

function getClientSettings(clientId) {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(data);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed
    };
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  const incoming = settings && typeof settings === "object" ? settings : {};
  const merged = {
    ...getSettings(),
    ...incoming
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
}

module.exports = {
  getSettings,
  getClientSettings,
  saveSettings,
};
