/**
 * Launch-blocker hardening: metal tag guard + tier-1 gate (AC1, AC3, AC4, AC5).
 * @jest-environment node
 */

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn(() => ({ reply: "", products: [] }))
}));

const fs = require("fs");
const path = require("path");
const { askLLM } = require("../services/llm");
const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat, __test } = require("../services/chatService");
const { applyDeterministicTagFallback } = require("../services/chatService").__test;
const { detectTagsByRules } = require("../services/tagService");
const { stripInferredMaterialTags, userMentionedExplicitMaterial } = require("../services/materialTagGuard");
const { wheelTireTagBoost } = require("../services/wheelTireSemantics");

const TIER_ONE_IDS = new Set([13, 39, 44, 70, 92]);
const DEAD_END_SNIPPET = "Nu sunt sigur că îți pot da un răspuns corect";

function loadCatalog() {
  const raw = fs.readFileSync(path.join(__dirname, "..", "data", "products.json"), "utf8");
  return JSON.parse(raw);
}

function simulateIntentTags(message) {
  const raw = detectTagsByRules(message, []);
  return applyDeterministicTagFallback(message, raw);
}

function lastInteraction() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

function tierOneWheelProduct(products) {
  return products.find((p) => {
    const n = String(p.name || "").toLowerCase();
    return (
      TIER_ONE_IDS.has(Number(p.manufacturerId)) &&
      /wheel|jante|reactive|decontaminare jante|iron|fallout|acid/.test(n)
    );
  });
}

async function runProbe(message, products, sessionId) {
  const result = await handleChat(message, "C1", products, sessionId);
  const log = lastInteraction();
  return {
    result,
    log,
    tags:
      log?.intent?.tags ||
      log?.analysis?.tags ||
      simulateIntentTags(message),
    action: log?.decision?.action,
    reasonCode: log?.decision?.reasonCode,
    products: log?.output?.products || result?.products || [],
    productsLength: (log?.output?.products || result?.products || []).length,
    traceId: log?.traceId || null,
    reply: String(result?.message || result?.reply || "")
  };
}

describe("materialTagGuard — AC1 / AC4 / AC5 tag expectations", () => {
  const genericWheel = "recomanda-mi o solutie pentru curatat jantele";
  const aluminum = "solutie pentru aluminiu si jante";

  test("AC1: generic wheel probes do not include metal", () => {
    for (const msg of [
      genericWheel,
      "ce produs pentru jante murdare",
      "cum curat jantele masinii"
    ]) {
      const tags = simulateIntentTags(msg);
      expect(tags).toContain("wheels");
      expect(tags).not.toContain("metal");
      expect(wheelTireTagBoost(msg)).not.toContain("metal");
    }
  });

  test("AC4: explicit aluminiu keeps metal", () => {
    const tags = simulateIntentTags(aluminum);
    expect(tags).toContain("metal");
    expect(userMentionedExplicitMaterial(aluminum)).toBe(true);
  });

  test("AC5: cross-surface probes do not auto-tag metal", () => {
    const cases = [
      { msg: "vreau ceva pentru piele", forbidden: ["metal"] },
      { msg: "vreau ceva pentru plastic interior", forbidden: ["metal"] },
      { msg: "vreau ceva pentru vopsea", forbidden: ["metal"] }
    ];
    for (const { msg, forbidden } of cases) {
      const tags = simulateIntentTags(msg);
      for (const f of forbidden) {
        expect(tags).not.toContain(f);
      }
    }
  });

  test("stripInferredMaterialTags removes metal from polluted LLM tag sets", () => {
    const msg = "ce recomanzi pentru curatat jantele ?";
    const stripped = stripInferredMaterialTags(msg, [
      "cleaning",
      "exterior",
      "wheels",
      "metal"
    ]);
    expect(stripped).toEqual(["cleaning", "exterior", "wheels"]);
  });
});

describe("metal tag launch blocker — handleChat with tier-1 gate ON", () => {
  const products = loadCatalog();
  const tier1Wheel = tierOneWheelProduct(products);

  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue(
      "Îți recomand un produs potrivit pentru curățarea jantelor, aplicat pe suprafață rece."
    );
  });

  it("AC3: replay probes return tier-1 wheel products (gate ON)", async () => {
    expect(tier1Wheel).toBeTruthy();

    const probes = [
      { label: "trace-2e23bbf6 replay", query: "ce recomanzi pentru curatat jantele ?" },
      {
        label: "trace-14d4901d replay",
        query: "recomanda-mi o solutie pentru curatat jantele"
      }
    ];

    for (const { label, query } of probes) {
      const sessionId = `ac3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const out = await runProbe(query, products, sessionId);

      expect(out.tags).not.toContain("metal");
      expect(out.productsLength).toBeGreaterThanOrEqual(1);
      const first = out.products[0];
      expect(TIER_ONE_IDS.has(Number(first?.manufacturerId))).toBe(true);
      expect(out.reply).not.toContain(DEAD_END_SNIPPET);
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          label,
          traceId: out.traceId,
          tags: out.tags,
          action: out.action,
          reasonCode: out.reasonCode,
          sku: first?.id,
          brand: first?.brand,
          productsLength: out.productsLength
        })
      );
    }
  });

  it("AC1 sweep: recommend-shaped wheel phrasings → no metal, ≥1 tier-1 product each", async () => {
    const queries = [
      "recomanda-mi o solutie pentru curatat jantele",
      "ce produs pentru jante murdare"
    ];

    for (const query of queries) {
      const sessionId = `ac1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const out = await runProbe(query, products, sessionId);
      expect(out.tags).not.toContain("metal");
      expect(out.productsLength).toBeGreaterThanOrEqual(1);
      expect(TIER_ONE_IDS.has(Number(out.products[0]?.manufacturerId))).toBe(true);
    }
  });

  it("AC1 procedural: cum curat jantele routes wheel flow without metal tag (F31 shipped)", async () => {
    const sessionId = `ac1-proc-${Date.now()}`;
    const out = await runProbe("cum curat jantele masinii", products, sessionId);
    expect(out.tags).not.toContain("metal");
    expect(out.action).toBe("flow");
    expect(out.log?.decision?.flowId).toBe("wheel_tire_deep_clean");
    expect(out.reply).not.toContain(DEAD_END_SNIPPET);
  });

  it("AC4: aluminiu probe includes metal tag and avoids dead-end fallback", async () => {
    const sessionId = `ac4-${Date.now()}`;
    const query = "recomanda-mi o solutie pentru jante din aluminiu";
    const out = await runProbe(query, products, sessionId);
    expect(out.tags).toContain("metal");
    expect(out.reply).not.toContain(DEAD_END_SNIPPET);
    const hasProduct = out.productsLength >= 1;
    const graceful =
      !hasProduct &&
      (out.action === "clarification" ||
        out.action === "knowledge" ||
        out.type === "question" ||
        out.action === "flow");
    expect(hasProduct || graceful).toBe(true);
  });
});
