const axios = require("axios");
const { info, error: logError } = require("../logger");

const SOURCE = "OpenAI";

async function ask(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logError(SOURCE, "OPENAI_API_KEY not configured in environment");
    throw new Error("API key not configured. Set OPENAI_API_KEY in .env file.");
  }

  if (!prompt) {
    logError(SOURCE, "Empty prompt provided");
    throw new Error("Prompt cannot be empty");
  }

  try {
    info(SOURCE, `Calling OpenAI API with model gpt-4o-mini`);
    
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        timeout: 30000 // 30 second timeout
      }
    );

    if (!res.data || !res.data.choices || !res.data.choices[0]) {
      logError(SOURCE, "Unexpected API response format", res.data);
      throw new Error("Invalid response format from OpenAI API");
    }

    const content = res.data.choices[0].message.content;
    
    if (!content) {
      logError(SOURCE, "Empty content in API response");
      throw new Error("Empty response from OpenAI API");
    }

    info(SOURCE, `API response received (${content.length} chars)`);
    return content;
  } catch (err) {
    if (err.response) {
      // API returned an error
      logError(SOURCE, `API error (${err.response.status}):`, {
        status: err.response.status,
        error: err.response.data?.error?.message || err.message
      });
      throw new Error(`OpenAI API error: ${err.response.data?.error?.message || err.message}`);
    } else if (err.request) {
      // Request made but no response
      logError(SOURCE, "No response from API", { error: err.message });
      throw new Error("No response from OpenAI API - check network connection");
    } else {
      // Other errors
      logError(SOURCE, "Request failed", { error: err.message });
      throw new Error(`Request failed: ${err.message}`);
    }
  }
}

module.exports = { ask };
