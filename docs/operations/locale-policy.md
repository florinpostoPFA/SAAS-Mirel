# Locale policy (F32)

**Policy (2026-06-02):** All bot replies are **Romanian only**, regardless of detected input language. No env flag or toggle.

## Detection vs output

- `detectLanguage(message)` still classifies input as `ro` or `en`.
- The session stores `detectedInputLanguage` per turn.
- `responseLocale` / `language` on the session are always forced to **`ro`** before templates run.

## One-time acknowledgment (AC2)

When `detectedInputLanguage !== "ro"` and `localeAckSent` is not yet true, the reply is prefixed once per session with:

`Vorbesc doar românește, dar te înțeleg. Continuăm în română. 🙂`

Then `localeAckSent` is set to `true`. Safety answers (`action: safety`) skip the ack so answer-first `NU`/`DEPINDE` lines stay first.

## Enforcement location

- `services/chatService.js`: `LOCALE_SET` forces `responseLocale = "ro"`; low-signal template locale uses `"ro"`; `applyLocalePolicyAck` runs at reply assembly.
- English template branches in `lowSignalService.js` / `flowExecutor.js` remain as dead paths when locale is always `ro`.

## Tests

`Tests/localePolicy.test.js` — RO output, ack once, AC4 clarification-source scan.
