/**
 * Turbo product selection backbone — deterministic hybrid pipeline.
 *
 * ## Roles (hard constraints)
 * - **interior_exterior**: `passesStrictFilters` from search (e.g. interior query excludes tire-only SKUs).
 * - **tag_overlap** (optional): when `constraints.strictTagFilter` is true, product tags must intersect routing tags.
 * - **stock_ok**: exclude `stock === 0` or `available === false` when those fields exist.
 * - **slot_object**: coarse compatibility when `slots.object` is set (jante / glass).
 *
 * ## Ranking (soft, deterministic)
 * - Weighted integer score: tag match base, keyword hits, intent–product-type alignment, conversionRate, price fit.
 * - **No wall-clock recency** in this module (stable across runs).
 * - **Tie-breakers**: higher score first, then `String(productId).localeCompare`, then catalog index order.
 *
 * ## Hybrid composition
 * 1. Build candidate **pool** from catalog (tag match pre-score, capped by `poolSize`).
 * 2. **Filter** by roles → `candidates` (each with `roleMatches[]`, `reasons[]`).
 * 3. If none pass and `fallbackStrategy` is `relaxed_roles`, retry with only stock + optional slot (skip strict tag / strict interior filter once).
 * 4. If still empty, **catalog order fallback**: first `limit` products by stable id sort with reason `fallback:catalog_order`.
 * 5. **Rank** within role-approved set (unless `constraints.ranking === false` → stable id order only).
 * 6. **Choose** top `limit` → `chosen` with merged `reasons` and `scoreBreakdown`.
 *
 * ## Downstream contract
 * `chosen[]` items are catalog-shaped objects plus `score`, `selectionMeta` for `applyRanking` short-circuit.
 */

const { logInfo } = require("./logger");
const {
  normalizeProduct,
  analyzeProductMatch,
  passesStrictFilters,
  extractKeywords,
  detectIntentType,
  detectProductType
} = require("./search");
const { calculatePriceFit } = require("./rankingService");

const PIPELINE = "unified";

function stableProductId(product) {
  return String(product?.id ?? product?.name ?? "").trim();
}

function normalizeTagList(tags) {
  return (tags || []).map((t) => String(t).toLowerCase()).filter(Boolean);
}

function normalizeProductTags(product) {
  const p = normalizeProduct(product);
  return (p.tags || p.aiTags || []).map((t) => String(t).toLowerCase());
}

function passesStock(product) {
  if (product == null) return true;
  if (product.available === false) return false;
  if (product.stock != null && Number(product.stock) === 0) return false;
  if (product.quantity != null && Number(product.quantity) === 0) return false;
  return true;
}

function canonicalizeObjectSlot(obj) {
  const o = String(obj || "").toLowerCase().trim();
  if (["jante", "roti", "wheels"].includes(o)) return "jante";
  if (["anvelope", "tires", "tyres", "tire"].includes(o)) return "anvelope";
  if (["glass", "geam", "parbriz", "sticla"].includes(o)) return "glass";
  return o || null;
}

/**
 * Coarse slot–SKU compatibility (hard gate when slots present).
 */
function passesSlotObjectRole(product, slots) {
  if (!slots || typeof slots !== "object") return true;
  const obj = canonicalizeObjectSlot(slots.object);
  if (!obj) return true;

  const tags = normalizeProductTags(product);
  const text = `${product.name || ""} ${product.description || ""}`.toLowerCase();

  if (obj === "jante") {
    if (tags.includes("interior") && !tags.includes("exterior")) return false;
    if (
      tags.includes("tire") &&
      !tags.some((t) => ["wheels", "wheel_cleaner", "metal"].includes(t))
    ) {
      return false;
    }
    const ok =
      tags.some((t) =>
        ["wheels", "wheel_cleaner", "exterior", "metal", "cleaning", "cleaner"].includes(t)
      ) || text.includes("jante") || text.includes("wheel");
    return ok;
  }
  if (obj === "anvelope") {
    const ok =
      tags.some((t) =>
        ["tires", "rubber", "dressing", "exterior", "protection", "wheel_cleaner"].includes(t)
      ) ||
      text.includes("anvelop") ||
      text.includes("tire") ||
      text.includes("cauciuc");
    return ok;
  }
  if (obj === "glass") {
    const ok =
      tags.includes("glass") ||
      text.includes("geam") ||
      text.includes("parbriz") ||
      text.includes("sticla");
    return ok;
  }
  return true;
}

