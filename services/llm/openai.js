const axios = require("axios");
const { debug, error: logError } = require("../logger");
const { AppError, ERROR_CATEGORIES } = require("../appError");
const { getNowIso } = require("../runtimeContext");
const LLM_DEBUG = ["1", "true", "yes", "on"].includes(String(process.env.LLM_DEBUG_LOG || "").toLowerCase());

const SOURCE = "OpenAI";
const DEFAULT_MODEL = "gpt-4o-mini";

function logLegacyStructured(tag, payload) {
  const timestamp = getNowIso();
  console.log(`[${timestamp}] [INFO] [${tag}] ${JSON.stringify(payload)}`);
}

/**
 * @param {string} prompt
 * @param {object} [_options]
 * @returns {Promise<{ content: string, model: string, provider: string, usage: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } }>}
 */
async function ask(prompt, _options = {}) {
  const requestTimeoutMs = Number.isFinite(Number(_options.timeoutMs))
    ? Number(_options.timeoutMs)
    : 30000;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logError(SOURCE, "OPENAI_API_KEY not configured in environment");
    throw new AppError("OPENAI_NOT_CONFIGURED", "API key not configured. Set OPENAI_API_KEY in .env file.", {
      category: ERROR_CATEGORIES.LLM,
      httpStatus: 503
    });
  }

  if (!prompt) {
    logError(SOURCE, "Empty prompt provided");
    throw new AppError("OPENAI_EMPTY_PROMPT", "Prompt cannot be empty", {
      category: ERROR_CATEGORIES.VALIDATION,
      httpStatus: 400
    });
  }

  try {
    debug(SOURCE, "Calling OpenAI API", { model: DEFAULT_MODEL });
    if (LLM_DEBUG) {
      logLegacyStructured("LLM_PROMPT_DEBUG", {
        promptLen: prompt.length,
        promptPreview: prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt
      });
    }

    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        timeout: requestTimeoutMs
      }
    );

    if (!res.data || !res.data.choices || !res.data.choices[0]) {
      logError(SOURCE, "Unexpected API response format", res.data);
      throw new AppError("OPENAI_BAD_RESPONSE", "Invalid response format from OpenAI API", {
        category: ERROR_CATEGORIES.LLM,
        httpStatus: 502
      });
    }

    const content = res.data.choices[0].message.content;
    const usage = res.data.usage || {};

    if (!content) {
      logError(SOURCE, "Empty content in API response");
      throw new AppError("OPENAI_EMPTY_CONTENT", "Empty response from OpenAI API", {
        category: ERROR_CATEGORIES.LLM,
        httpStatus: 502
      });
    }

    if (LLM_DEBUG) {
      logLegacyStructured("LLM_RESPONSE_DEBUG", {
        responseLen: content.length,
        responsePreview: content.length > 200 ? `${content.slice(0, 200)}…` : content
      });
    }
    debug(SOURCE, "OpenAI API response received", { chars: content.length });

    const model = res.data.model || DEFAULT_MODEL;
    return {
      content,
      model,
      provider: "openai",
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens
      }
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.response) {
      logError(SOURCE, `API error (${err.response.status}):`, {
        status: err.response.status,
        error: err.response.data?.error?.message || err.message
      });
      throw new AppError(
        "OPENAI_API_ERROR",
        `OpenAI API error: ${err.response.data?.error?.message || err.message}`,
        {
          category: ERROR_CATEGORIES.LLM,
          httpStatus: err.response.status >= 400 && err.response.status < 600 ? err.response.status : 502,
          details: { status: err.response.status }
        }
      );
    } else if (err.request) {
      logError(SOURCE, "No response from API", { error: err.message });
      throw new AppError("OPENAI_NO_RESPONSE", "No response from OpenAI API - check network connection", {
        category: ERROR_CATEGORIES.LLM,
        httpStatus: 503
      });
    } else {
      logError(SOURCE, "Request failed", { error: err.message });
      throw new AppError("OPENAI_REQUEST_FAILED", `Request failed: ${err.message}`, {
        category: ERROR_CATEGORIES.LLM,
        httpStatus: 500
      });
    }
  }
}

module.exports = { ask, DEFAULT_MODEL };
