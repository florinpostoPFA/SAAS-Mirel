/**
 * Single authority for slot completeness (which slot is missing for CTO surface rules).
 */

const { canonicalizeObjectValue } = require("./cleaningObjectCanonical");

const CTO_SURFACE_ENUM = ["textile", "piele", "plastic", "alcantara"];
const CTO_SURFACE_SET = new Set(CTO_SURFACE_ENUM);

// Inherent context inference: surfaces/objects that are unambiguously interior or exterior.
// Used to skip the "Este interior sau exterior?" clarification when the answer is obvious.
const INHERENT_INTERIOR = new Set([
  "textile",
  "piele",
  "plastic",
  "alcantara",
  "interior_plastic",
  "mocheta",
  "bord",
  "tapiterie"
]);

const INHERENT_EXTERIOR = new Set([
  "jante",
  "wheels",
  "anvelope",
  "tires",
  "caroserie",
  "vopsea",
  "geam_exterior",
  "parbriz",
  "glass",
  "geam",
  "geamuri",
  "sticla"
]);

// Object values that are themselves surfaces. When surface is null but object is one of these,
// treat the object value as the effective surface so we don't ask a redundant "which surface?" question.
const OBJECT_AS_SURFACE = new Set([
  "anvelope",
  "jante",
  "wheels",
  "tires",
  "mocheta",
  "bord",
  "tapiterie",
  "parbriz",
  "geam",
  "geamuri",
  "glass"
]);

function inferContextFromSlots(surfRaw, objRaw) {
  const s = String(surfRaw || "")
    .trim()
    .toLowerCase();
  const o = String(objRaw || "")
    .trim()
    .toLowerCase();
  if (INHERENT_INTERIOR.has(s)) return "interior";
  if (INHERENT_EXTERIOR.has(s)) return "exterior";
  if (INHERENT_INTERIOR.has(o)) return "interior";
  if (INHERENT_EXTERIOR.has(o)) return "exterior";
  return null;
}

function inferSurfaceFromObject(objRaw) {
  const o = String(objRaw || "")
    .trim()
    .toLowerCase();
  return OBJECT_AS_SURFACE.has(o) ? o : null;
}

function getMissingSlot(slots) {
  const slotSource = slots && typeof slots === "object" ? slots : {};
  console.log("GET_MISSING_SLOT_INPUT", slotSource);

  const rawContext = slotSource.context;
  const surfRaw =
    slotSource.surface !== null && slotSource.surface !== undefined
      ? String(slotSource.surface).trim()
      : "";
  const effectiveSurface =
    surfRaw !== "" ? surfRaw : inferSurfaceFromObject(slotSource.object) || "";

  // Infer context from inherent-context surfaces/objects when caller didn't set it.
  const hasRawContext =
    rawContext !== null && rawContext !== undefined && String(rawContext).trim() !== "";
  const effectiveContext = hasRawContext
    ? String(rawContext).trim().toLowerCase()
    : inferContextFromSlots(surfRaw, slotSource.object);

  const hasContext = effectiveContext != null && effectiveContext !== "";
  const hasObject =
    slotSource.object !== null &&
    slotSource.object !== undefined &&
    String(slotSource.object).trim() !== "";
  const effectiveSurfLower = effectiveSurface.toLowerCase();
  const hasCtoSurface =
    effectiveSurface !== "" && CTO_SURFACE_SET.has(effectiveSurfLower);
  const hasInherentSurface =
    effectiveSurface !== "" &&
    (INHERENT_INTERIOR.has(effectiveSurfLower) || INHERENT_EXTERIOR.has(effectiveSurfLower));

  if (!hasContext) return "context";
  if (!hasObject && !hasCtoSurface && !hasInherentSurface) return "object";

  const ctx = effectiveContext;
  const obj = canonicalizeObjectValue(slotSource.object);

  if (ctx === "interior") {
    if (obj === "glass" || obj === "jante" || obj === "anvelope" || obj === "caroserie") {
      return null;
    }
    if (obj === "mocheta" || obj === "bord") {
      return null;
    }
    if (!hasCtoSurface) return "surface";
    return null;
  }

  if (ctx === "exterior") {
    const glassObjects = new Set(["glass", "geam", "parbriz", "oglinzi", "oglinda"]);
    if (glassObjects.has(obj)) {
      return null;
    }
    if (obj === "caroserie" && !effectiveSurface) return "surface";
    if (
      (obj === "jante" || obj === "roti" || obj === "wheels" || obj === "anvelope") &&
      !effectiveSurface
    ) {
      return "surface";
    }
    return null;
  }

  if (!effectiveSurface) return "surface";
  return null;
}

module.exports = {
  getMissingSlot,
  CTO_SURFACE_ENUM,
  CTO_SURFACE_SET,
  inferContextFromSlots,
  inferSurfaceFromObject,
  INHERENT_INTERIOR,
  INHERENT_EXTERIOR,
  OBJECT_AS_SURFACE
};