function evaluateRoles(product, { tags, slots, constraints }) {
  const roleMatches = [];
  const reasons = [];
  const userTags = normalizeTagList(tags);

  if (!passesStock(product)) {
    return { ok: false, roleMatches, reasons: [...reasons, "stock:unavailable"] };
  }
  roleMatches.push("stock_ok");
  reasons.push("role:stock_ok");

  const strictInterior =
    constraints.applyInteriorExteriorFilter !== false;
  if (strictInterior && !passesStrictFilters(product, userTags)) {
    return {
      ok: false,
      roleMatches,
      reasons: [...reasons, "interior_exterior:excluded"]
    };
  }
  if (strictInterior) {
    roleMatches.push("interior_exterior");
    reasons.push("role:interior_exterior_ok");
  }

  if (constraints.strictTagFilter === true && userTags.length > 0) {
    const pt = normalizeProductTags(product);
    const hit = userTags.some((t) => pt.includes(t));
    if (!hit) {
      return {
        ok: false,
        roleMatches,
        reasons: [...reasons, "tag_overlap:required_failed"]
      };
    }
    roleMatches.push("tag_overlap");
    reasons.push("role:tag_overlap");
  }

  if (constraints.applySlotObjectFilter !== false && !passesSlotObjectRole(product, slots)) {
    return {
      ok: false,
      roleMatches,
      reasons: [...reasons, "slot_object:incompatible"]
    };
  }
  if (slots && slots.object) {
    roleMatches.push("slot_object");
    reasons.push("role:slot_object_ok");
  }

  return { ok: true, roleMatches, reasons };
}

function computeRankScore(product, ctx) {
  const breakdown = {};
  const userTags = normalizeTagList(ctx.tags);
  const msg = String(ctx.message || "").toLowerCase();
  const analyzed = analyzeProductMatch(normalizeProduct(product), userTags);
  let total = 0;

  breakdown.tagMatch = analyzed.score;
  total += analyzed.score * 100;

  const keywords = extractKeywords(ctx.message || "");
  const name = String(product.name || "").toLowerCase();
  const shortD = String(product.short_description || "").toLowerCase();
  const desc = String(product.description || "").toLowerCase();
  let kw = 0;
  for (const kwRaw of keywords) {
    if (name.includes(kwRaw)) kw += 3;
    else if (shortD.includes(kwRaw)) kw += 2;
    else if (desc.includes(kwRaw)) kw += 1;
  }
  breakdown.keywords = kw;
  total += kw * 10;

  const intentType = detectIntentType(msg);
  if (intentType) {
    const pType = detectProductType(product);
    if (pType === intentType) {
      breakdown.intentAlign = 10;
      total += 1000;
    } else if (pType != null) {
      breakdown.intentAlign = -5;
      total -= 500;
    } else {
      breakdown.intentAlign = 0;
    }
  }

  const conv = Number(product.conversionRate || 0);
  breakdown.conversion = conv;
  total += Math.round(conv * 2000);

  if (ctx.priceRange && ctx.priceRange.min != null && ctx.priceRange.max != null) {
    const pf = calculatePriceFit(product, ctx);
    breakdown.priceFit = pf;
    total += Math.round(pf * 300);
  }

  breakdown.total = total;
  return { total, breakdown, analyzed };
}

function buildCatalogIndex(catalog) {
  const m = new Map();
  (catalog || []).forEach((p, i) => {
    const id = stableProductId(p);
    if (!m.has(id)) m.set(id, i);
  });
  return m;
}

function buildPool(catalog, userTags, poolSize) {
  const safe = Array.isArray(catalog) ? catalog.map((p) => normalizeProduct(p)) : [];
  if (safe.length === 0) return [];

  const scored = safe.map((product) => {
    const analyzed = analyzeProductMatch(product, userTags);
    return { product: { ...product, ...analyzed }, baseScore: analyzed.score };
  });

  const catalogIndex = buildCatalogIndex(safe);
  scored.sort((a, b) => {
    if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;
    const ida = stableProductId(a.product);
    const idb = stableProductId(b.product);
    const c = ida.localeCompare(idb);
    if (c !== 0) return c;
    return (catalogIndex.get(ida) ?? 0) - (catalogIndex.get(idb) ?? 0);
  });

  return scored.slice(0, Math.min(poolSize, scored.length)).map((s) => s.product);
}

function stripInternalFields(p) {
  const { score: _s, matchedTags: _m, selectionMeta: _sm, ...rest } = p;
  return rest;
}

/**
 * @param {object} params
 * @returns {{ candidates: object[], ranked: object[], chosen: object[], debug?: object }}
 */
