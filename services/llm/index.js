const openai = require("./openai");

async function askLLM(prompt) {
  return await openai.ask(prompt);
}

module.exports = { askLLM };
