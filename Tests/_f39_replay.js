#!/usr/bin/env node
"use strict";

process.env.TIER_ONE_GATE_ENABLED = "0";

const { handleChat } = require("../services/chatService");
const { getSession } = require("../services/sessionStore");

const TEXTILE_PRODUCT = {
  id: "textile-1",
  name: "Textile Upholstery Cleaner",
  tags: ["textile", "textile_cleaner", "interior", "cleaning", "stain_remover"],
  stock: 5,
  manufacturerId: "13"
};

async function replayTurn(label, message, sessionId, products) {
  const reply = await handleChat(message, "C1", products, sessionId);
  const session = getSession(sessionId);
  const text = String(reply.message || reply.reply || "");
  console.log(`\n=== ${label} ===`);
  console.log("message:", message);
  console.log("reply:", text.slice(0, 200));
  console.log("type:", reply.type);
  console.log("slots:", JSON.stringify(session?.slots || {}));
  console.log("pendingQuestion.slot:", session?.pendingQuestion?.slot ?? null);
  return { reply, session };
}

async function main() {
  const catalog = [TEXTILE_PRODUCT];
  const noMatch = [{ id: "wax", name: "Wax", tags: ["exterior", "wax"], stock: 1, manufacturerId: "13" }];

  const s1 = `f39-replay-1-${Date.now()}`;
  await replayTurn("Turn 1", "am cotiera foarte murdara", s1, catalog);

  const s2 = `f39-replay-2-${Date.now()}`;
  await replayTurn("Turn 1 (session 2)", "am cotiera foarte murdara", s2, catalog);
  await replayTurn("Turn 2", "textil", s2, catalog);

  const s3 = `f39-replay-3-${Date.now()}`;
  await replayTurn(
    "Turn 3 (fresh, zero-results)",
    "ce produs recomanzi pentru cotiera textil murdara",
    s3,
    noMatch
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
