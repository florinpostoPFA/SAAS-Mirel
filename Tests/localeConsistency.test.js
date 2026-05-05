jest.mock("../services/llm", () => ({
  askLLM: jest.fn(async () => "This is an English reply from model.")
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/logger", () => ({
  logInfo: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const { handleChat } = require("../services/chatService");
const { logInfo } = require("../services/logger");

describe("locale consistency (EPIC 4.1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses English locale for explicit English input", async () => {
    await handleChat("what can i use for dashboard", "C1", [], `loc-${Date.now()}`);

    const responseRender = logInfo.mock.calls.find((c) => c[0] === "RESPONSE_RENDER");
    expect(responseRender).toBeTruthy();
    expect(responseRender[1]?.responseLocaleUsed).toBe("en");
  });

  it("logs LOCALE_VIOLATION when output contains English phrases", async () => {
    await handleChat("what can i use for dashboard", "C1", [], `locv-${Date.now()}`);

    const violation = logInfo.mock.calls.find((c) => c[0] === "LOCALE_VIOLATION");
    expect(violation).toBeTruthy();
    expect(String(violation[1]?.preview || "").length).toBeGreaterThan(0);
  });
});

