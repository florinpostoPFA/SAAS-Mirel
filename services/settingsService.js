const config = require("../config");

let settingsDB = {
  client1: config.defaultSettings
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
