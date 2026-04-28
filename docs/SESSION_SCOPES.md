# Session scopes and reset rules

**Single source of truth:** `services/sessionLifecycle.js` holds one `Map` keyed by **`sessionId`**.  
`sessionStore.js` and `sessionService.js` are thin facades (same object per id — no split storage).

- **Schema:** `schemaVersion: 2`, `meta: { sessionId, clientId, createdAtMs, updatedAtMs }`
- **Migration:** `migrateSessionInPlace` upgrades legacy flat blobs on load/persist.
- **Namespaces (derived for tests):** `deriveSessionNamespaces(session)` — see `sessionLifecycle.js`.

Conversation state is keyed by **`sessionId`** only (not `clientId`).

## Logical namespaces (same object, documented ownership)

| Area | Fields | Owned by / purpose |
|------|--------|---------------------|
| **Slots** | `slots.context`, `slots.object`, `slots.surface`, vehicle fields | Current **active** routing/clarification turn |
| **Clarification** | `pendingQuestion`, `pendingClarification`, `pendingSlots`, `state` NEEDS_* | Slot collection / loop breakers |
| **Selection** | `pendingSelection`, `pendingSelectionMissingSlot`, `originalIntent` | Product selection continuation |
| **Flow** | `lastFlow`, `glassFlowContextLocked`, `intentFlags` | Flow executor context |
| **Meta** | `slotMeta`, `tags`, `activeProducts`, `previousAction` | Tags, catalog context, last decision |

## When intent-scoped state is cleared (code: `handleChat`)

On turns that are **not** continuations (`shouldPreserveFollowUpState === false`), the handler resets:

- `slots` → `{}`
- `pendingQuestion` → `null`
- selection flags, `lastFlow`, `glassFlowContextLocked`
- pending clarification structs via `clearPendingClarificationSlots`
- surface-assist scratch fields via `clearSurfaceAssistState`
- `slotMeta` → unknown tri-state

**Continuation** (slots preserved) only if at least one holds:

- `handledPendingQuestionAnswer` (this message answered a pending question), or
- `sessionContext.state !== "IDLE"` (active NEEDS_* clarification), or
- `sessionContext.pendingQuestion` is set, or
- short **da/nu**-style affirmation while `previousAction` is set (implicit confirm)

**Not** a continuation: generic “short message” heuristics alone (e.g. length &lt; 25) — those used to preserve slots and caused cross-intent contamination.

## Concurrency

Overlapping HTTP/chat requests for the same `sessionId` are serialized with `runSessionExclusive` in `services/sessionTurnQueue.js` so `saveSession` cannot interleave.

## Debug logging

Set `SESSION_DEBUG_LOG=1` to log:

- `SESSION_SLOT_SCOPE_RESET` — slots/clarification/flow flags cleared for a non-continuation turn (includes `clearedSlots` and a short `messagePreview`).
- `SESSION_TURN_QUEUED` — a second concurrent request hit the same `sessionId` and was serialized behind an in-flight turn.
