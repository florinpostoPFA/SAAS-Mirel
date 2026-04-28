jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
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

const { logInfo } = require("../services/logger");
const { askLLM } = require("../services/llm");
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");

function lastLogEntry() {
  const calls = appendInteractionLine.mock.calls;
  return calls[calls.length - 1][0];
}

describe("Intent escalation: knowledge → selection follow-up", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue(
      "Dressingul de anvelope este un produs care redă culoarea și finisajul anvelopelor."
    );
  });

  it("recommendation follow-up bypasses low-signal intent_level and applies carry-over (anvelope)", async () => {
    const sessionId = `escalation-${Date.now()}`;
    const products = [
      {
        id: "td1",
        name: "Dressing Anvelope Black",
        description: "Finisaj satin pentru anvelope.",
        short_description: "Dressing anvelope.",
        tags: ["exterior", "wheels", "tire_dressing"]
      },
      {
        id: "td2",
        name: "Perie Anvelope",
        description: "Aplicare uniformă.",
        short_description: "Perie.",
        tags: ["exterior", "wheels", "brush", "tool"]
      }
    ];
    await handleChat("ce produs sa folosesc pentru anvelope la exterior?", "C1", products, sessionId);
    jest.clearAllMocks();
    appendInteractionLine.mockClear();
    logInfo.mockClear();

    askLLM.mockResolvedValue("Recomand un dressing dedicat pentru anvelope, cu aplicare pe suprafață curată.");

    const res2 = await handleChat(
      "ok, ce imi recomanzi pentru asta?",
      "C1",
      products,
      sessionId
    );

    const log2 = lastLogEntry();

    expect(log2.decision?.missingSlot).not.toBe("intent_level");
    expect(log2.decision?.missingSlot).not.toBe("context");
    expect(log2.intent?.queryType).toBe("selection");

    expect(logInfo.mock.calls.some(c => c[0] === "LOW_SIGNAL_BYPASSED_FOLLOWUP")).toBe(true);
    expect(logInfo.mock.calls.some(c => c[0] === "FOLLOWUP_CONTEXT_CARRYOVER_APPLIED")).toBe(true);

    const reply2 = String(res2.reply || res2.message || "");
    expect(reply2.toLowerCase()).not.toMatch(/vrei pa[sș]i|intent/i);
    expect(askLLM).toHaveBeenCalled();
  });

  it("safeFallback menu blocked when follow-up product_search has exactly one bundled product (logs SAFEFALLBACK_BLOCKED_PRODUCTS_EXIST)", async () => {
    const sessionId = `safe-fallback-block-${Date.now()}`;
    const products = [
      {
        id: "td1",
        name: "Dressing Anvelope Black",
        description: "Finisaj satin pentru anvelope.",
        short_description: "Dressing anvelope.",
        tags: ["exterior", "wheels", "tire_dressing"]
      }
    ];
    await handleChat("ce produs sa folosesc pentru anvelope la exterior?", "C1", products, sessionId);
    logInfo.mockClear();
    askLLM.mockResolvedValue(
      "Îți recomand un dressing de anvelope; aplică pe suprafață curată și uscată."
    );

    await handleChat("ok, ce imi recomanzi pentru asta?", "C1", products, sessionId);

    expect(logInfo.mock.calls.some(c => c[0] === "SAFEFALLBACK_BLOCKED_PRODUCTS_EXIST")).toBe(true);
    expect(askLLM).toHaveBeenCalled();

    const entry = lastLogEntry();
    const reply = String(entry?.reply || "");
    expect(reply).not.toMatch(/Nu sunt sigur că îți pot da un răspuns corect/i);
    expect(reply).not.toMatch(/Pot să te ajut cu:\s*$/m);
  });

  it("knowledge then generic follow-up does not re-apply stale carryover without pending state", async () => {
    const sessionId = `carryover-stale-${Date.now()}`;
    await handleChat("ce este dressing de anvelope?", "C1", [], sessionId);
    logInfo.mockClear();
    appendInteractionLine.mockClear();

    const products = [
      {
        id: "td1",
        name: "Dressing Anvelope Black",
        description: "Finisaj satin pentru anvelope.",
        short_description: "Dressing anvelope.",
        tags: ["exterior", "wheels", "tire_dressing"]
      }
    ];

    await handleChat("ce imi recomanzi?", "C1", products, sessionId);

    const thirdLog = lastLogEntry();
    expect(logInfo.mock.calls.some(c => c[0] === "FOLLOWUP_CONTEXT_CARRYOVER_APPLIED")).toBe(false);
    expect(logInfo.mock.calls.some(c => c[0] === "FOLLOWUP_CONTEXT_CARRYOVER_SKIPPED")).toBe(true);
    expect(thirdLog?.decision?.missingSlot).toBe("intent_level");
    expect(thirdLog?.intent?.queryType).not.toBe("selection");
  });

  it("knowledge tires -> low-signal -> intent-level selection does not ask interior/exterior", async () => {
    const sessionId = `intent-level-tires-${Date.now()}`;
    const products = [
      {
        id: "td1",
        name: "Dressing Anvelope Black",
        description: "Finisaj satin pentru anvelope.",
        short_description: "Dressing anvelope.",
        tags: ["exterior", "wheels", "tire_dressing"]
      },
      {
        id: "td2",
        name: "Cleaner Jante",
        description: "Curatare jante.",
        short_description: "Cleaner jante.",
        tags: ["exterior", "wheels", "wheel_cleaner"]
      }
    ];

    askLLM.mockResolvedValueOnce(
      "Dressingul de anvelope este un produs de protectie pentru cauciuc, cu rol estetic si de protectie."
    );
    await handleChat("ce este dressing de anvelope?", "C1", products, sessionId);

    const lowSignal = await handleChat("ce imi recomanzi?", "C1", products, sessionId);
    const lowSignalReply = String(lowSignal.reply || lowSignal.message || "").toLowerCase();
    expect(lowSignalReply).toMatch(/pa[sș]i/);
    expect(lowSignalReply).toMatch(/recomandare|produse/);

    appendInteractionLine.mockClear();
    const resolved = await handleChat("recomandare de produse", "C1", products, sessionId);
    const resolvedReply = String(resolved.reply || resolved.message || "").toLowerCase();
    const resolvedLog = lastLogEntry();

    expect(resolvedLog?.intent?.queryType).toBe("selection");
    expect(resolvedLog?.decision?.missingSlot).not.toBe("context");
    expect(resolvedReply).not.toMatch(/interior sau exterior|interior ori exterior|e pentru interior/i);
  });

  it("generic low-signal selection without prior wheel/tire context can still ask context", async () => {
    const sessionId = `intent-level-generic-${Date.now()}`;
    const products = [
      {
        id: "p1",
        name: "Curatare universala",
        description: "Produs universal",
        short_description: "Universal",
        tags: ["cleaner"]
      }
    ];

    await handleChat("ce imi recomanzi?", "C1", products, sessionId);
    appendInteractionLine.mockClear();

    const resolved = await handleChat("recomandare de produse", "C1", products, sessionId);
    const resolvedReply = String(resolved.reply || resolved.message || "").toLowerCase();
    const resolvedLog = lastLogEntry();

    expect(resolvedLog?.intent?.queryType).toBe("selection");
    expect(resolvedLog?.decision?.missingSlot).toBe("context");
    expect(resolvedReply).toMatch(/interior|exterior/);
  });
});
