/**
 * Deterministic multi-turn slot correction: pending answers and explicit corrections win;
 * confirmed slots are not silently overwritten.
 */

const { logInfo } = require("./logger");

const SOURCE = "SlotCorrectionService";

const SLOT_KEYS = ["context", "surface", "object"];
const PAINT_OBJECT_REPLY_VALUES = new Set([
  "vopsea",
  "vopseaua",
  "caroserie",
  "caroseria",
  "lac",
  "paint",
  "clear coat",
  "clearcoat"
]);

function normalizeMsg(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

const CORRECTION_RE =
  /\b(nu\b|nu,|ba,|ba\s+|de fapt|mai degraba|mai degrabă|nu exterior|nu interior|not\s+)/i;

function hasExplicitCorrectionPattern(message) {
  return CORRECTION_RE.test(String(message || ""));
}

/**
 * Context when only one side is mentioned, or last mention wins if both (e.g. "nu, interior").
 */
function detectExplicitContextMulti(message) {
  const s = normalizeMsg(message);
  const hi =
    /\b(interior|interioara|interiorul|in interior)\b/.test(s) ||
    s.includes("interiorul");
  const he =
    /\b(exterior|exterioara|exteriorul|in exterior)\b/.test(s) ||
    s.includes("exteriorul");
  if (hi && !he) return "interior";
  if (he && !hi) return "exterior";
  if (hi && he) {
    const interiorIdx = Math.max(
      s.lastIndexOf("interior"),
      s.lastIndexOf("interioara")
    );
    const exteriorIdx = Math.max(
      s.lastIndexOf("exterior"),
      s.lastIndexOf("exterioara")
    );
    if (interiorIdx > exteriorIdx) return "interior";
    if (exteriorIdx > interiorIdx) return "exterior";
  }
  return null;
}

function detectExplicitSurface(message) {
  const s = normalizeMsg(message);
  if (/\b(textil|textile)\b/.test(s)) return "textile";
  if (/\bpiele\b|\bleather\b/.test(s)) return "piele";
  if (/\bplastic\b|\bplastice\b/.test(s)) return "plastic";
  if (/\balcantara\b/.test(s)) return "alcantara";
  if (/\bvopsea\b|\bpaint\b/.test(s)) return "paint";
  if (/\bgeam\b|\bglass\b/.test(s)) return "glass";
  return null;
}

function detectExplicitObject(message) {
  const s = normalizeMsg(message);
  if (/\bcotiera\b/.test(s)) return "cotiera";
  if (/\bmocheta\b/.test(s)) return "mocheta";
  if (/\bscaun(e|ul|elor)?\b/.test(s)) return "scaun";
  if (/\bbord\b/.test(s)) return "bord";
  if (/\bvolan\b/.test(s)) return "volan";
  if (/\bgeam(uri)?\b|\bparbriz\b|\bsticla\b|\bsticlă\b/.test(s)) return "glass";
  if (/\bjante\b|\broti\b|\brotile\b/.test(s)) return "jante";
  if (/\banvelope\b/.test(s)) return "anvelope";
  if (/\bcaroserie\b|\bcaroseria\b|\bvopsea\b|\bvopseaua\b|\blac\b|\bpaint\b|\bclear\s*coat\b|\bclearcoat\b/.test(s)) {
    return "caroserie";
  }
  return null;
}

const CONTEXT_TOKEN_MAP = {
  interior: "interior",
  interiorul: "interior",
  interioara: "interior",
  exterior: "exterior",
  exteriorul: "exterior",
  exterioara: "exterior"
};

const SURFACE_TOKEN_MAP = {
  vopsea: "paint",
  textil: "textile",
  textile: "textile",
  piele: "piele",
  leather: "piele",
  alcantara: "alcantara",
  plastic: "plastic",
  plastice: "plastic"
};

const OBJECT_TOKEN_MAP = {
  parbriz: "glass",
  geam: "glass",
  geamuri: "glass",
  sticla: "glass",
  cotiera: "cotiera",
  mocheta: "mocheta",
  scaun: "scaun",
  bord: "bord",
  vopsea: "caroserie",
  vopseaua: "caroserie",
  caroserie: "caroserie",
  caroseria: "caroserie",
  lac: "caroserie",
  paint: "caroserie",
  clearcoat: "caroserie"
};

function firstMatchingToken(norm, map) {
  const tokens = norm.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const key = t.replace(/[,;.:!?]+$/g, "");
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      return map[key];
    }
  }
  return null;
}

