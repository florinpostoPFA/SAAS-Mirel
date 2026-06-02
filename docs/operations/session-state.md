# Session state invalidation paths

This document defines the explicit slot invalidation paths for F34.

## 1) Validator-clear path

- Slot validators can clear invalid slot combinations and set follow-up clarification state.
- Code references:
  - `services/chatService.js:8300-8450` -> `applySlotValidators(...)`
  - `services/chatService.js:10363-10448` -> validator telemetry (`validatorClearedSlots`, `validatorRuleId`)
  - `services/chatService.js:2651-2655` -> analysis payload fields `validatorTriggered`, `validatorRuleId`, `validatorClearedSlots`

## 2) Correction path (user contradiction of confirmed slot)

- Explicit contradiction/correction updates are handled as slot corrections and can clear or replace prior confirmed values.
- Code references:
  - `services/chatService.js:8163-8185` -> correction path (`applySlotCorrectionFromMessage(...)`)
  - `services/chatService.js:10363-10448` -> correction telemetry (`slotChanges`, `pendingQuestionBefore`, `pendingQuestionAfter`)
  - `services/chatService.js:2642-2650` -> analysis payload fields for slot correction

## 3) Explicit reset path

- Deterministic reset evaluation/execute path controls hard reset behavior for new root query, high-level intent shift, and new object.
- Code references:
  - `services/chatService.js:5818-5865` -> `evaluateDeterministicSessionReset(...)`
  - `services/chatService.js:5887-5946` -> `applyDeterministicSessionResetInPlace(...)`
  - `services/chatService.js:5937-5941` -> `SESSION_RESET_APPLIED` with `resetReasonCode`
