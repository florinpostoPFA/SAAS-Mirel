"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PRODUCTS_PATH = path.join(ROOT, "data", "products.json");
const ROLES_PATH = path.join(ROOT, "data", "product_roles.json");
const FLOWS_DIR = path.join(ROOT, "flows");

let cachedVersions = null;

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function shortSha256(input) {
  return sha256(input).slice(0, 12);
}

function hashFile(filePath) {
  return shortSha256(fs.readFileSync(filePath));
}

function computeFlowsVersion() {
  const flowFiles = fs
    .readdirSync(FLOWS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const manifest = flowFiles
    .map((name) => {
      const filePath = path.join(FLOWS_DIR, name);
      return `${name}:${hashFile(filePath)}`;
    })
    .join("\n");

  return shortSha256(manifest);
}

function computeArtifactVersions() {
  return {
    catalogVersion: hashFile(PRODUCTS_PATH),
    rolesVersion: hashFile(ROLES_PATH),
    flowsVersion: computeFlowsVersion()
  };
}

function getArtifactVersions() {
  if (cachedVersions) {
    return cachedVersions;
  }

  try {
    cachedVersions = Object.freeze(computeArtifactVersions());
  } catch (error) {
    cachedVersions = Object.freeze({
      catalogVersion: "unavailable",
      rolesVersion: "unavailable",
      flowsVersion: "unavailable"
    });
  }

  return cachedVersions;
}

module.exports = {
  getArtifactVersions
};