function resolveGlassFromMessage(message) {
  const s = normalizeMsg(message);
  if (
    s.includes("sticla") ||
    s.includes("sticlă") ||
    s.includes("geam") ||
    s.includes("parbriz") ||
    s.includes("windshield")
  ) {
    return "glass";
  }
  return null;
}

/**
 * Bind pending clarification slot from multi-token / correction messages.
 */
function extractPendingSlotBinding(message, pendingQuestion) {
  const pending = pendingQuestion && typeof pendingQuestion === "object"
    ? pendingQuestion
    : null;
  if (!pending) return null;

  const slot = pending.slot;
  if (slot !== "context" && slot !== "surface" && slot !== "object") {
    return null;
  }

  const norm = normalizeMsg(message);

  if (slot === "context") {
    const ctx =
      detectExplicitContextMulti(message) || firstMatchingToken(norm, CONTEXT_TOKEN_MAP);
    if (ctx) return { slot: "context", value: ctx };
  }

  if (slot === "surface") {
    const surf =
      detectExplicitSurface(message) ||
      firstMatchingToken(norm, SURFACE_TOKEN_MAP);
    if (surf) return { slot: "surface", value: surf };
  }

  if (slot === "object") {
    const obj =
      detectExplicitObject(message) ||
      firstMatchingToken(norm, OBJECT_TOKEN_MAP) ||
      resolveGlassFromMessage(message);
    if (obj) return { slot: "object", value: obj };
  }

  return null;
}

function defaultSlotMeta(slotMeta) {
  const base = { context: "unknown", surface: "unknown", object: "unknown" };
  const m = slotMeta && typeof slotMeta === "object" ? slotMeta : {};
  return { ...base, ...m };
}

/**
 * @param {object} params
 * @returns {{
 *   nextSlots: object,
 *   slotMeta: object,
 *   updates: Array<{slot:string,from:unknown,to:unknown,stateFrom:string,stateTo:string}>,
 *   pendingCleared: boolean,
 *   reason: string|null
 * }}
 */
function applyUserCorrection({
  prevSlots,
  newExtraction,
  pendingQuestion,
  message,
  normalizedMessage,
  slotMeta
}) {
  const norm = normalizedMessage != null ? String(normalizedMessage) : normalizeMsg(message);
  const prev =
    prevSlots && typeof prevSlots === "object" ? { ...prevSlots } : {};
  const extracted =
    newExtraction && typeof newExtraction === "object" ? { ...newExtraction } : {};
  const meta = defaultSlotMeta(slotMeta);

  const next = {
    context: prev.context ?? null,
    surface: prev.surface ?? null,
    object: prev.object ?? null,
    vehicleMake: prev.vehicleMake ?? null,
    vehicleModel: prev.vehicleModel ?? null,
    vehicleYear: prev.vehicleYear ?? null
  };

  const updates = [];
  let pendingCleared = false;
  let reason = null;

  const correction = hasExplicitCorrectionPattern(message);

  let pendingBoundSlot = null;
  const pendingBind = extractPendingSlotBinding(message, pendingQuestion);
  if (pendingBind) {
    const ps = pendingBind.slot;
    const stateFrom = meta[ps] || "unknown";
    if (next[ps] !== pendingBind.value) {
      updates.push({
        slot: ps,
        from: next[ps],
        to: pendingBind.value,
        stateFrom,
        stateTo: "confirmed"
      });
    }
    next[ps] = pendingBind.value;
    meta[ps] = "confirmed";
    pendingCleared = true;
    reason = "pending_answer";
    pendingBoundSlot = ps;
    if (
      ps === "object" &&
      pendingBind.value === "caroserie" &&
      PAINT_OBJECT_REPLY_VALUES.has(norm)
    ) {
      // When user answers an object clarification with a paint/body noun ("vopseaua"),
      // keep this turn object-only so normal "missing surface" clarification can continue.
      extracted.surface = null;
    }
    logInfo("SLOT_CORRECTION_TRACE", {
      source: SOURCE,
      reason,
      pendingSlot: pendingQuestion?.slot || null
    });
  }

  if (correction) {
    let touched = false;
    const ctx = detectExplicitContextMulti(message);
    if (ctx && pendingBoundSlot !== "context") {
      const stateFrom = meta.context || "unknown";
      if (next.context !== ctx) {
        updates.push({
          slot: "context",
          from: next.context,
          to: ctx,
          stateFrom,
          stateTo: "confirmed"
        });
      }
      next.context = ctx;
      meta.context = "confirmed";
      touched = true;
    }
    const surf = detectExplicitSurface(message);
    if (surf && pendingBoundSlot !== "surface") {
      const stateFrom = meta.surface || "unknown";
      if (next.surface !== surf) {
        updates.push({
          slot: "surface",
          from: next.surface,
          to: surf,
          stateFrom,
          stateTo: "confirmed"
        });
      }
      next.surface = surf;
      meta.surface = "confirmed";
      touched = true;
    }
    const obj = detectExplicitObject(message);
    if (obj && pendingBoundSlot !== "object") {
      const stateFrom = meta.object || "unknown";
      if (next.object !== obj) {
        updates.push({
          slot: "object",
          from: next.object,
          to: obj,
          stateFrom,
          stateTo: "confirmed"
        });
      }
      next.object = obj;
      meta.object = "confirmed";
      touched = true;
    }
    if (touched) {
      reason = reason || "explicit_correction";
      logInfo("SLOT_CORRECTION_TRACE", { source: SOURCE, reason: "explicit_correction" });
    }
  }

  const pendingSlot = pendingQuestion?.slot;
  for (const key of SLOT_KEYS) {
    if (key === pendingBoundSlot) continue;
    const v = extracted[key];
    if (v == null || v === "") continue;

    if (meta[key] === "confirmed" && !correction && pendingSlot !== key) {
      logInfo("SLOT_CORRECTION_TRACE", {
        source: SOURCE,
        reason: "no_silent_flip",
        slot: key,
        blockedValue: v
      });
      continue;
    }

    if (next[key] !== v) {
      const stateFrom = meta[key] || "unknown";
      const stateTo = meta[key] === "confirmed" ? "confirmed" : "inferred";
      updates.push({
        slot: key,
        from: next[key],
        to: v,
        stateFrom,
        stateTo
      });
      next[key] = v;
      if (meta[key] !== "confirmed") {
        meta[key] = "inferred";
      }
    }
  }

  for (const key of ["vehicleMake", "vehicleModel", "vehicleYear"]) {
    const v = extracted[key];
    if (v == null || v === "") continue;
    if (next[key] == null || next[key] === "") {
      next[key] = v;
    }
  }

  const mergeReason = reason || (updates.length ? "merge_fill" : null);
  return {
    nextSlots: next,
    slotMeta: meta,
    updates,
    pendingCleared,
    reason: mergeReason
  };
}

