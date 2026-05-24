/**
 * Step 5f — narrow categoryPath guard for tire intent only.
 */
const normalize = require("../utils/normalize");

const config = { USE_CATEGORYPATH_TIRE_GUARD: true };

const TIRE_ROLE_IDS = new Set(["tire_dressing", "tire_cleaner"]);

/** Unicode-normalized substring patterns (Step 5e + 5f ticket). */
const TIRE_PATH_PATTERN =
  /cauciucuri\s*&?\s*bandouri|solutii\s+pentru\s+cauciucuri|anvelop|cauciuc|tire|bandouri/i;

function matchesTireCategoryPath(product) {
  const path = normalize(product?.categoryPath || "");
  if (!path) return false;
  return TIRE_PATH_PATTERN.test(path);
}

function isTireRoleId(roleId) {
  return roleId != null && TIRE_ROLE_IDS.has(String(roleId));
}

function shouldApplyTireCategoryPathGuard({ roleId, surface } = {}) {
  if (!config.USE_CATEGORYPATH_TIRE_GUARD) return false;
  if (isTireRoleId(roleId)) return true;
  if (String(surface || "") === "tires") return true;
  return false;
}

/**
 * Empty categoryPath → pass through (existing tag/name logic).
 * Non-empty non-tire path → reject when guard active.
 */
function productPassesTireCategoryPathGuard(product) {
  const path = String(product?.categoryPath || "").trim();
  if (!path) return true;
  return matchesTireCategoryPath(product);
}

/**
 * Restrict candidate pool for tire role / tire surface.
 * Falls back to full pool if restriction would yield zero candidates.
 */
function applyTireCategoryPathPoolGuard(products, context = {}, logFn = null) {
  const list = Array.isArray(products) ? products : [];
  if (!shouldApplyTireCategoryPathGuard(context)) return list;

  const restricted = list.filter(productPassesTireCategoryPathGuard);
  if (restricted.length === 0 && list.length > 0) {
    if (typeof logFn === "function") {
      logFn("CATEGORYPATH_TIRE_GUARD_FALLBACK", {
        roleId: context.roleId || null,
        surface: context.surface || null,
        inputCount: list.length
      });
    }
    return list;
  }
  return restricted;
}

module.exports = {
  get USE_CATEGORYPATH_TIRE_GUARD() {
    return config.USE_CATEGORYPATH_TIRE_GUARD;
  },
  set USE_CATEGORYPATH_TIRE_GUARD(value) {
    config.USE_CATEGORYPATH_TIRE_GUARD = Boolean(value);
  },
  TIRE_ROLE_IDS,
  TIRE_PATH_PATTERN,
  matchesTireCategoryPath,
  isTireRoleId,
  shouldApplyTireCategoryPathGuard,
  productPassesTireCategoryPathGuard,
  applyTireCategoryPathPoolGuard
};
