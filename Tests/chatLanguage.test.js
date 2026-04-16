jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { handleChat, detectLanguage } = require("../services/chatService");
const { saveSession } = require("../services/sessionStore");

describe("ChatService language handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("detects Romanian from common Romanian indicators", () => {
    expect(detectLanguage("vreau ceva pentru interior")).toBe("ro");
    expect(detectLanguage("cat timp rezista protectia")).toBe("ro");
    expect(detectLanguage("recommend an interior cleaner")).toBe("en");
  });

  it("forces Romanian in the prompt for Romanian input", async () => {
    askLLM.mockResolvedValue("ok");

    await handleChat("cum folosesc produsul?", "C1", [], `lang-ro-${Date.now()}`);

    expect(askLLM).toHaveBeenCalledTimes(1);
    expect(askLLM.mock.calls[0][0]).toMatch(/Raspunde STRICT in limba romana/i);
  });

  it("reuses persisted session language on later turns", async () => {
    const sessionId = `lang-persist-${Date.now()}`;
    askLLM.mockResolvedValue("ok");

    saveSession(sessionId, {
      state: "NEEDS_MATERIAL",
      tags: ["cleaning", "interior"],
      activeProducts: [],
      lastResponse: null,
      language: "ro"
    });

    await handleChat("plastic", "C1", [], sessionId);

    expect(askLLM).toHaveBeenCalledTimes(1);
    expect(askLLM.mock.calls[0][0]).toMatch(/Raspunde STRICT in limba romana/i);
  });
});