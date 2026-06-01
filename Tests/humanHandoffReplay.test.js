"use strict";

process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.TIER_ONE_GATE_ENABLED = "0";

jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog.js", () => ({
  appendInteractionLine: jest.fn(),
  enrichInteractionExportRow: (e) => e,
  INTERACTION_JSONL_SCHEMA_VERSION: 2,
  LOG_DIR: "/tmp"
}));

const fs = require("fs");
const path = require("path");
const { handleChat } = require("../services/chatService");
const logger = require("../services/logger");
const sessionLifecycle = require("../services/sessionLifecycle");
const { getSession, saveSession } = require("../services/sessionStore");

const replay = JSON.parse(
  fs.readFileSync(path.join(__dirname, "_f13_replay.json"), "utf8")
);

/** Catalog with no tractor/wheel token overlap — avoids fallback products.json matching T1 inputs. */
const STUB_CATALOG = [
  {
    id: "stub-interior",
    name: "Interior APC",
    tags: ["interior"],
    searchText: "curatat tapiterie interior scaune",
    manufacturerId: "13"
  }
];

const handoffLogEvents = [];

function lastHandoffLog() {
  for (let i = handoffLogEvents.length - 1; i >= 0; i--) {
    if (handoffLogEvents[i].tag === "HUMAN_HANDOFF_TRIGGERED") {
      return handoffLogEvents[i].data;
    }
  }
  return null;
}

describe("F13 replay cases", () => {
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    handoffLogEvents.length = 0;
    logSpy = jest.spyOn(logger, "logInfo").mockImplementation((tag, data) => {
      if (String(tag).startsWith("HUMAN_HANDOFF")) {
        handoffLogEvents.push({ tag, data });
      }
    });
    sessionLifecycle.resetAllSessions();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  for (const c of replay.cases) {
    it(`case ${c.id}: ${c.name}`, async () => {
      const sid = `${c.sessionId}-${Date.now()}`;
      if (c.expect.seedClarificationLoop || c.expect.seedPendingSlot) {
        const sess = getSession(sid);
        if (c.expect.seedClarificationLoop) {
          sess.clarificationLoopCount = { ...c.expect.seedClarificationLoop };
        }
        if (c.expect.seedPendingSlot) {
          sess.pendingQuestion = {
            slot: c.expect.seedPendingSlot,
            active: true,
            source: "test_seed"
          };
          sess.pendingSelection = true;
          sess.pendingSelectionMissingSlot = c.expect.seedPendingSlot;
        }
        saveSession(sid, sess);
      }
      let lastReply = "";
      for (let ti = 0; ti < c.turns.length; ti++) {
        const turn = c.turns[ti];
        if (
          c.expect.seedDeadEndsBeforeLastTurn &&
          ti === c.turns.length - 1
        ) {
          const sess = getSession(sid);
          sess.lowSignalConsecutiveDeadEnds = c.expect.seedDeadEndsBeforeLastTurn;
          saveSession(sid, sess);
        }
        const res = await handleChat(turn.message, "C1", STUB_CATALOG, sid);
        lastReply = String(res.reply || res.message || "");
      }

      if (c.expect.noHandoff) {
        expect(lastHandoffLog()).toBeNull();
        expect(lastReply.toLowerCase()).not.toMatch(/numar de telefon/);
        return;
      }

      if (c.expect.replyContains) {
        expect(lastReply).toMatch(new RegExp(c.expect.replyContains, "i"));
      }

      if (c.expect.handoffReason) {
        const trig = lastHandoffLog();
        if (trig) {
          expect(trig.reason).toBe(c.expect.handoffReason);
        } else {
          expect(lastReply.toLowerCase()).toMatch(/numar de telefon/);
        }
      }
    });
  }
});
