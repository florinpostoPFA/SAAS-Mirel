jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { handleChat, detectLanguage } = require("../services/chatService");

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

    await handleChat(
      "Care este diferenta intre polish si wax pentru caroserie?",
      "C1",
      [],
      `lang-ro-${Date.now()}`
    );

    expect(askLLM.mock.calls.length).toBeGreaterThanOrEqual(1);
    const joined = askLLM.mock.calls.map((c) => String(c[0] || "")).join("\n");
    expect(joined).toMatch(/rom[aâ]n[aă]|Romanian/i);
  });

  it("reuses persisted session language on later turns", async () => {
    const sessionId = `lang-persist-${Date.now()}`;
    askLLM.mockResolvedValue("ok");

    await handleChat(
      "Care este diferenta intre spuma alcalina si spuma pH neutru?",
      "C1",
      [],
      sessionId
    );
    await handleChat("Explica pe scurt si despre clay bar.", "C1", [], sessionId);

    expect(askLLM.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondPrompt = askLLM.mock.calls[1][0];
    expect(secondPrompt).toMatch(/rom[aâ]n[aă]|Romanian/i);
  });
});
