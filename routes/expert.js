"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { runPipeline } = require("../services/expertPipeline");

const PROMPT_PATH = path.join(__dirname, "..", "prompts", "expert-v0.md");
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!fs.existsSync(PROMPT_PATH)) {
  throw new Error(`Missing system prompt file: ${PROMPT_PATH}`);
}
if (!ANTHROPIC_MODEL) {
  throw new Error("Missing required environment variable: ANTHROPIC_MODEL");
}
if (!ANTHROPIC_API_KEY) {
  throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
}

const systemPrompt = fs.readFileSync(PROMPT_PATH, "utf8");
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const router = express.Router();

router.post("/expert", async (req, res) => {
  const { question, session_id: sessionId } = req.body || {};

  if (question == null || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "INVALID_REQUEST", message: "question is required" });
  }
  if (sessionId != null && typeof sessionId !== "string") {
    return res.status(400).json({ error: "INVALID_REQUEST", message: "session_id must be a string" });
  }

  try {
    const result = await runPipeline({
      question: question.trim(),
      sessionId: sessionId || null,
      systemPrompt,
      anthropic,
      model: ANTHROPIC_MODEL
    });
    return res.status(200).json(result);
  } catch (err) {
    if (err && err.code === "DENYLIST_VIOLATION") {
      return res.status(500).json({
        error: "GUARDRAIL_ABORT",
        message: err.message,
        debug: err.debug
      });
    }
    console.error("POST /expert pipeline error:", err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Pipeline failed. See server logs."
    });
  }
});

module.exports = router;
