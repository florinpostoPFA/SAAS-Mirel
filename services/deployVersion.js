/**
 * Deploy identity for production verification (GIT_SHA / BUILD_TIME from env or deploy-version.env).
 */
function getDeployVersion() {
  const shaRaw = process.env.GIT_SHA;
  const timeRaw = process.env.BUILD_TIME;
  const sha =
    typeof shaRaw === "string" && shaRaw.trim() ? shaRaw.trim() : "unknown";
  const buildTime =
    typeof timeRaw === "string" && timeRaw.trim() ? timeRaw.trim() : "";
  return { sha, buildTime };
}

module.exports = { getDeployVersion };
