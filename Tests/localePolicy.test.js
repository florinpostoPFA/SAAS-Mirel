"use strict";

const fs = require("fs");
const path = require("path");
const { handleChat, __test: t } = require("../services/chatService");
const sessionLifecycle = require("../services/sessionLifecycle");

const ROOT = path.join(__dirname, "..");
const LOCALE_POLICY_RO_ACK = t.LOCALE_POLICY_RO_ACK;
const ENGLISH_OUTPUT_BAN =
  /\b(what|which|recommend|please|would you|do you want|steps or product|is it interior)\b/i;

const CLARIFICATION_SOURCE_FILES = [
  "services/chatService.js",
  "services/lowSignalService.js",
  "services/contextLossMvp.js"
];

function replyText(r) {
  return String(r?.message || r?.reply || "");
}

describe("F32 — locale policy (RO-only output)", () => {
  beforeEach(() => {
    sessionLifecycle.resetAllSessions();
  });

  it("EN input → Romanian output without English clarification phrases", async () => {
    const sid = `f32-en-${Date.now()}`;
    const r = await handleChat("recommend an interior cleaner for seats", "C1", [], sid);
    const msg = replyText(r);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toMatch(/interior|exterior|suprafata|textile|piele|română|Continuăm/i);
    expect(msg).not.toMatch(ENGLISH_OUTPUT_BAN);
  });

  it("mixed RO/EN input → Romanian output", async () => {
    const sid = `f32-mix-${Date.now()}`;
    const r = await handleChat("vreau recommend something for bord interior", "C1", [], sid);
    const msg = replyText(r);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toMatch(ENGLISH_OUTPUT_BAN);
  });

  it("garbage/empty-ish input → Romanian output", async () => {
    const sid = `f32-garbage-${Date.now()}`;
    const r = await handleChat("!!!", "C1", [], sid);
    const msg = replyText(r);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toMatch(ENGLISH_OUTPUT_BAN);
  });

  it("first non-RO turn prepends one-time ack", async () => {
    const sid = `f32-ack1-${Date.now()}`;
    const r = await handleChat("Hello I need help cleaning my car exterior", "C1", [], sid);
    expect(replyText(r)).toContain(LOCALE_POLICY_RO_ACK);
    const snap = sessionLifecycle.peekSessionSnapshot(sid);
    expect(snap.localeAckSent).toBe(true);
  });

  it("second non-RO turn does not repeat ack", async () => {
    const sid = `f32-ack2-${Date.now()}`;
    await handleChat("Hello I need help cleaning my car exterior", "C1", [], sid);
    const r2 = await handleChat("x", "C1", [], sid);
    const msg = replyText(r2);
    expect(msg).not.toContain(LOCALE_POLICY_RO_ACK);
    expect(msg).toMatch(/pași|produs|recomandare/i);
  });

  it("AC4: clarification sources avoid shipped English question templates", () => {
    const source = CLARIFICATION_SOURCE_FILES.map((rel) =>
      fs.readFileSync(path.join(ROOT, rel), "utf8")
    ).join("\n");
    expect(source).not.toMatch(/\bIs it interior or exterior\b/);
    expect(source).not.toMatch(/\bWhat exactly do you want to clean\b/);
    expect(source).not.toMatch(/\bWhich surface are you working on\b/);
  });
});
