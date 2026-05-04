/**
 * Single authority for slot completeness (which slot is missing for CTO surface rules).
 */

const { canonicalizeObjectValue } = require("./cleaningObjectCanonical");

const CTO_SURFACE_ENUM = ["textile", "piele", "plastic", "alcantara"];
const CTO_SURFACE_SET = new Set(CTO_SURFACE_ENUM);

function getMissingSlot(slots) {
  const slotSource = slots && typeof slots === "object" ? slots : {};
  console.log("GET_MISSING_SLOT_INPUT", slotSource);

  const hasContext =
    slotSource.context !== null &&
    slotSource.context !== undefined &&
    String(slotSource.context).trim() !== "";
  const hasObject =
    slotSource.object !== null &&
    slotSource.object !== undefined &&
    String(slotSource.object).trim() !== "";
  const surfRaw =
    slotSource.surface !== null && slotSource.surface !== undefined
      ? String(slotSource.surface).trim()
      : "";
  const hasCtoSurface = surfRaw !== "" && CTO_SURFACE_SET.has(surfRaw.toLowerCase());

  if (!hasContext) return "context";
  if (!hasObject) return "object";

  const ctx = String(slotSource.context || "").toLowerCase();
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
    if (obj === "caroserie" && !surfRaw) return "surface";
    if ((obj === "jante" || obj === "roti" || obj === "wheels" || obj === "anvelope") && !surfRaw) {
      return "surface";
    }
    return null;
  }

  if (!surfRaw) return "surface";
  return null;
}

module.exports = {
  getMissingSlot,
  CTO_SURFACE_ENUM,
  CTO_SURFACE_SET
};
