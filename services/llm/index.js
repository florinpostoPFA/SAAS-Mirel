const openai = require("./openai");
const { getNowMs } = require("../runtimeContext");
const { emitLlmCall, getTraceStore } = require("../loggingV2");

/**
 * Optional cost from env: USD per 1K prompt / completion tokens (rough estimates).
 */
function estimateCostUsd(model, usage) {
  const enable = String(process.env.LLM_LOG_COST || "").toLowerCase();
  if (!["1", "true", "yes"].includes(enable)) return null;
  const p = Number(process.env.OPENAI_PRICE_PROMPT_PER_1K || "");
  const c = Number(process.env.OPENAI_PRICE_COMPLETION_PER_1K || "");
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
  const pt = usage.prompt_tokens || 0;
  const ct = usage.completion_tokens || 0;
  const amount = (pt / 1000) * p + (ct / 1000) * c;
  return { currency: "USD", amount: Math.round(amount * 1e6) / 1e6, modelHint: model };
}

/**
 * @param {string} prompt
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
async function askLLM(prompt, opts = {}) {
  const t0 = getNowMs();
  let result;
  try {
    result = await openai.ask(prompt, opts);
  } catch (e) {
    const durationMs = Math.max(0, getNowMs() - t0);
    if (getTraceStore()) {
      emitLlmCall({
        model: openai.DEFAULT_MODEL,
        provider: "openai",
        durationMs,
        tokens: null,
        cost: null,
        stage: opts.stage || "llm",
        ok: false,
        debugMeta: { errorCode: e && e.code }
      });
    }
    throw e;
  }

  const durationMs = Math.max(0, getNowMs() - t0);
  const usage = result.usage || {};
  const tokens = {
    prompt: usage.prompt_tokens,
    completion: usage.completion_tokens,
    total: usage.total_tokens
  };
  const cost = estimateCostUsd(result.model, usage);

  if (getTraceStore()) {
    emitLlmCall({
      model: result.model,
      provider: result.provider || "openai",
      durationMs,
      tokens,
      cost,
      stage: opts.stage || "llm",
      debugMeta: {
        promptLen: prompt.length,
        completionLen: result.content ? result.content.length : 0
      }
    });
  }

  return result.content;
}

module.exports = { askLLM };
