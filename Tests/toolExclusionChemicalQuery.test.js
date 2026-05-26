const { __test } = require("../services/chatService");
const { excludeToolsForChemicalQuery, isToolProduct, hasChemicalProductSignal, hasExplicitToolIntent } = __test;
const { loadSession, resetAllSessions, persistSession } = require("../services/sessionLifecycle");
const { handleChat } = require("../services/chatService");

describe("tool-exclusion for chemical product queries", () => {
  beforeEach(() => {
    resetAllSessions();
  });

  test("isToolProduct detects sponge/applicator products", () => {
    expect(isToolProduct({ name: "Burete aplicator Koch Chemie", tags: ["tool"] })).toBe(true);
    expect(isToolProduct({ name: "Microfibra ADBL", tags: ["microfiber"] })).toBe(true);
    expect(isToolProduct({ name: "Koch Chemie FSE", tags: ["polish", "exterior"] })).toBe(false);
  });

  test("hasChemicalProductSignal detects polish/wax/coating tags", () => {
    expect(hasChemicalProductSignal(["polish", "plastic"])).toBe(true);
    expect(hasChemicalProductSignal(["wax", "exterior"])).toBe(true);
    expect(hasChemicalProductSignal(["interior", "plastic"])).toBe(false);
  });

  test("hasExplicitToolIntent detects tool-specific messages", () => {
    expect(hasExplicitToolIntent("vreau un burete aplicator")).toBe(true);
    expect(hasExplicitToolIntent("recomanda un microfibra")).toBe(true);
    expect(hasExplicitToolIntent("care-i cel mai bun polish")).toBe(false);
  });

  test("excludeToolsForChemicalQuery removes tools when polish tag present", () => {
    const products = [
      { id: "sponge1", name: "Burete aplicator Koch", tags: ["tool", "interior"] },
      { id: "polish1", name: "Koch Plast Star", tags: ["polish", "plastic", "interior"] }
    ];
    const result = excludeToolsForChemicalQuery(products, ["polish", "plastic"], "polish pentru plastice");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("polish1");
  });

  test("excludeToolsForChemicalQuery keeps tools when explicit tool intent", () => {
    const products = [
      { id: "sponge1", name: "Burete aplicator Koch", tags: ["tool", "interior"] },
      { id: "polish1", name: "Koch Plast Star", tags: ["polish", "plastic", "interior"] }
    ];
    const result = excludeToolsForChemicalQuery(products, ["wax"], "vreau un burete aplicator pentru ceara");
    expect(result).toHaveLength(2);
  });

  test("excludeToolsForChemicalQuery preserves all when no chemical signal", () => {
    const products = [
      { id: "sponge1", name: "Burete aplicator Koch", tags: ["tool", "interior"] },
      { id: "misc1", name: "Koch Interior", tags: ["interior"] }
    ];
    const result = excludeToolsForChemicalQuery(products, ["interior", "plastic"], "produs interior");
    expect(result).toHaveLength(2);
  });

  test("excludeToolsForChemicalQuery returns all if exclusion would leave empty set", () => {
    const products = [
      { id: "sponge1", name: "Burete aplicator Koch", tags: ["tool", "interior"] }
    ];
    const result = excludeToolsForChemicalQuery(products, ["polish", "plastic"], "polish pentru plastice");
    expect(result).toHaveLength(1);
  });

  test("integration: 'polish pentru plastice' does not return sponge as top result", async () => {
    const sessionId = `tool-excl-polish-${Date.now()}`;
    const session = loadSession(sessionId);
    session.slots = { context: "interior", surface: "plastic", object: null };
    session.slotMeta = { context: "confirmed", surface: "confirmed", object: "unknown" };
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = true;
    session.pendingSelectionMissingSlot = null;
    session.tags = ["plastic", "interior"];
    session.previousAction = "selection";
    persistSession(sessionId, session);

    const products = [
      { id: "999290", name: "Burete aplicator Koch Chemie", tags: ["tool", "interior", "plastic"], description: "burete aplicator" },
      { id: "PS1", name: "Koch Plast Star", tags: ["polish", "plastic", "interior", "plastic_interior"], description: "polish pentru plastice interior" }
    ];

    const result = await handleChat("care-i cel mai bun polish pentru plastice?", "C1", products, sessionId);
    const reply = String(result.reply || result.message || "");
    expect(reply).not.toMatch(/Burete aplicator/i);
  });

  test("REGRESSION: 'burete aplicator' query bypasses tool exclusion even with wax tag", () => {
    const products = [
      { id: "999290", name: "Burete aplicator Koch Chemie", tags: ["tool", "exterior"], description: "burete aplicator" },
      { id: "WAX1", name: "Koch Wax", tags: ["wax", "exterior"], description: "ceara auto" }
    ];
    const result = excludeToolsForChemicalQuery(products, ["wax", "exterior"], "vreau un burete aplicator pentru ceara");
    expect(result).toHaveLength(2);
    expect(result.some(p => p.id === "999290")).toBe(true);
  });
});
