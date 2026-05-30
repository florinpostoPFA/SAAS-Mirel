"use strict";

const fs = require("fs");
const path = require("path");
const { __test: t, detectLanguage } = require("../services/chatService");
const { loadFreshHandleChat } = require("./_phaseA_harness");
const sessionLifecycle = require("../services/sessionLifecycle");

const ROOT = path.join(__dirname, "..");
const CLARIFICATION_SOURCE_FILES = [
  "services/chatService.js",
  "services/lowSignalService.js",
  "services/contextLossMvp.js"
];

const ENGLISH_CLARIFICATION_BAN =
  /\b(is it|are you|would you|do you want|what kind|which one)\b/i;

function readClarificationSources() {
  return CLARIFICATION_SOURCE_FILES.map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8")).join("\n");
}

function extractFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

describe("F10 — clarification template localization", () => {
  it("detectLanguage treats Bug #3 input as Romanian", () => {
    expect(detectLanguage("recomanda un prosop de uscare")).toBe("ro");
  });

  it("getClarificationQuestion(context) is Romanian even when locale is en", () => {
    const q = t.getClarificationQuestion("context", { object: "caroserie" }, "en");
    expect(q).toMatch(/Este pentru interior sau exterior/i);
    expect(q).not.toMatch(/\bIs it interior\b/i);
  });

  it("getClarificationQuestion(object) is Romanian when locale is en", () => {
    const q = t.getClarificationQuestion("object", { context: "interior" }, "en");
    expect(q.toLowerCase()).toContain("ce vrei sa cureti");
    expect(q).not.toMatch(/\bWhat exactly do you want\b/i);
  });

  it("getClarificationQuestion(surface exterior) is Romanian when locale is en", () => {
    const q = t.getClarificationQuestion("surface", { context: "exterior", object: "caroserie" }, "en");
    expect(q.toLowerCase()).toContain("suprafata");
    expect(q).not.toMatch(/\bWhich surface are you working\b/i);
  });

  it("Bug #3 replay returns Romanian context clarification", async () => {
    sessionLifecycle.resetAllSessions();
    const handleChat = loadFreshHandleChat();
    const sid = `f10-bug3-${Date.now()}`;
    const products = [
      {
        id: "stub-towel",
        name: "Prosop Stub",
        tags: ["interior", "textile"],
        manufacturerId: "9",
        searchText: "prosop uscare microfibră"
      }
    ];
    const reply = await handleChat("recomanda un prosop de uscare", "C1", products, sid);
    const msg = reply?.message || reply?.reply || "";
    expect(reply?.decisionTrace?.missingSlot).toBe("context");
    expect(String(msg)).toMatch(/Este pentru interior sau exterior/i);
    expect(String(msg)).not.toMatch(/\bIs it interior or exterior\b/i);

    const snap = sessionLifecycle.peekSessionSnapshot(sid);
    const outPath = path.join(__dirname, "_f10_bug3_replay.json");
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          input: "recomanda un prosop de uscare",
          missingSlot: reply?.decisionTrace?.missingSlot,
          assistantReply: msg,
          sessionSlots: snap?.slots || {}
        },
        null,
        2
      )
    );
  });

  it("clarification template functions contain no banned English imperatives", () => {
    const source = readClarificationSources();
    const targets = [
      "getClarificationQuestion",
      "getProceduralSurfaceEnumQuestion",
      "getInteriorSurfaceLlmAssistBaseQuestion",
      "buildSurfaceClarificationQuestionWithAssist",
      "getFlowDisambiguationQuestion"
    ];
    const lowSignal = extractFunctionBody(
      fs.readFileSync(path.join(ROOT, "services/lowSignalService.js"), "utf8"),
      "buildLowSignalClarificationQuestion"
    );
    const pick = extractFunctionBody(
      fs.readFileSync(path.join(ROOT, "services/contextLossMvp.js"), "utf8"),
      "pickClarificationQuestion"
    );
    const bodies = targets.map((name) => extractFunctionBody(source, name)).concat([lowSignal, pick]);
    for (const body of bodies) {
      expect(body).not.toMatch(ENGLISH_CLARIFICATION_BAN);
    }
  });
});
