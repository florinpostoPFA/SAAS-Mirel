# F11 — Decision pipeline audit (retrieve before clarify)

| file:line | current decision | proposed insertion | retrieval reachability | risk notes |
|-----------|------------------|--------------------|------------------------|------------|
| `router.js:15-23` | `queryType=selection` + `getMissingSlot(slots)` → `action:clarification` | Not used in selection fast-path (`routingDecision: { action: "selection" }` hardcoded) | N/A | Selection block bypasses router missing-slot |
| `chatService.js:7916-7924` `applySelectionAdjustments` | `selection` + missing slot → `clarification` | Upstream of selection execution | Via override after retrieval | Decision still shaped here before handler |
| `chatService.js:9428-9487` | `low_signal_gate` → `clean_hint_no_object` → intent_level clarification | **F11 gate before low_signal return** | Same retrieval helper; `path: low_signal_gate` in log | Bug #2 prod path (curatat farurile) |
| `chatService.js:11107-11180` | `!hasRequiredSelectionSlots` → early `endInteraction` clarification | **F11 gate inserted here** before clarification return | `tryRetrieveBeforeClarifySelection` → `findProductsByRoleConfig` with `matchText` from message | Only when `inferHighLevelIntent=product_search` and `tokenInferenceMatches=[]` |
| `chatService.js:4691+` `findProductsByRoleConfig` | Role/tag/text match on catalog | Called with synthetic `roleConfig` (`matchText` needles, empty `requiredTags`) | **Reachable with empty slots** — strong match on `searchText` / `customer_language` / `name` | No throw; returns `[]` if no hit |
| `chatService.js:11399+` | `broadCandidates` → rank → bundle → recommend reply | Uses `selectionPreRetrievedCandidates` when gate fires | Full selection pipeline with pre-fetched candidates | `applyHardFilter` no-op when slot key null |

**Insertion point:** `chatService.js` selection handler ~11107 — after `resolveActionFinal`, before clarification `endInteraction`.

**Log event:** `ROUTING_RETRIEVAL_BEFORE_CLARIFY` — `intentType`, `intentTags`, `tokenInferenceMatches`, `retrievalCandidateCount`, `decision` (`retrieve` | `fall_through_to_clarify`), `matchPhrases`.
