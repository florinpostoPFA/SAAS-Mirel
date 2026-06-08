"use strict";

const KNOWN_SLOT_META = new Set(["confirmed", "inferred", "carried"]);

function isSlotKnown(slotMeta, slot, slots) {
  const slotKey = String(slot || "").toLowerCase();
  if (!slotKey) return false;
  const state = String(slotMeta?.[slotKey] || "").toLowerCase();
  if (!state || state === "unknown" || state === "stale") return false;
  if (!KNOWN_SLOT_META.has(state)) return false;
  const value = slots?.[slotKey];
  return value != null && String(value).trim() !== "";
}

function isActionKnown(slotMeta, slots) {
  if (isSlotKnown(slotMeta, "action", slots)) return true;
  const action = String(slots?.action || "").toLowerCase();
  return action !== "" && action !== "unknown";
}

function deriveLeatherCoverageRoleFromAction(slots) {
  const action = String(slots?.action || "").toLowerCase();
  // TODO: extract role-from-action helper
  if (action === "clean") return "leather_cleaner";
  if (action === "protect") return "leather_protectant";
  return null;
}

module.exports = {
  KNOWN_SLOT_META,
  isSlotKnown,
  isActionKnown,
  deriveLeatherCoverageRoleFromAction
};
