/**
 * Surface assist feature flag: OR across env, persisted settings, and config snapshot.
 */

function parseEnvSurfaceAssistRaw(env) {
  const envObj = env && typeof env === "object" ? env : process.env;
  if (!Object.prototype.hasOwnProperty.call(envObj, "SURFACE_ASSIST_ENABLED")) {
    return { raw: null, enabled: false };
  }
  const rawVal = envObj.SURFACE_ASSIST_ENABLED;
  if (rawVal === undefined || rawVal === null) {
    return { raw: null, enabled: false };
  }
  const str = String(rawVal);
  if (str.trim() === "") {
    return { raw: "", enabled: false };
  }
  const v = str.toLowerCase().trim();
  const enabled = v === "true" || v === "1" || v === "yes" || v === "on";
  return { raw: str, enabled };
}

function computeSurfaceAssistEnabled({ env = process.env, settings = null, config: cfg = null } = {}) {
  const { raw: rawEnvValue, enabled: envEnabled } = parseEnvSurfaceAssistRaw(env);
  const settingsEnabled = Boolean(
    settings &&
      typeof settings === "object" &&
      settings.surface_assist_enabled === true
  );
  const configEnabled = Boolean(
    cfg &&
      typeof cfg === "object" &&
      cfg.features &&
      cfg.features.surface_assist_enabled === true
  );
  const effective = Boolean(envEnabled || settingsEnabled || configEnabled);
  return {
    effective,
    enabledSources: {
      env: envEnabled,
      settings: settingsEnabled,
      config: configEnabled
    },
    rawEnvValue
  };
}

function isSurfaceAssistEnabled(options = {}) {
  return computeSurfaceAssistEnabled(options).effective;
}

function envIndicatesSurfaceAssistEnabled(env = process.env) {
  return parseEnvSurfaceAssistRaw(env).enabled;
}

module.exports = {
  parseEnvSurfaceAssistRaw,
  computeSurfaceAssistEnabled,
  isSurfaceAssistEnabled,
  envIndicatesSurfaceAssistEnabled
};
