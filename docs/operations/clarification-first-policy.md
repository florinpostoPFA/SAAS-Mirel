# Clarification-first policy (F39)

## Principle

When signal is incomplete or strict filter returns no catalog match, **ask** — do not jump to APC safeFallback recommendations.

Canonical statement: the app must ask additional questions when it is not sure, not default to recommendations.

## D4-(c) either-condition gate

Clarification triggers when **either**:

1. **slots_missing** — `getMissingSlot(slots)` is non-null, action-null with intent action tags, or low-confidence surface inference.
2. **zero_results** — `productsReason === "no_matching_products"` with no prior resolution.

Both gates share one template selector (`selectClarificationMessage` → F40 stub) and a **per-session budget of 2**.

Telemetry: `clarificationGateReason: "slots_missing" | "zero_results" | "both"`.

## Uncertainty signal priority

When multiple signals fire: **action > surface > intensity > other**.

## F22 safeFallback contract (terminal only)

APC fallback fires only when:

- Clarification was asked ≥1 time in the session and filter still empty, **or**
- Clarification budget (2) is exhausted, **or**
- User sends an explicit `force_fallback` phrase (`nu știu, recomanda-mi tu`, etc.).

Never on turn 1 of a fresh session for in-catalog object types.

Terminal framing: *"Am încercat să găsesc o potrivire exactă… Vrei să-ți recomand [APC] ca soluție generală, sau preferi să-mi dai mai multe detalii?"*

## Exceptions

- **Safety queries** — existing safety gate; not clarification, not product recommend.
- **force_fallback** — immediate terminal safeFallback allowed.

## Implementation

- Policy module: `services/clarificationFirstPolicy.js`
- Gate insertion: `returnSelectionFailSafe`, selection missing-slot handler
- `routing.selection.retrieval_before_clarify` removed (F39 AC1)

## Related tickets

F33 (dead-end detection), F35 (inference rules), F36 (output mode mutex), F40 (template parametrization).
