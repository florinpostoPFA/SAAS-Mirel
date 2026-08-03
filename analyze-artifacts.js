#!/usr/bin/env node

/**
 * Analyze normalized artifacts with Ollama and write Markdown reports to analysis/.
 *
 * Usage:
 *   node analyze-artifacts.js [--force]
 */

const fs = require("fs/promises");
const path = require("path");

const ROOT = __dirname;
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const ANALYSIS_DIR = path.join(ROOT, "analysis");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:30b";
const CONCURRENCY = 2;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

const SYSTEM_PROMPT = `You are a senior software architect.

You are analyzing one engineering artifact.

The artifact has already been parsed into structured JSON.

Do not repeat the JSON.

Instead, analyze it.

Return Markdown using exactly this structure.

# Executive Summary

What was accomplished?

# Purpose

Why was this artifact created?

# Key Engineering Decisions

List the important engineering decisions.

# Completed Work

What work has been completed?

# Remaining Work

What is still missing?

# Risks

Identify technical risks.

# Recommendations

Suggest the next engineering steps.

# One Sentence Summary

One concise sentence describing the artifact.`;

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @type {Promise<void>} */
let logQueue = Promise.resolve();

/**
 * Serialize console output so concurrent workers do not interleave lines.
 * @param {() => void} fn
 */
function log(fn) {
  logQueue = logQueue.then(() => {
    fn();
  });
  return logQueue;
}

/**
 * Recursively collect every .json file under a directory.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

/**
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number }} [options]
 * @returns {Promise<T>}
 * @template T
 */
async function withRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * attempt;
        await log(() => {
          console.error(
            `  ! Attempt ${attempt}/${maxAttempts} failed: ${error.message}. Retrying in ${delay}ms...`
          );
        });
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * @param {object} artifact
 * @returns {Promise<string>}
 */
async function analyzeWithOllama(artifact) {
  const userPrompt = [
    "Analyze the following engineering artifact JSON:",
    "",
    JSON.stringify(artifact, null, 2),
  ].join("\n");

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${response.status} ${response.statusText})${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }

  const data = await response.json();
  if (!data.response) {
    throw new Error("Ollama response missing 'response' field");
  }

  return String(data.response).trim();
}

/**
 * @param {string} artifactPath
 * @param {string} outputPath
 * @param {number} index
 * @param {number} total
 */
async function analyzeArtifactFile(artifactPath, outputPath, index, total) {
  const filename = path.basename(artifactPath);

  await log(() => {
    console.log(`Analyzing ${index}/${total}`);
    console.log(filename);
    console.log("");
  });

  const raw = await fs.readFile(artifactPath, "utf8");
  const artifact = JSON.parse(raw);

  const markdown = await withRetry(() => analyzeWithOllama(artifact));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${markdown}\n`, "utf8");

  const relativeOutput = path.relative(ROOT, outputPath);
  await log(() => {
    console.log(`✓ ${relativeOutput}`);
    console.log("");
  });
}

/**
 * Run tasks with a fixed concurrency limit.
 * @param {Array<() => Promise<void>>} tasks
 * @param {number} limit
 */
async function runWithConcurrency(tasks, limit) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const current = nextIndex;
      nextIndex += 1;
      await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const force = argv.includes("--force");
  const help = argv.includes("--help") || argv.includes("-h");

  return { force, help };
}

async function main() {
  const { force, help } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log(`Usage: node analyze-artifacts.js [--force]

Options:
  --force   Re-analyze artifacts even when analysis/*.md already exists
`);
    process.exit(0);
  }

  let artifactFiles;
  try {
    artifactFiles = await collectJsonFiles(ARTIFACTS_DIR);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      console.error(`Artifacts directory not found: ${ARTIFACTS_DIR}`);
      process.exit(1);
    }
    throw error;
  }

  if (artifactFiles.length === 0) {
    console.log("No artifact JSON files found.");
    return;
  }

  const jobs = [];

  for (const artifactPath of artifactFiles) {
    const relative = path.relative(ARTIFACTS_DIR, artifactPath);
    const outputPath = path.join(
      ANALYSIS_DIR,
      relative.replace(/\.json$/i, ".md")
    );

    if (!force) {
      try {
        await fs.access(outputPath);
        continue;
      } catch {
        // Output does not exist — analyze it.
      }
    }

    jobs.push({ artifactPath, outputPath });
  }

  const skipped = artifactFiles.length - jobs.length;
  if (skipped > 0) {
    console.log(`Skipping ${skipped} existing analysis file(s). Use --force to re-analyze.\n`);
  }

  if (jobs.length === 0) {
    console.log("Nothing to analyze.");
    return;
  }

  const total = jobs.length;
  const tasks = jobs.map(
    ({ artifactPath, outputPath }, index) => () =>
      analyzeArtifactFile(artifactPath, outputPath, index + 1, total)
  );

  await runWithConcurrency(tasks, CONCURRENCY);

  console.log("Done.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
