# F10 — English leak audit (clarification templates)

| file:line | english string | trigger path | romanian sibling exists? | proposed romanian replacement |
|-----------|----------------|--------------|--------------------------|-------------------------------|
| chatService.js:1400–1404 | `Is it interior or exterior?` | `missingSlot:context` / `routing.clarification.slot` | yes (partial) | `Este pentru interior sau exterior?` |
| chatService.js:1412–1414 | `What exactly do you want to clean?...` | `missingSlot:object` | yes | `Ce vrei sa cureti mai exact?...` |
| chatService.js:1421–1423 | `What exactly do you want to clean?...` | clarification default | yes | same as object |
| chatService.js:204 | `What surface is it: textile...` | `missingSlot:surface` procedural | yes | `Ce suprafata este:...` |
| chatService.js:210–212 | `What material is the surface?...` | surface LLM assist | yes | `Din ce material este suprafata?...` |
| chatService.js:3472 | `Is it interior or exterior? Which surface...` | `missingSlot:surface`, `context:exterior` | yes | `Este pentru interior sau exterior? Pe ce suprafata...` |
| chatService.js:4977 | `Do you want to clean the interior or the exterior?` | flow disambiguation `missingSlot:context` | yes | `Vrei să cureți interiorul sau exteriorul mașinii?` |
| chatService.js:5016 | `Which surface are you working on?` | flow disambiguation `missingSlot:surface` | yes | `Pe ce suprafata vrei să lucrezi?` |
| lowSignalService.js:214–225 | low-signal clarification EN variants | `missingSlot:intent_level` via `buildLowSignalClarificationQuestion` | yes | Romanian-only copy retained |
| contextLossMvp.js:205 | `Do you want concrete cleaning steps...` | `pickClarificationQuestion` degraded | yes | `buildNarrowDegradedQuestionRo()` |

**Root cause (Bug #3):** `detectLanguage("recomanda un prosop de uscare")` returned `en` (missing `recomanda` / product nouns in `RO_WORDS`), so `getClarificationQuestion` took the English branch.

**Patch:** Romanian-only clarification emitters + `RO_WORDS` extension for `recomanda`, `prosop`, `uscare`, etc.