function selectProducts(params) {
  const {
    tags = [],
    message = "",
    slots = {},
    catalog = [],
    limit = 3,
    constraints = {},
    settings = {},
    session: _session = null,
    intent: _intent = null
  } = params;

  const debugEnabled = process.env.PRODUCT_SELECTION_DEBUG === "1";
  const userTags = normalizeTagList(tags);
  const poolSize = constraints.poolSize ?? 40;
  const rankingEnabled = constraints.ranking !== false;
  const fallbackStrategy = constraints.fallbackStrategy || "relaxed_roles";

  const catalogIndex = buildCatalogIndex(catalog);
  const safeCatalog = Array.isArray(catalog) ? catalog.map((p) => normalizeProduct(p)) : [];

  const pool =
    constraints.strictTagFilter === true && userTags.length > 0
      ? safeCatalog.slice(0, Math.min(300, safeCatalog.length))
      : buildPool(catalog, userTags, poolSize);

  const ctx = {
    tags: userTags,
    message,
    priceRange: constraints.priceRange || settings?.priceRange || null
  };

  function runRolePass(relaxed) {
    const c = {
      strictTagFilter: relaxed ? false : constraints.strictTagFilter === true,
      applyInteriorExteriorFilter: relaxed
        ? false
        : constraints.applyInteriorExteriorFilter !== false,
      applySlotObjectFilter: constraints.applySlotObjectFilter !== false
    };
    const out = [];
    for (const raw of pool) {
      const product = normalizeProduct(raw);
      const ev = evaluateRoles(product, { tags: userTags, slots, constraints: c });
      if (ev.ok) {
        out.push({
          product,
          roleMatches: ev.roleMatches,
          reasons: ev.reasons
        });
      }
    }
    return out;
  }

  let candidates = runRolePass(false);
  let fallbackUsed = null;

  if (candidates.length === 0 && fallbackStrategy === "relaxed_roles") {
    candidates = runRolePass(true);
    if (candidates.length > 0) fallbackUsed = "relaxed_roles";
  }

  if (candidates.length === 0) {
    const sorted = [...(catalog || [])]
      .map((p) => normalizeProduct(p))
      .sort((a, b) => stableProductId(a).localeCompare(stableProductId(b)));
    const take = sorted.slice(0, limit).map((product) => ({
      product,
      roleMatches: ["fallback_catalog_order"],
      reasons: ["fallback:no_role_pass_catalog_order"]
    }));
    candidates = take;
    fallbackUsed = "catalog_order";
  }

  let rankedRows = candidates.map((c) => {
    const { total, breakdown } = rankingEnabled
      ? computeRankScore(c.product, ctx)
      : { total: 0, breakdown: { total: 0, note: "ranking_disabled" } };
    return {
      product: c.product,
      roleMatches: c.roleMatches,
      reasons: [...c.reasons],
      total,
      breakdown
    };
  });

  rankedRows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const ida = stableProductId(a.product);
    const idb = stableProductId(b.product);
    const cmp = ida.localeCompare(idb);
    if (cmp !== 0) return cmp;
    return (catalogIndex.get(ida) ?? 0) - (catalogIndex.get(idb) ?? 0);
  });

  const ranked = rankedRows.map((r) => {
    const clean = stripInternalFields(normalizeProduct(r.product));
    const productId = stableProductId(clean);
    return {
      ...clean,
      productId,
      score: r.total,
      scoreBreakdown: r.breakdown,
      roleMatches: r.roleMatches,
      reasons: r.reasons
    };
  });

  const chosen = ranked.slice(0, limit).map((r) => ({
    ...r,
    reasons: [
      ...r.reasons,
      rankingEnabled ? `rank:score_${r.score}` : "rank:stable_order"
    ],
    selectionMeta: {
      pipeline: PIPELINE,
      productId: r.productId,
      roleMatches: r.roleMatches,
      scoreBreakdown: r.scoreBreakdown,
      fallback: fallbackUsed
    }
  }));

  const debug = debugEnabled
    ? {
        poolSize: pool.length,
        candidateCount: candidates.length,
        chosenIds: chosen.map((c) => stableProductId(c)),
        topBreakdown: chosen[0]?.scoreBreakdown || null,
        fallback: fallbackUsed
      }
    : undefined;

  if (debugEnabled) {
    logInfo("PRODUCT_SELECTION_DEBUG", debug);
  }

  const candidatePayload = candidates.map((c) => ({
    productId: stableProductId(c.product),
    roleMatches: c.roleMatches,
    reasons: c.reasons
  }));

  return {
    candidates: candidatePayload,
    ranked,
    chosen,
    debug
  };
}

module.exports = {
  selectProducts,
  evaluateRoles,
  passesSlotObjectRole,
  stableProductId,
  PIPELINE
};
