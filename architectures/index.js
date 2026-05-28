"use strict";

/**
 * Pluggable routing architecture registry (eval harness v0).
 *
 * Contract:
 *   { name, version, applyTurn({ session, message, slotMeta, catalogVersion, rolesVersion, flowsVersion }),
 *     resetSessionState?() }
 */

const REGISTRY = Object.freeze({
  current: () => require("./current"),
  candidateA: () => require("./candidateA")
});

function listArchitectures() {
  return Object.keys(REGISTRY);
}

function getArchitecture(name) {
  const key = String(name || "").trim();
  const factory = REGISTRY[key];
  if (!factory) {
    throw new Error(
      `Unknown architecture "${name}". Available: ${listArchitectures().join(", ")}`
    );
  }
  const mod = factory();
  if (!mod || typeof mod.applyTurn !== "function") {
    throw new Error(`Architecture "${name}" does not implement applyTurn`);
  }
  return mod;
}

module.exports = {
  listArchitectures,
  getArchitecture
};
