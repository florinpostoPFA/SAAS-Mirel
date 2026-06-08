# Clarification & pending-question machinery (Spec #6 ops shard)

Code authority: `services/chatService.js` (`resolvePendingQuestionFirst`, `seedPendingClarificationAtEmission`, `endInteraction`).

## §3 — Pipeline stage 7: Bind answer

When the user message resolves an armed `pendingQuestion`:

1. **Bind** — `resolvePendingQuestionFirst` writes the answered slot and sets `slotMeta[slot] = "confirmed"`.
2. **Carryover hydrate** — If `sessionContext.clarificationAnswerCarryover` exists, `hydrateClarificationAnswerCarryover` restores other slot fields and session tags from the blob; sets `slotMeta.action` (and other restored keys) to `carried` where applicable. Sets `interactionRef.clarificationAnswerResolution = true` and runs token inference with the clarification-answer guard.
3. **Re-arm** — If the turn ends with another clarification (`finalOutputType === "question"` and `shouldArmCarryover(pendingQuestion)`), `armClarificationAnswerCarryover` merges the new pending slot into the blob (K4 chained-clarify propagation).
4. **Clear** — Carryover is cleared on terminal resolution (recommend/flow without a new qualifying pending question) or `discardClarificationAnswerCarryover` on session reset / `pending_expired`.

### Arm condition (`shouldArmCarryover`)

Arm when `pendingQuestion.slot ∈ {context, object, surface, intent_level}` (F46).

**Skip:** `confirm_context` and any slot outside that set. F43 still owns `tryResolveIntentLevelPendingAnswer` binding; carryover hydrates tags/action after F43 resolves.

**Flow follow-up:** After a `flow` decision with `slots.action` set, arm using `getMissingSlot(slots)` or implicit `object` / `surface` gap so procedural turns seed carryover before selection follow-ups (e.g. `vreau sa curat pielea` → `cotiera`).

Module: `services/clarificationAnswerCarryover.js`.
