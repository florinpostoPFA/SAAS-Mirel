/**
 * Serialize concurrent handleChat calls per sessionId so in-memory session state
 * cannot interleave (last-write-wins corruption).
 */

const { logInfo } = require("./logger");

const chains = new Map();

/**
 * @param {string} sessionId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function runSessionExclusive(sessionId, fn) {
  const key = String(sessionId || "default");
  const prev = chains.get(key);
  if (process.env.SESSION_DEBUG_LOG === "1" && prev) {
    logInfo("SESSION_TURN_QUEUED", { sessionId: key });
  }
  const tail = prev || Promise.resolve();
  const next = tail
    .catch(() => {})
    .then(() => fn());
  chains.set(
    key,
    next.then(
      () => {},
      () => {}
    )
  );
  return next;
}

module.exports = { runSessionExclusive };
