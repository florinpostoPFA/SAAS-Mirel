# Routing Purity Fixes - Test Cases & Validation

## Summary of Changes
All 6 routing purity violations have been fixed:

1. ✅ **Interior intent override** - Now preserved, not defaulted to exterior
2. ✅ **Knowledge questions gate** - Routed to knowledge handler, not procedural
3. ✅ **Pending clarification isolation** - Follow-ups stay in pending, don't re-route
4. ✅ **Random flow selection guard** - Negations don't trigger new flows
5. ✅ **Canonical routing decision** - One decision logged per request
6. ✅ **Single execution path** - Execution path tracked per request

---

## Test Cases (LAN 192.168.0.160)

### Test A: Interior Request Must Not Flip to Exterior
```
Test ID: A1
User Message: "vreau curatare interioara"
Session: Fresh (new sessionId)

Expected Behavior:
- Logs show slots.context = "interior" (or NULL if not derived from message)
- Log contains SLOT_INFERENCE_PRESERVED_INTERIOR (NOT default_for_procedural)
- NOT SLOT_INFERENCE { context: "exterior", reason: "default_for_procedural" }
- ROUTING_DECISION log shows correct action (clarification for missing surface)
- EXECUTION_PATH shows single action

Success Criteria:
✓ No "context": "exterior" with reason="default_for_procedural"
✓ Exactly one ROUTING_DECISION log
✓ Exactly one EXECUTION_PATH log
✓ Response should ask for surface (textile/leather/etc for interior)
```

### Test B: Knowledge Question Routes to Knowledge, Not Procedural
```
Test ID: B1
User Message: "cat dureaza curatarea interioara?"
Session: Fresh (new sessionId)

Expected Behavior:
- Logs show KNOWLEDGE_GATE_APPLIED
- ROUTING_DECISION { queryType: "informational", action: "knowledge" }
- EXECUTION_PATH { action: "knowledge" }
- NO "NEEDS_SURFACE" or slot clarification

Success Criteria:
✓ One KNOWLEDGE_GATE_APPLIED log
✓ One ROUTING_DECISION with action="knowledge"
✓ One EXECUTION_PATH with action="knowledge"
✓ Response is informational (e.g., "Curatarea interioara dureaza ~30-60 min...")
✓ NOT asking "Ce suprafata vrei sa cureti?" (missing surface question)
```

### Test C: Continuation Mode - Pending Slot Resolution, No Random Flow
```
Test ID: C1
User Message 1: "vreau curatare interioara"
Session: Fresh sessionId

Expected After First Message:
- ROUTING_DECISION with missingSlot="surface"
- Session state: NEEDS_SURFACE
- Response: "Ce suprafata? (textile, leather, ...)"

User Message 2: "textile"
Expected After Second Message:
- PENDING_CLARIFICATION_SATISFIED log
- ROUTING_DECISION with action="flow" or "selection"
- EXECUTION_PATH with correct flow
- Response: Guidance for interior textile

User Message 3: "la interior nu avem jante"
Expected After Third Message:
- CORRECTION_DETECTED log
- Session stays in current flow (or asks clarification)
- NO tool_care_towel triggered
- NO FLOW_SPECIALIZED_MATCH unless explicitly about towel care

Success Criteria:
✓ Message 1: One ROUTING_DECISION, one EXECUTION_PATH
✓ Message 2: PENDING_CLARIFICATION_SATISFIED, new flow executed
✓ Message 3: CORRECTION_DETECTED, stays in flow, no random selection
✓ No "multiple execution paths" errors
✓ Exactly 3 ROUTING_DECISION logs (one per request)
✓ Exactly 3 EXECUTION_PATH logs (one per request)
```

### Test D: Single Decision + Single Execution Path
```
Test ID: D1 (Run for all previous tests A, B, C)

Validation Rules:
1. Per Request = One ROUTING_DECISION log exactly once
2. Per Request = One EXECUTION_PATH log exactly once
3. No duplicated ROUTING_DECISION or EXECUTION_PATH logs
4. Log structure must include:
   - ROUTING_DECISION: { queryType, action, reason, slots, flowId, missingSlot }
   - EXECUTION_PATH: { action, flowId, reason }

Success Criteria:
✓ Count ROUTING_DECISION logs in response → should be 1 per unique request
✓ Count EXECUTION_PATH logs in response → should be 1 per unique request
✓ ROUTING_DECISION contains all required fields
✓ EXECUTION_PATH contains action and flowId
```

---

## How to Test

### Option 1: Manual Testing (Recommended for LAN)
1. Start fresh session with `curl -X POST http://192.168.0.160:3000/api/chat -d '{"message":"vreau curatare interioara", "sessionId":"test_interior_001", "clientId":"test"}'`
2. Check logs in `/logs/YYYY-MM-DD.jsonl` for:
   - ROUTING_DECISION tag
   - EXECUTION_PATH tag
   - KNOWLEDGE_GATE_APPLIED tag
   - SLOT_INFERENCE_PRESERVED_INTERIOR tag
   - CORRECTION_DETECTED tag
   - PENDING_CLARIFICATION_ISOLATION_ENFORCED tag
