# Decision mutation inventory (P2 — resolveActionFinal migration)

Single writer target: **`resolveActionFinal` → `commitTurnDecision`**.

## P2.1 / P2.2 / P2.3 updates

- **Assembly pipeline** in `resolveActionFinal`: **`resolveActionCore`** → **`runPostCoreApplyPipeline`** (`applyClarificationNormalization` — includes P2.4 fill when `clarification` + `missingSlot === undefined`; **`applyFlowResolutionAdjustments`**; **`applySafetyAdjustments`**; **`applyFallbacks`** — P2.4 null/empty `action` hard guard, `deadEndRecoveryAuthority`, router-knowledge weak-context, `knowledgeSource` strip; **`applySelectionAdjustments`**) → strip markers → `buildDecision` → **`applyRouterReasonAnnotation`** (M4).
- **`resolveAction`:** `buildDecision(resolveActionCore(opts))` — **raw** router intent only (P2.3).
- **Parity:** set `DECISION_PARITY=1` to log **`DECISION_PARITY_DIFF`** when two runs of the same post-core pipeline disagree (self-check).
- **Execution** no longer re-assigns `interactionRef.decision` for selection / flow / legacy knowledge (patch + earlier pipeline assignment only).
- **Turn completion (P2.5 / P2.6):** `prepareTurnCompletionPayload` sets **`_prepareTurnCompletionPayloadActive`** so **`resolveActionFinal`** throws in Jest / logs **`DECISION_RECOMPUTE_VIOLATION`** in prod if re-entered during turn completion. Body: guards / `enforceClarificationContract`, then **`applyFlowResolutionAdjustmentsAfterExecution`**, **`applyClarificationNormalizationAfterExecution`**, **`normalizeDecisionAfterExecution`** (P2.6 rename; knowledge dead-end + invalid payload). Clarification repairs use **`buildClarificationRepairDecision`** — **no `resolveActionFinal`** post-execution. **`DECISION_EXECUTION_PROBE=1`:** **`DECISION_BEFORE_EXECUTION`** (after routing decision on `interactionRef`) and **`DECISION_AFTER_EXECUTION`** (after patch merge in prepare; includes `authorityMatchesPreExecution`). **`endInteraction`:** ref patch → prepare → **`validateDecisionForCommit`** → **`commitTurnDecision`** → log / session / return.

| ID | Location | What mutates | Type | Status |
|----|----------|----------------|------|--------|
| M1 | `applyClarificationNormalization` + `applySelectionAdjustments` (in `runPostCoreApplyPipeline`) | `action`, `flowId`, `missingSlot` | **A** | **Done (P2.2)** — was `finalizeResolveAction` |
| M2 | `prepareTurnCompletionPayload` (pre-commit guards / contract) | repairs clarification / hard-guard / contract | **B** | Open |
| M3 | `buildKnowledgeDeadEndRecoveryPatch` + `normalizeDecisionAfterExecution` | `knowledgeRecovery`, action flip | **A** | Open |
| M4 | `applyRouterReasonAnnotation` | `reason` from `message.routingDecision.reason` | **A** | **Done (P2.1)** |
| M5 | Selection re-entry | was `interactionRef.decision =` | **A** | **Removed redundant pre-return writes** |
| M6 | Flow execution | was `interactionRef.decision = executedFlowDecision` | **C** | **Removed** |
| M7 | Legacy knowledge branch | was `interactionRef.decision = resolvedAction` | **C** | **Removed** |
| M8 | `endInteraction` `patch.decision` | merges execution-provided decision | **A** | Open |
| M9 | Execution branches passing raw `decision: { action, ... }` | not via `resolveActionFinal` | **A** | Open |

**Type legend:** **A** = required business logic; **B** = safety / contract; **C** = defensive or redundant.

**Debug:** `DECISION_FINAL_DEBUG=1` → `DECISION_FINAL_COMPUTED`, `DECISION_STABILITY_PROBE`, `DECISION_POST_COMMIT`. **`DECISION_PARITY=1`** → parity diff logging. **`DECISION_EXECUTION_PROBE=1`** → `DECISION_BEFORE_EXECUTION`, `DECISION_AFTER_EXECUTION` (authority vs post-merge; P2.6).
