let settingsDB = {
  client1: {
    tone: "friendly",
    max_products: 2,
    cta: "Vezi produsul",
    strategy: "upsell",
    provider: "openai",

    // 🔥 nou
    delay_recommendation: true
  }
};

function getSettings(clientId) {
  return settingsDB[clientId];
}

function saveSettings(clientId, newSettings) {
  settingsDB[clientId] = {
    ...settingsDB[clientId],
    ...newSettings
  };
}

module.exports = { getSettings, saveSettings };