3. Validate log structure and values

### Option 2: Using Postman/Thunder Client
1. Create requests for each test case (A1, B1, C1, C2, C3)
2. Each request: Fresh sessionId (e.g., "test_A1_001", "test_B1_001")
3. Check response logs for routing decision and execution path tags
4. Verify single log per request

### Option 3: Automated Validation Script
```bash
# Check for routing purity violations in logs
grep -c "ROUTING_DECISION" logs/2026-04-23.jsonl        # Should match request count
grep -c "EXECUTION_PATH" logs/2026-04-23.jsonl          # Should match request count
grep "context.*exterior.*reason.*default_for_procedural" logs/2026-04-23.jsonl  # Should be empty
grep "KNOWLEDGE_GATE_APPLIED" logs/2026-04-23.jsonl     # Should appear for knowledge questions
grep "CORRECTION_DETECTED" logs/2026-04-23.jsonl        # Should appear for negations
```

---

## Expected Log Examples

### Test A Success Log
```json
{"tag":"ROUTING_DECISION","data":{"queryType":"procedural","action":"clarification","reason":"missing_surface","slots":{"context":"interior","surface":null,"object":null},"flowId":null,"missingSlot":"surface"}}
{"tag":"EXECUTION_PATH","data":{"action":"clarification","flowId":null,"reason":"routing_decision_finalized"}}
```

### Test B Success Log
```json
{"tag":"KNOWLEDGE_GATE_APPLIED","data":{"reason":"knowledge_pattern_matched","original_queryType":"procedural","new_queryType":"informational"}}
{"tag":"ROUTING_DECISION","data":{"queryType":"informational","action":"knowledge","reason":"informational_query","slots":{"context":null,"surface":null,"object":null},"flowId":null,"missingSlot":null}}
{"tag":"EXECUTION_PATH","data":{"action":"knowledge","flowId":null,"reason":"routing_decision_finalized"}}
```

### Test C3 Success Log
```json
{"tag":"CORRECTION_DETECTED","data":{"message":"la interior nu avem jante","previousState":"NEEDS_SURFACE","action":"clarify_instead_of_new_flow"}}
{"tag":"ROUTING_DECISION","data":{"queryType":"procedural","action":"clarification","reason":"...","slots":{...}}}
{"tag":"EXECUTION_PATH","data":{"action":"clarification"}}
```

---

## Known Constraints & Boundaries

1. **isKnowledgeQuestion()** uses regex patterns - will not catch all creative variations
   - Handles: "cat dureaza", "cum", "ce este", "de ce", "care e"
   - May miss: Complex multi-clause questions

2. **hasExplicitInteriorIntent()** looks for keywords
   - Handles: "interior", "scaun", "mocheta", etc.
   - May miss: Indirect references like "in masina" (in car)

3. **isNegationCorrection()** uses regex patterns
   - Handles: "nu avem", "fara", "n-avem"
   - May miss: More subtle negations

4. **Deterministic only** - No NLP upgrades, no typo correction
   - All matching is string/regex-based
   - No LLM corrections applied

---

## Quick Wins for Testing

**Fastest way to validate all 6 fixes:**

```
Request 1 (Interior preserve): "vreau curatare interioara"
Request 2 (Knowledge gate): "cat dureaza?"
Request 3a (Pending isolation): "vreau curatare interioara" (should ask surface)
Request 3b (Pending continuation): "textile" (should proceed)
Request 3c (Negation guard): "nu avem jante" (should not select tool_care_towel)
```

Expected: 5 ROUTING_DECISION logs, 5 EXECUTION_PATH logs, no violations

---

## Troubleshooting

If tests fail:

1. **No ROUTING_DECISION log**
   - Verify chatService.js has `logInfo("ROUTING_DECISION", canonicalRoutingDecision)` at line 4778
   - Check logger is not filtering this tag

2. **Multiple EXECUTION_PATH logs per request**
   - Search for all `logInfo("EXECUTION_PATH"` calls - should be one
   - Check for duplicates in event handlers

3. **Interior still flips to exterior**
   - Verify `hasExplicitInteriorIntent()` returns true for message
   - Check `slotResult.slots.context` is not being overridden elsewhere

4. **Knowledge gate not triggered**
   - Verify `isKnowledgeQuestion()` returns true for message
   - Test specific pattern: `cat dureaza...`, `cum...`, etc.

5. **Pending state not isolated**
   - Verify `previousState` contains "NEEDS_"
   - Check `slotResult.missing` calculation is correct
