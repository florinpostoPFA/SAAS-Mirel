"use strict";

const path = require("path");

const ROOT = path.join(__dirname, "..");
const MODEL_CACHE = path.join(ROOT, "data", "models");
const MODEL_ID = "Xenova/bge-m3";
const DIMENSION = 1024;

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      env.cacheDir = MODEL_CACHE;
      env.localModelPath = MODEL_CACHE;
      env.allowRemoteModels = false;
      env.backends.onnx.wasm.numThreads = 1;
      return pipeline("feature-extraction", MODEL_ID, { quantized: true });
    })();
  }
  return extractorPromise;
}

async function embedQuestion(text) {
  const extractor = await getExtractor();
  const output = await extractor(String(text || ""), { pooling: "mean", normalize: true });
  const vector = Array.from(output.data);
  if (vector.length !== DIMENSION) {
    throw new Error(`Expected ${DIMENSION}-dim embedding, got ${vector.length}`);
  }
  return vector;
}

module.exports = {
  getExtractor,
  embedQuestion,
  DIMENSION,
  MODEL_ID,
  MODEL_CACHE
};
