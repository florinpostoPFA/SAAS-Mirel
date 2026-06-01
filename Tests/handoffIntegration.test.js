"use strict";

process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.TIER_ONE_GATE_ENABLED = "0";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

const logger = require("../services/logger");
const sessionLifecycle = require("../services/sessionLifecycle");
const { handleChat, __test } = require("../services/chatService");
const { getSession, saveSession } = require("../services/sessionStore");
const templates = require("../data/handoff_templates.json");

function handoffCalls() {
  return logger.logInfo.mock.calls.filter((c) => c[0] === "HUMAN_HANDOFF_LOGGED");
}

describe("F13 v2 handoff integration", () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionLifecycle.resetAllSessions();
    logSpy = jest.spyOn(logger, "logInfo").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('"roti tractor" may handoff on zero retrieval without crashing', async () => {
    const sid = `f13v2-t1-${Date.now()}`;
    const res = await handleChat("roti tractor", "C1", [], sid);
    const reply = String(res.reply || res.message || "");
    expect(reply).not.toMatch(/A apărut o eroare/i);
    if (handoffCalls().length > 0) {
      expect(reply).toContain(templates.TRIGGER_PROMPT.slice(0, 40));
    }
  });

  it('"recomanda ceva pentru rotile de tractor" does not crash and may handoff', async () => {
    const sid = `f13v2-t2-${Date.now()}`;
    const res = await handleChat("recomanda ceva pentru rotile de tractor", "C1", [], sid);
    const reply = String(res.reply || res.message || "");
    expect(reply).not.toMatch(/A apărut o eroare/i);
    expect(handoffCalls().length).toBeGreaterThan(0);
    expect(reply).toMatch(/numar de telefon|adresa de mail/i);
  });

  it('"vreau ceva pentru jante" uses normal recommend flow without handoff', async () => {
    const sid = `f13v2-t3-${Date.now()}`;
    const res = await handleChat("vreau ceva pentru jante", "C1", [], sid);
    const reply = String(res.reply || res.message || "");
    expect(reply).not.toMatch(/A apărut o eroare/i);
    expect(handoffCalls()).toHaveLength(0);
    expect(reply.toLowerCase()).not.toMatch(/numar de telefon/);
  });

  it('"exterior" as slot reply continues without handoff', async () => {
    const sid = `f13v2-t4-${Date.now()}`;
    const sess = getSession(sid);
    sess.pendingQuestion = { slot: "context", active: true };
    sess.pendingSelection = true;
    sess.slots = { object: "jante" };
    saveSession(sid, sess);
    await handleChat("vreau ceva pentru curatat jante", "C1", [], sid);
    jest.clearAllMocks();
    logSpy = jest.spyOn(logger, "logInfo").mockImplementation(() => {});
    const res = await handleChat("exterior", "C1", [], sid);
    const reply = String(res.reply || res.message || "");
    expect(reply).not.toMatch(/A apărut o eroare/i);
    expect(handoffCalls()).toHaveLength(0);
    expect(getSession(sid).slots?.context).toBe("exterior");
  });

  it("emitHandoff logs and returns trigger template", () => {
    const reply = __test.emitHandoff({ slots: {} }, "unit", "trace-1", "sess-1");
    expect(reply).toBe(templates.TRIGGER_PROMPT);
    expect(handoffCalls()).toHaveLength(1);
    expect(handoffCalls()[0][1]).toMatchObject({ reason: "unit", sessionId: "sess-1" });
  });
});
