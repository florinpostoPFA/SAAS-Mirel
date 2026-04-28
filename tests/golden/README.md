# Golden replay harness

Deterministic replay of chat turns through `handleChat`, with session mutation hooks and committed baselines for CI.

## Layout

```text
tests/golden/
  README.md                 ← this file
  replayEngine.js           ← stub LLM / flow / interaction log; fresh chatService load
  replayRunner.js           ← load fixtures, run steps, write actual/, compare expected
  sanitize.js               ← drop volatile fields (timestamps, huge catalogs)
  canonicalize.js           ← stable JSON key order
  diffGolden.js             ← machine + human diff helpers
  cases/
    <case-id>/
      input.json            ← scenario definition (see schema below)
      initial_state.json    ← optional seed for sessionStore + sessionService
      expected/
        summary.json        ← committed baseline (sanitized)
      actual/               ← gitignored recommended; generated on run
        summary.json
        diff.json           ← only on mismatch
        diff.md
```

## `input.json` schema (version 1)

| Field | Required | Description |
|--------|----------|-------------|
| `version` | yes | Must be `1`. |
| `sessionId` | no | Conversation id (default `golden-session`). |
| `clientId` | no | Default `C1`. |
| `products` | no | `null` = full `data/products.json`; `"minimal"` = tiny stub array; or a JSON array. |
| `runtime.nowMs` | no | Frozen clock for `runtimeContext` / session telemetry (default `1700000000000`). |
| `steps` | yes | Array of `{ "message": "..." , "clientId"?: "..." }`. |
| `meta` | no | Free-form labels for humans (ignored in diff). |

## `initial_state.json`

Optional. Seeds a **single** unified session (`sessionLifecycle`):

```json
{
  "session": { "slots": { "context": "exterior" }, "messageCount": 1 }
}
```

Legacy (still supported): merge **`sessionStore`** and **`sessionService`** partials into one seed — same object, no split stores.

Empty `{}` in each legacy block still works; prefer one `"session": { ... }` for new cases.

## Recording a new golden case

1. Create `tests/golden/cases/<case-id>/` with `input.json` (and optional `initial_state.json`).
2. Generate the baseline:
   ```bash
   node scripts/golden-replay.js --update --case=<case-id>
   ```
3. Review `expected/summary.json`, then commit it.

## Run replay (verify)

```bash
node scripts/golden-replay.js
# or
npm run test:golden
```

Exit code `0` if all cases match; `1` if any diff fails or a baseline is missing.

## Update baseline after an intentional behavior change

```bash
node scripts/golden-replay.js --update
# or one case:
node scripts/golden-replay.js --update --case=low-signal-intent-level
```

Re-review `expected/summary.json` in PRs.

## Interpreting diffs

- **`actual/diff.md`**: short list of JSON path changes (expected → actual).
- **`actual/diff.json`**: full structured `pathDiffs` for tooling.

Volatile fields are stripped before compare (`timestamp`, `normalizedMessage`, `productsCatalog`, `createdAt`, `lastActivity`, nested history timestamps, etc.) — see `sanitize.js`.

## State & instrumentation

- **Conversation state** lives in `services/sessionStore.js`. When `global.__GOLDEN_SESSION_HOOK__` is set via `setSessionMutationHook`, each `saveSession` records `{ before, after }` (used in `summary.steps[].sessionMutations`).
- **Telemetry session** (`questionCount`, `conversationHistory`, …) is in `services/sessionService.js`.
- **Determinism**: set `GOLDEN_REPLAY=1` and `runtime.nowMs` in the fixture; LLM and flow executor are stubbed in `replayEngine.js` (no network).

## Debug trace

```bash
GOLDEN_TRACE=1 node scripts/golden-replay.js --case=low-signal-intent-level
```

(Extend `replayRunner.js` to print step payloads when this env is set, if you need more detail.)
