const config = require("../config");

const defaultConversationRules = config.defaultSettings.conversation_rules || {
  greeting: {
    enabled: true,
    response: "Salut! Cu ce te pot ajuta?",
    show_products: false
  }
};

let settingsDB = {
  client1: config.defaultSettings
};

function mergeConversationRules(clientRules) {
  return {
    ...defaultConversationRules,
    ...(clientRules || {})
  };
}

function getSettings(clientId) {
  const base = settingsDB[clientId] || {};
  return {
    ...config.defaultSettings,
    ...base,
    conversation_rules: mergeConversationRules(base.conversation_rules)
  };
}

function saveSettings(clientId, newSettings) {
  const base = settingsDB[clientId] || config.defaultSettings;
  const merged = {
    ...base,
    ...newSettings,
    conversation_rules: mergeConversationRules(newSettings.conversation_rules || base.conversation_rules)
  };

  settingsDB[clientId] = merged;
}

module.exports = { getSettings, saveSettings };