function mergePendingClarificationNonDestructive(prevSlots, correctionNext) {
  const prev = prevSlots && typeof prevSlots === "object" ? prevSlots : {};
  const next = correctionNext && typeof correctionNext === "object" ? correctionNext : {};
  return {
    context: next.context ?? prev.context ?? null,
    surface: next.surface ?? prev.surface ?? null,
    object: next.object ?? prev.object ?? null,
    vehicleMake: next.vehicleMake ?? prev.vehicleMake ?? null,
    vehicleModel: next.vehicleModel ?? prev.vehicleModel ?? null,
    vehicleYear: next.vehicleYear ?? prev.vehicleYear ?? null
  };
}

function shouldBreakRepeatedAsk(sessionContext, slot) {
  const counts = sessionContext?.clarificationAskCounts;
  if (!counts || typeof counts !== "object") return false;
  return (counts[slot] || 0) >= 1;
}

function recordClarificationAsk(sessionContext, slot) {
  if (!sessionContext || typeof sessionContext !== "object") return;
  sessionContext.clarificationAskCounts = sessionContext.clarificationAskCounts || {};
  sessionContext.clarificationAskCounts[slot] =
    (sessionContext.clarificationAskCounts[slot] || 0) + 1;
  sessionContext.lastAskedClarificationSlot = slot;
}

function resetAskCountForSlot(sessionContext, slot) {
  if (
    sessionContext?.clarificationAskCounts &&
    Object.prototype.hasOwnProperty.call(sessionContext.clarificationAskCounts, slot)
  ) {
    delete sessionContext.clarificationAskCounts[slot];
  }
}

function clearClarificationAskTracking(sessionContext) {
  if (!sessionContext) return;
  delete sessionContext.clarificationAskCounts;
  delete sessionContext.lastAskedClarificationSlot;
}

module.exports = {
  SOURCE,
  normalizeMsg,
  hasExplicitCorrectionPattern,
  detectExplicitContextMulti,
  detectExplicitSurface,
  detectExplicitObject,
  extractPendingSlotBinding,
  applyUserCorrection,
  mergePendingClarificationNonDestructive,
  shouldBreakRepeatedAsk,
  recordClarificationAsk,
  resetAskCountForSlot,
  clearClarificationAskTracking
};
