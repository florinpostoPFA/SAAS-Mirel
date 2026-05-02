#!/usr/bin/env node
/**
 * LAN / golden-style scenarios for Context Loss MVP (deterministic helpers only).
 * Run: node scripts/lan-context-loss-mvp.js
 * Asserts expected detector / template behavior; does not start the HTTP server.
 */
"use strict";

const assert = require("assert");
const m = require("../services/contextLossMvp");

function logSample(obj) {
  console.log("SAMPLE_LOG_CONTEXT_LOSS_MVP", JSON.stringify(obj, null, 2));
}

// 1) Wheels → user mentions caroserie/polish → inconsistency recovery
{
  const ctx = m.buildConversationContextFromSession(
    { surface: "wheels" },
    { surface: "confirmed" },
    2,
    {}
  );
  const loss = m.detectContextLoss({
    ctx,
    slotName: "surface",
    routingTurnIndex: 2,
    message: "de fapt vreau polish pe caroserie",
    surfaceSlotConfirmed: true
  });
  assert.strictEqual(loss.reason, "inconsistency");
  const q = m.pickClarificationQuestion("ro", true, false, "NORMAL");
  assert(q.includes("firul"), "recovery template (RO)");
}

// 2) Same slot asked twice within 3 turns → recovery
{
  const ctx = m.buildConversationContextFromSession(
    { surface: null },
    { surface: "unknown" },
    3,
    {
      historySignals: { lastClarificationSlot: "surface", lastClarificationTurn: 2 }
    }
  );
  const loss = m.detectContextLoss({
    ctx,
    slotName: "surface",
    routingTurnIndex: 3,
    message: "nu",
    surfaceSlotConfirmed: false
  });
  assert.strictEqual(loss.reason, "repeat_clarification");
}

// 3) Low-signal merge after long gap → not repeat trigger
{
  const ctx = m.buildConversationContextFromSession(
    { surface: "wheels" },
    { surface: "unknown" },
    12,
    {
      historySignals: { lastClarificationSlot: "surface", lastClarificationTurn: 1 }
    }
  );
  const loss = m.detectContextLoss({
    ctx,
    slotName: "surface",
    routingTurnIndex: 12,
    message: "merge?",
    surfaceSlotConfirmed: false
  });
  assert.strictEqual(loss.contextLossDetected, false);
  const q = m.pickClarificationQuestion("ro", false, false, "Ce suprafață?");
  assert.strictEqual(q, "Ce suprafață?");
}

// 4) Explicit correction semantics: after slots/meta say paint confirmed, no inconsistency vs same message
{
  const ctx = m.buildConversationContextFromSession(
    { surface: "paint" },
    { surface: "confirmed" },
    5,
    {}
  );
  const loss = m.detectContextLoss({
    ctx,
    slotName: "surface",
    routingTurnIndex: 5,
    message: "Nu jante, caroserie.",
    surfaceSlotConfirmed: true
  });
  assert.strictEqual(loss.contextLossDetected, false);
}

logSample({
  contextLossDetected: true,
  contextLossReason: "inconsistency",
  requiredSlotsMissing: ["surface"],
  surfaceStateBefore: { value: "wheels", status: "confirmed", confidence: 1, updatedAtTurn: 2 },
  surfaceStateAfter: { value: "wheels", status: "confirmed", confidence: 1, updatedAtTurn: 2 },
  routerTop2: null,
  routerMargin: null,
  clarificationType: "recovery",
  clarificationDegraded: false,
  repeatedSlotAsksCount: 1,
  pendingQuestionBefore: null,
  pendingQuestionAfter: { slot: "surface" },
  stateMutationDiff: {
    surfaceBefore: "wheels",
    surfaceAfter: "wheels",
    pendingQuestionSlotBefore: null,
    pendingQuestionSlotAfter: "surface",
    activeFlowBefore: null,
    activeFlowAfter: null
  }
});

console.log("lan-context-loss-mvp: all scenarios OK");
