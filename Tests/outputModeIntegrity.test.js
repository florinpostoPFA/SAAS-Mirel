jest.mock("../services/llm", () => ({
  askLLM: jest.fn().mockResolvedValue("Răspuns stub.")
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { appendInteractionLine } = require("../services/interactionLog");
const { handleChat, __test } = require("../services/chatService");
const { formatSelectionReply } = require("../services/responseFormatTemplates");

function lastLog() {
  const calls = appendInteractionLine.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : null;
}

function replyText(result) {
  return String(result?.message || result?.reply || "").trim();
}

const LEATHER_CLEANER = {
  id: "lc-777",
  name: "Solutie curatare piele Leather Cleaner Koch Chemie, 500ml",
  description: "Curatare eficienta piele naturala si sintetica.",
  tags: ["leather", "leather_cleaner", "cleaner", "cleaning", "interior"],
  stock: 5,
  manufacturerId: "13"
};

const LEATHER_HYDRATION = {
  id: "77709500",
  name: "Solutie hidratare piele Protect Leather Care Koch Chemie, 500ml",
  description: "Hidratare si protectie dupa curatare.",
  tags: ["leather", "leather_conditioner", "protection", "interior"],
  stock: 5,
  manufacturerId: "13"
};

const TEXTILE_PRODUCT = {
  id: "textile-1",
  name: "Textile Upholstery Cleaner",
  tags: ["textile", "textile_cleaner", "interior", "cleaning", "stain_remover"],
  stock: 5,
  manufacturerId: "13"
};

const WAX_PRODUCT = {
  id: "wax-1",
  name: "Ceara auto lichida Gold Class Carnauba Plus Premium Meguiar's, 473ml",
  description: "Ceara lichida cu carnauba pentru luciu exterior.",
  tags: ["exterior", "paint", "wax", "protection"],
  stock: 5,
  manufacturerId: "13"
};

const GLASS_CLEANER = {
  id: "gc-1",
  name: "Solutie curatare sticla Speed Glass Cleaner Koch Chemie, 750ml",
  tags: ["exterior", "glass", "glass_cleaner", "cleaning"],
  stock: 5,
  manufacturerId: "13"
};

const TIRE_DRESSING = {
  id: "td-1",
  name: "Dressing luciu anvelope ADBL Black Water, 500ml",
  tags: ["exterior", "tire_dressing", "tires", "dressing"],
  stock: 5,
  manufacturerId: "13"
};

describe("F36 output mode integrity — unit", () => {
  it("formatSelectionReply_noAutonomousNarrowing", () => {
    const plain = formatSelectionReply({ body: "• Soluție:\n- Produs", locale: "ro" });
    expect(plain).not.toMatch(/\bClarificare:/);
    const armed = formatSelectionReply({
      body: "• Soluție:\n- Produs",
      includeNarrowing: true,
      narrowingQuestion: "Ușoară sau grea?",
      locale: "ro"
    });
    expect(armed).toContain("Clarificare:");
    expect(armed).toContain("Ușoară sau grea?");
  });

  it("formatSelectionResponse recommendation shell has no Clarificare block", () => {
    const { formatSelectionResponse } = __test;
    const text = formatSelectionResponse(
      [{ name: "Dressing luciu anvelope", tags: ["tire_dressing", "exterior"] }],
      { locale: "ro" }
    );
    expect(text).toMatch(/^— Recomandări produse —/);
    expect(text).not.toMatch(/\bClarificare:/);
  });
});

describe("F36 output mode integrity — E2E", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TIER_ONE_GATE_ENABLED = "0";
  });

  it("outputMode_leatherMurdar_singleMode — no recommend + Clarificare combo", async () => {
    const sid = `f36-murdar-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, LEATHER_HYDRATION];
    const result = await handleChat(
      "recomanda o solutie pentru un scaun de piele murdar",
      "C1",
      catalog,
      sid
    );
    const log = lastLog();
    const msg = replyText(result);
    const hasProducts = Array.isArray(result.products) && result.products.length > 0;
    const hasClarificareBlock = /\bClarificare:/i.test(msg);
    const isQuestion = log.output?.type === "question" || result.type === "question";

    expect(hasClarificareBlock && hasProducts).toBe(false);
    expect(hasClarificareBlock && isQuestion).toBe(false);
    if (hasProducts) {
      expect(log.decision.action).toMatch(/recommend|selection/);
      expect(log.output?.type).toBe("recommendation");
    }
  });

  it("outputMode_leatherMurdar_cleaningNotHydration — F36-2b AC3 product filter", async () => {
    const sid = `f36-clean-role-${Date.now()}`;
    const result = await handleChat(
      "recomanda o solutie pentru un scaun de piele murdar",
      "C1",
      [LEATHER_CLEANER, LEATHER_HYDRATION],
      sid
    );
    const log = lastLog();
    if (log.decision.action === "recommend" && log.output?.type === "recommendation") {
      const names = (result.products || []).map((p) => String(p.name || "").toLowerCase()).join(" ");
      expect(names).not.toMatch(/hidratare|protect leather care/i);
    }
  });

  it("outputMode_telemetry_askedClarification — question turns set telemetry", async () => {
    const sid = `f36-telem-${Date.now()}`;
    const result = await handleChat("am cotiera foarte murdara", "C1", [TEXTILE_PRODUCT], sid);
    const log = lastLog();
    const msg = replyText(result);
    expect(log.output?.type).toBe("question");
    expect(Boolean(log.askedClarification)).toBe(true);
    if (/\?/.test(msg) || /\bClarificare:/i.test(msg)) {
      expect(Boolean(log.askedClarification)).toBe(true);
    }
  });

  it("outputMode_coverageRoleGoal_mutex — piele after surface clarify recommends (F48)", async () => {
    const sid = `f36-cov-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, LEATHER_HYDRATION, TEXTILE_PRODUCT];
    await handleChat("am cotiera foarte murdara", "C1", catalog, sid);
    const result = await handleChat("piele", "C1", catalog, sid);
    const log = lastLog();
    const msg = replyText(result);

    expect(log.decision.action).toMatch(/recommend|selection/);
    expect(log.decision.reasonCode).not.toBe("routing.coverage_role_goal");
    expect(log.pendingQuestion).toBeFalsy();
    expect(msg).not.toMatch(/cureti|protejezi|hidratezi/i);
  });

  it("outputMode_coverageRoleGoal_3turn_integration — prod replay recommends at T3 (F48)", async () => {
    const sid = `f36-cov3-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, LEATHER_HYDRATION, TEXTILE_PRODUCT];
    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    await handleChat("cotiera", "C1", catalog, sid);
    const result = await handleChat("piele", "C1", catalog, sid);
    const log = lastLog();
    const msg = replyText(result);

    expect(log.decision.action).toMatch(/recommend|selection/);
    expect(log.decision.reasonCode).not.toBe("routing.coverage_role_goal");
    expect(log.slots?.action).toBe("clean");
    expect(log.slots?.surface).toBe("piele");
    expect(log.slots?.object).toBe("cotiera");
    expect(log.pendingQuestion).toBeFalsy();
    expect(msg).not.toMatch(/cureti|protejezi|hidratezi/i);
  });

  it("F48 3-turn leather flow preserves slots and recommends cleaner at piele", async () => {
    const sid = `f43-cov4-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, LEATHER_HYDRATION, TEXTILE_PRODUCT];
    await handleChat("vreau sa curat pielea", "C1", catalog, sid);
    await handleChat("cotiera", "C1", catalog, sid);
    const result = await handleChat("piele", "C1", catalog, sid);
    const log = lastLog();
    const msg = replyText(result);

    expect(log.slots?.context).toBe("interior");
    expect(log.slots?.object).toBe("cotiera");
    expect(log.slots?.surface).toBe("piele");
    expect(log.slots?.action).toBe("clean");
    expect(log.pendingQuestion).toBeFalsy();
    expect(log.decision.action).toMatch(/recommend|selection/);
    expect(log.decision.missingSlot).toBeNull();
    expect(msg).not.toMatch(/interiorul sau exteriorul|cureti|protejezi/i);
    if ((result.products || []).length > 0) {
      const names = result.products.map((p) => String(p.name || "").toLowerCase()).join(" ");
      expect(names).toMatch(/curatare piele|leather cleaner/i);
      expect(names).not.toMatch(/hidratare|protect leather care/i);
    }
  });

  it("outputMode_wax_actionFilter — wax intent returns wax SKU not glass cleaner", async () => {
    const sid = `f36-wax-${Date.now()}`;
    const catalog = [WAX_PRODUCT, GLASS_CLEANER];
    const result = await handleChat("vreau sau dau cu ceara la exterior", "C1", catalog, sid);
    const log = lastLog();
    const msg = replyText(result);

    expect(msg).not.toMatch(/\bClarificare:/);
    if (log.output?.type === "recommendation" && (result.products || []).length > 0) {
      expect(log.decision.action).toMatch(/recommend|selection/);
      const names = result.products.map((p) => String(p.name || "").toLowerCase()).join(" ");
      expect(names).toMatch(/ceara|wax|carnauba/i);
      expect(names).not.toMatch(/glass cleaner|sticla/i);
    }
  });

  it("outputMode_cleanIntent_hydrationExcluded — F36-2b AC3 product filter", async () => {
    const sid = `f36-cur-${Date.now()}`;
    const catalog = [LEATHER_CLEANER, LEATHER_HYDRATION, TEXTILE_PRODUCT];
    await handleChat("am cotiera foarte murdara", "C1", catalog, sid);
    await handleChat("piele", "C1", catalog, sid);
    const result = await handleChat("vreau sa o curat", "C1", catalog, sid);
    const log = lastLog();
    const msg = replyText(result);

    expect(msg).not.toMatch(/\bClarificare:/);
    if (log.output?.type === "recommendation" && (result.products || []).length > 0) {
      const names = result.products.map((p) => String(p.name || "").toLowerCase()).join(" ");
      expect(names).not.toMatch(/hidratare|protect leather care/i);
    }
  });

  it("ac4_replyTextLinter — Clarificare or ? implies askedClarification", async () => {
    const sid = `f36-lint-${Date.now()}`;
    await handleChat("recomanda-mi un produs pentru luciu anvelope", "C1", [TIRE_DRESSING], sid);
    const recLog = lastLog();
    const recMsg = recLog.assistantReply || "";
    if (!/\bClarificare:/i.test(recMsg)) {
      expect(Boolean(recLog.askedClarification)).toBe(false);
    }

    await handleChat("am cotiera foarte murdara", "C1", [TEXTILE_PRODUCT], sid);
    const qLog = lastLog();
    const qMsg = String(qLog.assistantReply || "");
    if (/\?/.test(qMsg) || /\bClarificare:/i.test(qMsg)) {
      expect(Boolean(qLog.askedClarification)).toBe(true);
    }
  });

  it("outputMode_tireRecommend_noAppendedClarificare — golden reproducer", async () => {
    const sid = `f36-tire-${Date.now()}`;
    const result = await handleChat(
      "recomanda-mi un produs pentru luciu anvelope",
      "C1",
      [TIRE_DRESSING],
      sid
    );
    const log = lastLog();
    const msg = replyText(result);

    expect(msg).toMatch(/Dressing luciu anvelope|luciu anvelope/i);
    expect(msg).not.toMatch(/\bClarificare:/);
    expect(log.output?.type).toBe("recommendation");
    expect(Boolean(log.askedClarification)).toBe(false);
  });
});
