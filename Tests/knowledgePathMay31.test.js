/**
 * May 31 — description-as-knowledge path (hero SKUs, anti-rec, decline).
 * @jest-environment node
 */
jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const fs = require("fs");
const path = require("path");
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat } = require("../services/chatService");
const { getEntry } = require("../services/productSectionsKnowledge");

const products = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "products.json"), "utf8")
);

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

function sectionSnippet(sku, sectionKey, minLen = 24) {
  const entry = getEntry(sku);
  const text = entry?.sections?.[sectionKey];
  if (typeof text !== "string" || text.length < minLen) {
    throw new Error(`Missing section ${sectionKey} on ${sku}`);
  }
  return text.slice(0, Math.min(80, text.length)).trim();
}

function whatItIsNotSnippet(sku) {
  const entry = getEntry(sku);
  const bullets = entry?.sections?.whatItIsNot;
  if (!Array.isArray(bullets) || bullets.length === 0) {
    throw new Error(`Missing whatItIsNot on ${sku}`);
  }
  return bullets[0];
}

describe("May 31 knowledge path — productSections", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("description_quote_hero_sku: 86001 Koch MZR howToUse", async () => {
    const snippet = sectionSnippet("86001", "howToUse");
    const sessionId = `may31-86001-${Date.now()}`;
    const res = await handleChat("cum aplic Koch Chemie MZR?", "C1", products, sessionId);
    const log = lastLog();
    const reply = String(res.reply || res.message || "");

    expect(log.decision.action).toBe("knowledge");
    expect(reply).toContain("Cum se folosește (Koch Chemie MZR):");
    expect(reply).not.toContain("(86001):");
    expect(reply).toContain(snippet.slice(0, 30));
  });

  it("description_quote_hero_sku: 86011 Koch MZR 11L howToUse", async () => {
    const snippet = sectionSnippet("86011", "howToUse");
    const sessionId = `may31-86011-${Date.now()}`;
    const res = await handleChat("cat timp las MZR pe suprafata?", "C1", products, sessionId);
    const log = lastLog();

    expect(log.decision.action).toBe("knowledge");
    expect(String(res.reply || res.message || "")).toContain(snippet.slice(0, 30));
  });

  it("description_quote_hero_sku: ADB-TYP Typhoon whereToUse", async () => {
    const snippet = sectionSnippet("ADB-TYP", "whereToUse");
    const sessionId = `may31-typ-${Date.now()}`;
    const res = await handleChat("unde pot folosi ADBL Typhoon?", "C1", products, sessionId);
    const log = lastLog();

    expect(log.decision.action).toBe("knowledge");
    expect(String(res.reply || res.message || "")).toContain(snippet.slice(0, 30));
  });

  it("description_quote_hero_sku: ADB-B Bonnet howToUse", async () => {
    const snippet = sectionSnippet("ADB-B", "howToUse");
    const sessionId = `may31-bonnet-${Date.now()}`;
    const res = await handleChat("cum se aplica ADBL Bonnet?", "C1", products, sessionId);
    const log = lastLog();

    expect(log.decision.action).toBe("knowledge");
    expect(String(res.reply || res.message || "")).toContain(snippet.slice(0, 30));
  });

  it("anti_rec_warning via knowledge: ADBL Typhoon on piele (not safety)", async () => {
    const snippet = whatItIsNotSnippet("ADB-TYP");
    const sessionId = `may31-typ-safe-${Date.now()}`;
    const res = await handleChat(
      "pot folosi ADBL Typhoon pe piele naturala?",
      "C1",
      products,
      sessionId
    );
    const log = lastLog();
    const reply = String(res.reply || res.message || "");

    expect(log.decision.action).toBe("knowledge");
    expect(log.decision.action).not.toBe("safety");
    expect(reply).toContain("Pentru ADBL Typhoon, conform descrierii producatorului:");
    expect(reply).not.toContain("ADB-TYP");
    expect(reply).toContain(snippet.slice(0, 20));
  });

  it("anti_rec_warning via knowledge: Koch MZR on piele (not safety)", async () => {
    const snippet = whatItIsNotSnippet("86001");
    const sessionId = `may31-mzr-safe-${Date.now()}`;
    const res = await handleChat("pot folosi Koch MZR pe piele?", "C1", products, sessionId);
    const log = lastLog();

    expect(log.decision.action).toBe("knowledge");
    expect(log.decision.action).not.toBe("safety");
    expect(String(res.reply || res.message || "")).toContain(snippet.slice(0, 20));
  });

  it("negative_path_decline: non-tier-1 Meguiar Hot Rims", async () => {
    const sessionId = `may31-decline-meg-${Date.now()}`;
    const res = await handleChat("cum aplic Meguiar's Hot Rims?", "C1", products, sessionId);
    const log = lastLog();
    const reply = String(res.reply || res.message || "");

    expect(log.decision.action).toBe("knowledge");
    expect(log.decision.selection?.empty).toBe(true);
    expect(reply).toMatch(/Nu am un extras structurat/i);
    expect(reply).toMatch(
      /reformula intrebarea sau alege un produs din gama noastra principala \(Koch Chemie, Gtechniq, ADBL, ZviZZer, Ewocar\)/i
    );
    expect(reply).not.toMatch(/tier-1/i);
    expect(reply).not.toMatch(/Pasul 1:/i);
  });

  it("retrieval_fallback: tier-1 SKU missing whatNext serves fallback section", async () => {
    expect(getEntry("132001")?.sectionPresence?.whatNext).toBe("missing");
    expect(getEntry("132001")?.sectionPresence?.whatIs).toBe("present");

    const sessionId = `may31-fallback-whatnext-${Date.now()}`;
    const res = await handleChat("ce urmeaza dupa Koch Chemie Top Star?", "C1", products, sessionId);
    const log = lastLog();
    const reply = String(res.reply || res.message || "");

    expect(log.decision.action).toBe("knowledge");
    expect(reply).not.toMatch(/Nu am un extras structurat/i);
    expect(reply).toMatch(/Koch Chemie Top Star|Top Star/i);
  });
});
