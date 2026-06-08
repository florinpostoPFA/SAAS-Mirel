# Slot system (Spec #3 ops shard)

Code authority: `services/slotInferenceFromMessage.js`, `services/slotCompleteness.js`, `services/chatService.js`.

## §6 — Stale surface/object row

When `slotMeta.surface` or `slotMeta.object` is `confirmed` and incoming intent tags contradict the bound value, token inference may mark the slot `stale` and clear it (`stale_slot_present` guard).

**Goal B exception:** On clarification-answer turns (`clarificationAnswerResolution` path-flag, or `clarificationCarryoverHydratedTurn` after carryover hydration), stale invalidation is skipped so one-token answers (e.g. `cotiera`) do not wipe a carried `action` or prior `surface`.

**`slotMeta` vocabulary:** `confirmed` | `stale` | `inferred` | `unknown` | **`carried`** (hydrated from `sessionContext.clarificationAnswerCarryover`; logged on JSONL when action/tags are restored across chained clarifications).

Implementation: `services/clarificationAnswerCarryover.js`, `canApplySlotUpdate` / `slot_carried_preserved` in `slotInferenceFromMessage.js`.
