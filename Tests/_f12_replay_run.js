"use strict";

process.env.API_KEY = process.env.API_KEY || "test-api-key";
process.env.TIER_ONE_GATE_ENABLED = "0";

const fs = require("fs");
const path = require("path");
const { handleChat } = require("../services/chatService");
const { loadSession, persistSession, resetAllSessions } = require("../services/sessionLifecycle");

const GLASS_PRODUCT = {
  id: "glass-stub",
  name: "Glass Cleaner Stub",
  tags: ["glass", "glass_cleaner", "exterior"],
  manufacturerId: "13",
  searchText: "curatare geam faruri parbriz sticla"
};

async function runCase(name, setup, message) {
  resetAllSessions();
  const sessionId = `f12-${name}-${Date.now()}`;
  if (setup) {
    const s = loadSession(sessionId);
    setup(s);
    persistSession(sessionId, s);
  }
  const reply = await handleChat(message, "C1", [GLASS_PRODUCT], sessionId);
  const snap = loadSession(sessionId);
  return {
    case: name,
    input: message,
    decisionAction: reply?.decisionTrace?.action || reply?.decision?.action,
    missingSlot: reply?.decisionTrace?.missingSlot,
    reasonCode: reply?.decisionTrace?.reasonCode,
    productCount: (reply.products && reply.products.length) || 0,
    assistantReply: String(reply.message || reply.reply || "").slice(0, 400),
    slots: snap?.slots || {}
  };
}

(async () => {
  const results = [];

  results.push(
    await runCase(
      "log_a_polluted",
      (s) => {
        s.slots = { context: "exterior", surface: "glass", object: "caroserie", action: "clean" };
        s.slotMeta = { context: "confirmed", surface: "confirmed", object: "confirmed" };
      },
      "cum curat farurile?"
    )
  );

  results.push(await runCase("log_a_fresh", null, "cum curat farurile?"));

  results.push(
    await runCase(
      "log_b_pending_intent",
      (s) => {
        s.pendingQuestion = {
          slot: "intent_level",
          source: "low_signal",
          type: "intent_level",
          active: true,
          attemptCount: 0,
          turnsSinceArmed: 1
        };
      },
      "curatat farurile"
    )
  );

  results.push(
    await runCase(
      "regression_si_pentru_interior",
      (s) => {
        s.slots = { context: "exterior", surface: "glass", object: "glass" };
        s.tags = ["glass", "exterior"];
        s.previousAction = "selection";
      },
      "si pentru interior?"
    )
  );

  resetAllSessions();
  const ceramicSid = `f12-ceramic-${Date.now()}`;
  const ceramicSession = loadSession(ceramicSid);
  ceramicSession.slots = { context: "exterior", surface: "glass", object: "glass" };
  ceramicSession.slotMeta = { context: "confirmed", surface: "confirmed", object: "confirmed" };
  ceramicSession.pendingSelection = true;
  ceramicSession.tags = ["glass", "exterior"];
  persistSession(ceramicSid, ceramicSession);
  const ceramicProducts = [
    { id: "glass1", name: "Glass Cleaner", tags: ["glass", "glass_cleaner"], searchText: "geam" },
    {
      id: "coat1",
      name: "Ceramic Coating",
      tags: ["ceramic_coating", "coating", "exterior"],
      searchText: "ceramic coating",
      manufacturerId: "13"
    }
  ];
  const ceramicReply = await handleChat("vreu ceramica", "C1", ceramicProducts, ceramicSid);
  results.push({
    case: "regression_vreu_ceramica",
    input: "vreu ceramica",
    decisionAction: ceramicReply?.decisionTrace?.action,
    productCount: (ceramicReply.products && ceramicReply.products.length) || 0,
    slots: loadSession(ceramicSid)?.slots || {}
  });

  const outPath = path.join(__dirname, "_f12_replay.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("Wrote", outPath);
})();
