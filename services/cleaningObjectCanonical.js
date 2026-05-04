/**
 * Canonical object labels for cleaning-domain routing (shared by slot completeness and chat).
 */

const GLASS_OBJECT_ALIASES = [
  "sticla",
  "geam",
  "geamuri",
  "parbriz",
  "glass",
  "windshield",
  "oglinda",
  "oglinzi",
  "mirror",
  "mirrors"
];

const PAINT_OBJECT_ALIASES = [
  "vopsea",
  "vopseaua",
  "caroserie",
  "caroseria",
  "lac",
  "clear coat",
  "clearcoat",
  "paint"
];

function normalizeRomanianTextForGate(text) {
  let s = String(text || "").toLowerCase();
  s = s.replace(/[ăâ]/g, "a").replace(/î/gi, "i").replace(/[șş]/g, "s").replace(/[țţ]/g, "t");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function canonicalizeObjectValue(object) {
  const normalized = normalizeRomanianTextForGate(object);
  if (!normalized) {
    return null;
  }

  if (normalized === "janta" || normalized === "jante") {
    return "jante";
  }

  if (
    normalized === "roata" ||
    normalized === "roti" ||
    normalized === "rotile" ||
    normalized === "wheels" ||
    normalized === "wheel"
  ) {
    return "jante";
  }

  if (normalized === "anvelopa" || normalized === "anvelope") {
    return "anvelope";
  }

  if (GLASS_OBJECT_ALIASES.includes(normalized)) {
    return "glass";
  }

  if (["tires", "tyres", "tire"].includes(normalized)) {
    return "anvelope";
  }

  if (PAINT_OBJECT_ALIASES.includes(normalized)) {
    return "caroserie";
  }

  return normalized;
}

module.exports = {
  normalizeRomanianTextForGate,
  canonicalizeObjectValue,
  GLASS_OBJECT_ALIASES,
  PAINT_OBJECT_ALIASES
};
