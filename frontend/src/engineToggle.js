/** Runtime toggle: absent or not "false" → V0 /api/expert (default). "false" → legacy /api/chat. */
export const ENGINE_V0_STORAGE_KEY = "posto_engine_v0";

export function isEngineV0Enabled() {
  try {
    return localStorage.getItem(ENGINE_V0_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setEngineV0Enabled(enabled) {
  try {
    if (enabled) {
      localStorage.removeItem(ENGINE_V0_STORAGE_KEY);
    } else {
      localStorage.setItem(ENGINE_V0_STORAGE_KEY, "false");
    }
  } catch {
    /* ignore */
  }
}

export function readEngineV0Enabled() {
  return isEngineV0Enabled();
}
