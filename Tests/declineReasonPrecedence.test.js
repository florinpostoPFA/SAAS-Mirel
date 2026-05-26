const { __test } = require("../services/chatService");
const { resolveApplicabilityDeclineReason, filterProducts, filterByUseCase, filterByFlow } = __test;
const { loadSession, resetAllSessions, persistSession } = require("../services/sessionLifecycle");
const { handleChat } = require("../services/chatService");

describe("decline-reason hierarchy: applicability-based misses precedence", () => {
  beforeEach(() => {
    resetAllSessions();
  });

  test("resolveApplicabilityDeclineReason: material wipe → applicability_material_incompatible", () => {
    const result = resolveApplicabilityDeclineReason(3, 0, 0, 0);
    expect(result).toBe("applicability_material_incompatible");
  });

  test("resolveApplicabilityDeclineReason: use_case wipe → applicability_use_case_mismatch", () => {
    const result = resolveApplicabilityDeclineReason(3, 2, 0, 0);
    expect(result).toBe("applicability_use_case_mismatch");
  });

  test("resolveApplicabilityDeclineReason: flow wipe → applicability_flow_mismatch", () => {
    const result = resolveApplicabilityDeclineReason(3, 2, 2, 0);
    expect(result).toBe("applicability_flow_mismatch");
  });

  test("resolveApplicabilityDeclineReason: no wipe → null (fallthrough)", () => {
    const result = resolveApplicabilityDeclineReason(3, 2, 2, 1);
    expect(result).toBeNull();
  });

  test("resolveApplicabilityDeclineReason: empty input → null", () => {
    const result = resolveApplicabilityDeclineReason(0, 0, 0, 0);
    expect(result).toBeNull();
  });

  test("material_compatibility rejection on tier-1 product → applicability_material_incompatible", async () => {
    const sessionId = `decline-material-${Date.now()}`;
    const session = loadSession(sessionId);
    session.slots = { context: "exterior", surface: "paint", object: null };
    session.slotMeta = { context: "confirmed", surface: "confirmed", object: "unknown" };
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = true;
    session.pendingSelectionMissingSlot = null;
    session.tags = ["cleaning", "exterior"];
    session.previousAction = "selection";
    persistSession(sessionId, session);

    const products = [
      {
        id: "WSR1",
        name: "Koch Chemie WSR",
        tags: ["glass", "glass_cleaner", "exterior"],
        description: "water spot remover acid pentru sticla",
        applicability: { material_compatibility: ["glass", "plastic"] },
        manufacturerId: "koch_chemie"
      }
    ];

    const result = await handleChat("recomanda produs pentru vopsea", "C1", products, sessionId);
    const reply = String(result.reply || result.message || "");
    expect(result.productsReason || result.meta?.productsReason || "no_matching_products")
      .not.toBe("tier_one_unavailable");
  });

  test("genuine tier_one_unavailable when only non-tier-1 products exist", async () => {
    const sessionId = `decline-tier1-${Date.now()}`;
    const session = loadSession(sessionId);
    session.slots = { context: "exterior", surface: "paint", object: null };
    session.slotMeta = { context: "confirmed", surface: "confirmed", object: "unknown" };
    session.state = "IDLE";
    session.pendingQuestion = null;
    session.pendingSelection = true;
    session.pendingSelectionMissingSlot = null;
    session.tags = ["paint", "exterior"];
    session.previousAction = "selection";
    persistSession(sessionId, session);

    const products = [
      {
        id: "NTR1",
        name: "NoName Polish",
        tags: ["paint", "exterior", "polish"],
        description: "polish pentru vopsea",
        manufacturerId: "no_name_brand_xyz"
      }
    ];

    const result = await handleChat("recomanda polish pentru vopsea", "C1", products, sessionId);
    const reply = String(result.reply || result.message || "");
    expect(reply.length).toBeGreaterThan(0);
  });
});
