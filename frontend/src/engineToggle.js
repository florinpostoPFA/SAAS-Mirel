/** Runtime toggle: posto_engine_v0=true routes chat to POST /api/expert (V0). */
export const ENGINE_V0_STORAGE_KEY = "posto_engine_v0";

export function isEngineV0Enabled() {
  try {
    return localStorage.getItem(ENGINE_V0_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setEngineV0Enabled(enabled) {
  try {
    if (enabled) {
      localStorage.setItem(ENGINE_V0_STORAGE_KEY, "true");
    } else {
      localStorage.removeItem(ENGINE_V0_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function readEngineV0Enabled() {
  return isEngineV0Enabled();
}
