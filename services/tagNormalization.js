const TAG_ALIAS_MAP = Object.freeze({
  geam: "glass",
  geamuri: "glass",
  parbriz: "glass",
  sticla: "glass",
  oglinda: "glass",
  janta: "wheels",
  jante: "wheels",
  wheel: "wheels",
  rim: "wheels",
  piele: "leather",
  textil: "textile",
  textile: "textile",
  fabric: "textile",
  tire: "tires",
  anvelopa: "tires",
  anvelope: "tires"
});

const STRICT_FILTER_NOISE_TAGS = new Set([
  "interior",
  "exterior",
  "cleaning",
  "protection",
  "shine",
  "restoration",
  "smell",
  "grease"
]);

const PRODUCT_TAG_OVERRIDES = Object.freeze({
  // Deterministic overrides for known edge SKUs can be defined here:
  // "sku-or-id": ["glass", "cleaning"]
});

function normalizeSingleTag(tag) {
  const raw = String(tag || "").trim().toLowerCase();
  if (!raw) return "";
  return TAG_ALIAS_MAP[raw] || raw;
}

function normalizeTagList(tags) {
  const input = Array.isArray(tags) ? tags : [];
  const out = [];
  const seen = new Set();
  for (const tag of input) {
    const normalized = normalizeSingleTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function dropStrictFilterNoise(tags) {
  return normalizeTagList(tags).filter((tag) => !STRICT_FILTER_NOISE_TAGS.has(tag));
}

function resolveProductOverrideTags(product) {
  const p = product && typeof product === "object" ? product : {};
  const forcedTags = Array.isArray(p.forcedTags) ? p.forcedTags : [];
  const id = String(p.id || p.sku || p.code || "").trim();
  const overrideTags = id && Array.isArray(PRODUCT_TAG_OVERRIDES[id]) ? PRODUCT_TAG_OVERRIDES[id] : [];
  return normalizeTagList([...forcedTags, ...overrideTags]);
}

function applyProductTagOverrides(baseTags, product) {
  return normalizeTagList([...normalizeTagList(baseTags), ...resolveProductOverrideTags(product)]);
}

module.exports = {
  PRODUCT_TAG_OVERRIDES,
  TAG_ALIAS_MAP,
  normalizeSingleTag,
  normalizeTagList,
  dropStrictFilterNoise,
  resolveProductOverrideTags,
  applyProductTagOverrides
};
