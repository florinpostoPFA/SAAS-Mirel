/**
 * Injectable time for deterministic tests / golden replay.
 * When GOLDEN_REPLAY=1, use configureRuntime({ nowMs }) for stable timestamps.
 */

let fixedNowMs = null;

function configureRuntime(options = {}) {
  if (options && options.nowMs != null) {
    fixedNowMs = Number(options.nowMs);
  } else {
    fixedNowMs = null;
  }
}

function resetRuntime() {
  fixedNowMs = null;
}

function getNowMs() {
  if (process.env.GOLDEN_REPLAY === "1" && fixedNowMs != null) {
    return fixedNowMs;
  }
  return Date.now();
}

function getNowIso() {
  return new Date(getNowMs()).toISOString();
}

module.exports = {
  configureRuntime,
  resetRuntime,
  getNowMs,
  getNowIso
};
