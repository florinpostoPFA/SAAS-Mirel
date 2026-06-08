# Logging & observability (Spec #10 ops shard)

Layers: legacy `logInfo` tags, logging v2 JSON stdout (`TURN_*`), JSONL interaction lines (`services/interactionLog.js`).

## Clarification carryover events (Goal B)

Emitted via `logger.logInfo` from `services/clarificationAnswerCarryover.js`.

### `CLARIFICATION_CARRYOVER_ARMED`

Fired when a clarification (or qualifying flow) turn ends and the carryover blob is written.

```json
{
  "slot": "surface | object | context",
  "action": "clean | protect | …",
  "tags": ["…"],
  "traceId": "uuid",
  "sessionId": "string"
}
```

### `CLARIFICATION_CARRYOVER_HYDRATED`

Fired when carryover slots/tags are merged into the session on an answer or follow-up turn.

```json
{
  "restoredAction": "clean | protect | null",
  "restoredTags": ["…"],
  "answeredSlot": "surface | object | context | null",
  "traceId": "uuid",
  "sessionId": "string"
}
```

### `CLARIFICATION_CARRYOVER_DISCARDED`

Fired on session reset, `pending_expired`, or explicit clear.

```json
{
  "reason": "pending_expired | session_reset | …",
  "sessionId": "string"
}
```

JSONL rows include `slotMeta` (with `carried` when applicable) and merged slot snapshots via `applyCarriedSlotsForTelemetry` at `endInteraction`.
