/**
 * F4 patch 5 — behavioral reachability checks (no SLOT_TRACE instrumentation required).
 * Asserts session-slot outcomes for the Phase A v3 scenarios after fix-first patches.
 */

jest.mock("../services/llm", () => ({ askLLM: jest.fn().mockResolvedValue("stub") }));
jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn().mockResolvedValue({ reply: "stub", products: [] })
}));
jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn(),
  enrichInteractionExportRow: (e) => e,
  INTERACTION_JSONL_SCHEMA_VERSION: 2,
  LOG_DIR: "/tmp"
}));

const { runConvo, CONVOS } = require("./_phaseA_harness");

describe("harness reachability (F4 patch 5)", () => {
  it("A3 T1 sets action:protect and T2 preserves it on interrogative follow-up", async () => {
    const { perTurn } = await runConvo(CONVOS.A3, {
      runLabel: "A3",
      sessionId: "reach-A3",
      captureTraces: false
    });
    expect(perTurn[0].sessionSlots.action).toBe("protect");
    expect(perTurn[1].sessionSlots.action).toBe("protect");
    expect(perTurn[1].sessionSlots.context).toBe("exterior");
  });

  it("A2 T2 is not misrouted to safety (product recommendation)", async () => {
    const { perTurn } = await runConvo(CONVOS.A2, {
      runLabel: "A2",
      sessionId: "reach-A2",
      captureTraces: false
    });
    expect(perTurn[1].decisionTrace?.action).not.toBe("safety");
    expect(perTurn[1].sessionSlots.object).toBeTruthy();
  });

  it("isHardReset does not fire on vreau sa / cum curat openers", () => {
    const { isHardReset } = require("../services/chatService").__test;
    expect(isHardReset("Vreau sa protejez vopseaua")).toBe(false);
    expect(isHardReset("cum curat")).toBe(false);
  });

  it("mergeSlots preserves action from session fallback in processSlots path", () => {
    const { mergeSlots } = require("../services/chatService").__test;
    const merged = mergeSlots(
      {},
      { context: "exterior", surface: "paint", object: "caroserie" },
      { sessionSlots: { action: "protect" } }
    );
    expect(merged.action).toBe("protect");
  });

  it("knowledge dead-end bypasses recovery for interrogative follow-up with session slots", () => {
    const { shouldBypassKnowledgeDeadEndRecovery } = require("../services/knowledgeDeadEndService");
    const sessionContext = {
      slots: { context: "exterior", surface: "paint", object: "caroserie", action: "protect" }
    };
    expect(
      shouldBypassKnowledgeDeadEndRecovery(
        { message: "Care e cel mai bun?" },
        sessionContext
      )
    ).toBe(true);
  });
});
