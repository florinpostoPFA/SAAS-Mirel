const sessions = {};

function getSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      state: "IDLE",
      tags: [],
      activeProducts: [],
      lastResponse: null
    };
  }

  return sessions[sessionId];
}

function saveSession(sessionId, sessionData) {
  sessions[sessionId] = sessionData;
}

module.exports = {
  getSession,
  saveSession
};
