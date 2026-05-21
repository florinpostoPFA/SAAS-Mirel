/**
 * End-to-end brand routing probes (ticket: brand name in user query).
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
const { handleChat } = require("../services/chatService");

function loadCatalog() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "products.json"), "utf8")
  );
}

function lastInteraction() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

async function runProbe(message, products, sessionId) {
  const result = await handleChat(message, "C1", products, sessionId);
  const log = lastInteraction();
  const productsOut = log?.output?.products || result?.products || [];
  return {
    traceId: log?.traceId || null,
    tags: log?.intent?.tags || log?.analysis?.tags || [],
    slots: log?.slots || log?.analysis?.slots || {},
    products: productsOut,
    productsLength: productsOut.length,
    decision: log?.decision || {},
    reply: String(result?.message || result?.reply || "")
  };
}

function isKochProduct(p) {
  const brand = String(p?.brand || "").toLowerCase();
  const name = String(p?.name || "").toLowerCase();
  return brand.includes("koch") || /\bkoch\s+chemie\b/.test(name);
}

function isGtechniqProduct(p) {
  const brand = String(p?.brand || "").toLowerCase();
  const name = String(p?.name || "").toLowerCase();
  return brand.includes("gtechniq") || /\bgtechniq\b/.test(name);
}

describe("brand routing — handleChat acceptance probes", () => {
  const products = loadCatalog();

  beforeEach(() => {
    jest.clearAllMocks();
    askLLM.mockResolvedValue("Produs potrivit pentru jante.");
  });

  it("Probe A: Koch Chemie + jante returns tier-1 Koch product", async () => {
    const query = "ce produs Koch Chemie aveti pentru jante";
    const out = await runProbe(query, products, `brand-koch-${Date.now()}`);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        probe: "A",
        query,
        traceId: out.traceId,
        tags: out.tags,
        slots: out.slots,
        productsLength: out.productsLength,
        products: out.products.slice(0, 3).map((p) => ({
          sku: p.sku || p.id,
          name: p.name,
          brand: p.brand,
          manufacturerId: p.manufacturerId
        })),
        decision: out.decision
      })
    );

    expect(out.slots.brand).toBe("Koch Chemie");
    expect(out.productsLength).toBeGreaterThanOrEqual(1);
    expect(out.products.some(isKochProduct)).toBe(true);
    expect(out.decision.action).not.toBe("knowledge");
    expect(out.reply).not.toContain("Nu sunt sigur că îți pot da un răspuns corect");
  });

  it("Probe B: Gtechniq + jante returns Gtechniq SKU or clean no_match", async () => {
    const query = "ce produs Gtechniq aveti pentru jante";
    const out = await runProbe(query, products, `brand-gtechniq-${Date.now()}`);

    expect(out.slots.brand).toBe("Gtechniq");

    const hasGtechniq = out.products.some(isGtechniqProduct);
    const cleanEmpty =
      out.productsLength === 0 &&
      (out.decision.productsReason === "no_matching_products" ||
        out.decision.action === "knowledge");

    expect(hasGtechniq || cleanEmpty).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        probe: "B",
        query,
        traceId: out.traceId,
        tags: out.tags,
        slots: out.slots,
        productsLength: out.productsLength,
        products: out.products.slice(0, 3).map((p) => ({
          sku: p.sku || p.id,
          name: p.name,
          brand: p.brand,
          manufacturerId: p.manufacturerId
        })),
        decision: out.decision
      })
    );
  });
});
