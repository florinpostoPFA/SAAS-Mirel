jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { appendInteractionLine } = require("../services/interactionLog");
const { hasExplicitCommerceProductIntent } = require("../services/commerceIntentSignals");
const {
  formatFlowReply,
  formatSelectionReply,
  formatSafetyReplyRo
} = require("../services/responseFormatTemplates");
const { handleChat, __test } = require("../services/chatService");

describe("P1.12 commerce intent signals", () => {
  it("detects Romanian purchase / link / recommendation phrasing", () => {
    expect(hasExplicitCommerceProductIntent("Ce solutie de care e potrivita?")).toBe(true);
    expect(hasExplicitCommerceProductIntent("Trimite link catre produs")).toBe(true);
    expect(hasExplicitCommerceProductIntent("Imi recomanzi ceva pentru jante?")).toBe(true);
    expect(hasExplicitCommerceProductIntent("Ce sa cumpar pentru piele?")).toBe(true);
    expect(hasExplicitCommerceProductIntent("cum curat pielea")).toBe(false);
  });
});

describe("P1.9 response format templates", () => {
  it("wraps flow and selection copy deterministically", () => {
    const flow = formatFlowReply({
      title: "Test flow",
      body: "1. Pas unu\n2. Pas doi",
      locale: "ro"
    });
    expect(flow).toMatch(/^— Flux recomandat —/);
    expect(flow).toContain("Subiect: Test flow");
    expect(flow).toContain("1. Pas unu");

    const sel = formatSelectionReply({
      body: "• Soluție:\n- Cleaner",
      narrowingQuestion: "Murdărie ușoară sau grea?",
      locale: "ro"
    });
    expect(sel).toMatch(/^— Recomandări produse —/);
    expect(sel).toContain("• Soluție:");
    expect(sel).toContain("Murdărie ușoară sau grea?");

    const safety = formatSafetyReplyRo("DA.\nLinia unu.");
    expect(safety).toMatch(/^— Siguranță —/);
    expect(safety).toContain("Condiții:");
  });
});

describe("P1.10 filterProducts + slot object gate", () => {
  it("drops glass SKU when object slot is jante (passesSlotObjectRole gate)", () => {
    const { filterProducts } = __test;
    const wrong = {
      id: "gl",
      name: "Glass Cleaner",
      description: "Pentru geamuri si parbriz.",
      tags: ["exterior", "glass", "cleaner"]
    };
    const kept = {
      id: "wh",
      name: "Wheel Cleaner",
      description: "Curatare jante si metal.",
      tags: ["exterior", "wheels", "wheel_cleaner", "cleaner"]
    };
    const slots = { context: "exterior", object: "jante", surface: "wheels" };
    const out = filterProducts([wrong, kept], slots);
    expect(out.map((p) => p.id)).toEqual(["wh"]);
  });
});

describe("P1.13 session tag reinforcement", () => {
  it("keeps session tags only when echoed in message or present in core tags", () => {
    const { sessionTagsReinforcedByCurrentMessage } = __test;
    expect(
      sessionTagsReinforcedByCurrentMessage(["paint", "bug_remover"], ["interior"], "curat piele")
    ).toEqual([]);
    expect(
      sessionTagsReinforcedByCurrentMessage(["paint", "interior"], ["interior"], "curat piele")
    ).toEqual(["interior"]);
    expect(
      sessionTagsReinforcedByCurrentMessage(["wax"], [], "wax pentru protectie vopsea")
    ).toEqual(["wax"]);
    expect(
      sessionTagsReinforcedByCurrentMessage(["cleaning"], [], "cum spal scaunul")
    ).toEqual(["cleaning"]);
  });
});

describe("P1.12 knowledge gate → selection (regression)", () => {
  it("escapes knowledge downgrade to informational when user asks for a link (queryType selection)", async () => {
    const sessionId = `p112-${Date.now()}`;
    const products = [
      {
        id: "w1",
        name: "Wax Protect Exterior",
        description: "Wax pentru protectie vopsea exterior.",
        short_description: "Wax exterior.",
        tags: ["exterior", "paint", "wax", "protection"]
      }
    ];
    await handleChat("cum functioneaza waxul auto si link catre produs", "C1", products, sessionId);
    const entry = appendInteractionLine.mock.calls[appendInteractionLine.mock.calls.length - 1][0];
    expect(entry.intent.queryType).toBe("selection");
  });
});
