## Token Inference Collision Audit (PR23)

- Scope: all 107 token rules in `services/slotInferenceRules.js`
- Method: compile all string tokens to word-boundary regexes, then review all short tokens (`<=4` chars) for Romanian substring collisions.

### Short-token review (`<=4`)

- Checked tokens: `geam`, `bord`, `wax`, `spal`, `iron`, `fier`, `tar`, `clay`, `cut`, `wax`, `ppf`
- Collision found in prod:
  - `tar` previously matched inside `stare` via substring matching.
- Additional high-risk substring candidates reviewed:
  - `cut` inside `scut`
  - `fier` inside inflected forms unrelated to decontamination contexts
  - `spal` inside longer words
- Result: all string tokens now use word-boundary regex matching (`\\b...\\b` / `\\b...\\w*\\b`) so mid-word collisions are blocked.

### Notes

- Phrase tokens use strict phrase boundary matching (`\\bphrase\\b`).
- Single-word tokens allow inflected suffixes (`\\btoken\\w*\\b`) to preserve recall for Romanian morphology while avoiding substring collisions.
