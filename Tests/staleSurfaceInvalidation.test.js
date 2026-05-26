const { __test } = require("../services/chatService");
const { invalidateStaleSurfaceFromTags, TAG_SURFACE_INCOMPATIBLE } = __test;
const { loadSession, resetAllSessions, persistSession } = require("../services/sessionLifecycle");
const { handleChat } = require("../services/chatService");

describe("stale slot persistence: tag invalidates incompatible surface", () => {
  beforeEach(() => {
    resetAllSessions();
  });

  test("ceramic_coating tag invalidates stale surface=glass", () => {
    const slots = { surface: "glass", object: "glass", context: "exterior" };
    const tags = ["ceramic_coating", "exterior"];
    const result = invalidateStaleSurfaceFromTags(slots, tags, "test-session");
    expect(result).not.toBeNull();
    expect(result.surface).toBe("glass");
    expect(slots.surface).toBeNull();
    expect(slots.object).toBeNull();
  });

  test("glass tag does NOT invalidate surface=glass (same category)", () => {
    const slots = { surface: "glass", object: "glass", context: "exterior" };
    const tags = ["glass", "exterior"];
    const result = invalidateStaleSurfaceFromTags(slots, tags, "test-session");
    expect(result).toBeNull();
    expect(slots.surface).toBe("glass");
  });

  test("wheel tag invalidates stale surface=glass", () => {
    const slots = { surface: "glass", object: "glass", context: "exterior" };
    const tags = ["wheels", "exterior"];
    const result = invalidateStaleSurfaceFromTags(slots, tags, "test-session");
    expect(result).not.toBeNull();
    expect(slots.surface).toBeNull();
    expect(slots.object).toBeNull();
  });

  test("no invalidation when surface is null", () => {
    const slots = { surface: null, object: null, context: "exterior" };
    const tags = ["ceramic_coating"];
    const result = invalidateStaleSurfaceFromTags(slots, tags, "test-session");
    expect(result).toBeNull();
  });

  test("glass turn → 'vreu ceramica' → returns coating products, not glass cleaners", async () => {
    const sessionId = `stale-glass-ceramic-${Date.now()}`;
    const session = loadSession(sessionId);
    session.slots = { context: "exterior", surface: "glass", object: "glass" };
    session.slotMeta = { context: "confirmed", surface: "confirmed", object: "confirmed" };
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = true;
    session.pendingSelectionMissingSlot = null;
    session.tags = ["glass", "exterior"];
    session.previousAction = "selection";
    persistSession(sessionId, session);

    const products = [
      { id: "glass1", name: "Koch Glass Cleaner", tags: ["glass", "glass_cleaner", "exterior"], description: "solutie geamuri" },
      { id: "coat1", name: "Gtechniq Crystal Serum", tags: ["ceramic_coating", "coating", "exterior"], description: "coating ceramic protectie vopsea" },
      { id: "coat2", name: "Koch Chemie CSL", tags: ["ceramic_coating", "coating", "exterior"], description: "ceramic spray sealant protectie" }
    ];

    const result = await handleChat("vreu ceramica", "C1", products, sessionId);
    const reply = String(result.reply || result.message || "");
    const s = loadSession(sessionId);
    expect(s.slots.surface).not.toBe("glass");
    expect(reply).not.toMatch(/Glass Cleaner/i);
  });

  test("glass turn → explicit glass follow-up → still returns glass cleaners", async () => {
    const sessionId = `stale-glass-glass-${Date.now()}`;
    const session = loadSession(sessionId);
    session.slots = { context: "exterior", surface: "glass", object: "glass" };
    session.slotMeta = { context: "confirmed", surface: "confirmed", object: "confirmed" };
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = true;
    session.pendingSelectionMissingSlot = null;
    session.tags = ["glass", "exterior"];
    session.previousAction = "selection";
    persistSession(sessionId, session);

    const products = [
      { id: "glass1", name: "Koch Glass Cleaner", tags: ["glass", "glass_cleaner", "exterior"], description: "solutie geamuri auto" },
      { id: "coat1", name: "Gtechniq Crystal Serum", tags: ["ceramic_coating", "coating", "exterior"], description: "coating ceramic" }
    ];

    const result = await handleChat("vreau solutie pentru geamuri", "C1", products, sessionId);
    const s = loadSession(sessionId);
    expect(s.slots.surface).toBe("glass");
  });

  test("wheel turn → 'vreu ceramica' → returns coating products", async () => {
    const sessionId = `stale-wheel-ceramic-${Date.now()}`;
    const session = loadSession(sessionId);
    session.slots = { context: "exterior", surface: "wheels", object: "wheels" };
    session.slotMeta = { context: "confirmed", surface: "confirmed", object: "confirmed" };
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = true;
    session.pendingSelectionMissingSlot = null;
    session.tags = ["wheels", "exterior"];
    session.previousAction = "selection";
    persistSession(sessionId, session);

    const products = [
      { id: "wheel1", name: "Koch Wheel Cleaner", tags: ["wheels", "wheel_cleaner", "exterior"], description: "solutie jante" },
      { id: "coat1", name: "Gtechniq Crystal Serum", tags: ["ceramic_coating", "coating", "exterior"], description: "coating ceramic protectie vopsea" }
    ];

    const result = await handleChat("vreu ceramica", "C1", products, sessionId);
    const s = loadSession(sessionId);
    expect(s.slots.surface).not.toBe("wheels");
  });

  test("wheel turn → explicit wheel follow-up → still returns wheel cleaners", async () => {
    const sessionId = `stale-wheel-wheel-${Date.now()}`;
    const session = loadSession(sessionId);
    session.slots = { context: "exterior", surface: "wheels", object: "wheels" };
    session.slotMeta = { context: "confirmed", surface: "confirmed", object: "confirmed" };
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = true;
    session.pendingSelectionMissingSlot = null;
    session.tags = ["wheels", "exterior"];
    session.previousAction = "selection";
    persistSession(sessionId, session);

    const products = [
      { id: "wheel1", name: "Koch Wheel Cleaner", tags: ["wheels", "wheel_cleaner", "exterior"], description: "solutie jante curatare" },
      { id: "coat1", name: "Gtechniq Crystal Serum", tags: ["ceramic_coating", "coating", "exterior"], description: "coating ceramic" }
    ];

    const result = await handleChat("vreau sa curat jantele", "C1", products, sessionId);
    const s = loadSession(sessionId);
    expect(s.slots.surface).toBe("wheels");
  });
});
