# Token inference rules

Token → slot inference is data-driven in `services/slotInferenceRules.js` and applied by `services/slotInferenceFromMessage.js`.

## Surface inference (AC1)

- Object tokens (`scaun`, `scaune`, `bancheta`, `banchete`, `cotiera`, `cotiere`) do **not** infer `surface=textile` unless the message contains an explicit textile marker (`textil`, `tapiterie`, `stofa`, etc.).
- Explicit surface tokens (`piele`, `alcantara`, `mocheta`, …) still infer surface directly.
- `scaun` / `scaune` infer `context=interior` only (no default textile surface).

## Cleanliness → action + intensity (AC2, D1-a)

Cleanliness lemmas map to `action=clean` with flat intensity metadata:

| Signal | `slots.action` | `slots.actionIntensity` |
|--------|----------------|-------------------------|
| `murdar`, `murdara`, `pata`, `praf`, … | `clean` | `normal` |
| `noroi`, `murdara grea`, `mizerie grea`, `pata adanca`, … | `clean` | `deep` |

When `slots.action` is null, `slots.actionIntensity` must also be null.

## Multi-action tie-break (Lock 2)

When multiple action tokens match in one turn, workflow-order wins (immediate next step):

`decontaminate > clean > polish > restore > maintain > protect > dress`

Example: `vreau sa curat si sa protejez` → `action=clean`.

## Intent tags bridge (AC4)

If token inference leaves `slots.action` empty, `applyTokenInferenceToSessionSlots` promotes from session/intent tags:

- `cleaning` → `clean`
- `polish` → `polish`
- `protection` → `protect`

Intent tag **emission** is out of scope (classifier unchanged).

## Routing-shift note (cotiera, no textile marker)

Pre-F35: ambiguous cotiera messages could carry `surface=textile` and route to recommend/knowledge fallback.

Post-F35: without a textile marker, surface stays unset; cleanliness fills `action=clean`; routing may shift to `clarification` with `missingSlot=surface`. Downstream clarification copy is owned by F39/F40.
