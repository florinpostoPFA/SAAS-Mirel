# Clarification templates (F40)

Deterministic clarification copy is composed from slot + intent state — never from `missingSlot` alone.

## Composition grammar

```
[scope_phrase_for_context] + vrei sa [verb_for_action] + [family_noun]? (ex: [example_list_for_context])
```

Special branches: `context:generic`, `object:*`, `surface:*`, `intent_level:*`, `narrowing:*:zero_results`.

## Data tables

Source: `data/clarification-examples.json` — verbs, verbsByFamily, familyNouns, examples, narrowing pools.

## Fallback rules (AC5)

| Missing input | Fallback |
|---------------|----------|
| `action` | Generic verb `faci` |
| `context` | Omit scope phrase / examples |
| Family tag | `produsul` |

Never emit cleaning vocabulary when `action=protect`.

## Telemetry

`clarificationTemplateKey` logged per clarification turn (AC7). Implementation: `services/clarificationTemplateService.js`.
