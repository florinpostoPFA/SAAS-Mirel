/**
 * Top 25 prompt suite runs in a fresh Node process (same pattern as golden replay)
 * so chatService loads with stubbed LLM / flow / interactionLog.
 */
const { execSync } = require("child_process");
const path = require("path");

test("top 25 prompts regression suite passes", () => {
  const root = path.join(__dirname, "..");
  const script = path.join(root, "scripts", "top25-regression.js");
  execSync(`node "${script}"`, {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, GOLDEN_REPLAY: "1" }
  });
});
