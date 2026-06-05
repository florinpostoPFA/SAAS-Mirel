# Output modes (F36)

Single source of truth for how a turn's **routing decision** maps to **rendered output**. Clarification text is owned by routing, not reply templates.

## Modes (one per turn)

| Mode | `output.type` | `decision.action` (typical) | User sees |
|------|---------------|----------------------------|-----------|
| Recommendation | `recommendation` | `recommend` / `selection` | Product picks shell only — **no** appended `Clarificare:` block |
| Clarification | `question` | `clarification` | A single question (slot gap, coverage goal, F39 gate, etc.) |
| Guidance | `reply` | `knowledge` / `safety` | Text reply, no product list |
| Flow | `flow` | `flow` | Guided steps shell |

## Mode mutex (AC2)

1. **Exactly one mode per turn** — never `recommendation` + `Clarificare:` in the same reply; never `decision.action=recommend` with `output.type=question`.
2. **Clarify-first on ambiguity** — when slots are incomplete *or* action intent is ambiguous (e.g. leather clean vs protect via `coverage_role_goal`), emit `clarification` on turn 1; recommend after the answer or after F39 budget exhaustion.
3. **Template layer is copy-only** — `formatSelectionReply` may include a narrowing block only when routing passes `includeNarrowing: true` and `narrowingQuestion`. Default product recommendations omit it.

## Clarification emission seams (routing-aligned)

| Seam | `reasonCode` / source | When |
|------|----------------------|------|
| Slot clarify | `routing.clarification.*` | Missing `context` / `object` / `surface` |
| Coverage goal | `routing.coverage_role_goal` | Leather (etc.) cue without clean/protect verb |
| F39 gate | `routing.clarification.f39_gate` | Zero products or slots missing on fail-safe |
| F33 fallback | `routing.clarification.f39_ac2` | No-match before terminal safe fallback |

Seams below routing (F32 locale ack, deleted template narrowing) must not add question text without updating `decision`, `output.type`, and telemetry.

## Telemetry (AC4)

When `output.type === "question"`:

- `askedClarification: true`
- `pendingQuestion` populated when a follow-up answer is expected
- `clarificationAttemptCount` incremented via `recordClarificationAsk` / `clarificationCountIncrement`

Reply-text linter rule: `assistantReply` matching `Clarificare:` or a trailing `?` on a clarification turn must correlate with `askedClarification: true`.

## Contract enforcement

`assertDecisionOutputContract` (extended F36):

- `clarification` → `question` only
- `recommend` / `selection` → not `question`
- `recommendation` reply must not contain `Clarificare:` / `Narrowing:` (checked at `endInteraction`)

## Related

- [clarification-first-policy.md](./clarification-first-policy.md) — F39 gate before APC / F22
- [locale-policy.md](./locale-policy.md) — F32 ack (separate review for single-source pattern)
