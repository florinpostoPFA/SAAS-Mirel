/**
 * Golden baselines run in a fresh Node process so chatService loads with stubbed
 * LLM / flow / interactionLog (same as scripts/golden-replay.js).
 */
const { execSync } = require("child_process");
const path = require("path");

test("golden replay baselines match", () => {
  const root = path.join(__dirname, "..");
  const script = path.join(root, "scripts", "golden-replay.js");
  execSync(`node "${script}"`, {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, GOLDEN_REPLAY: "1" }
  });
});
