# F47c — tier_one_unavailable diagnosis (Stage 1)

**Notion:** [F47c ticket](https://app.notion.com/p/b7e79fcbbbbd451eb62b32c2085c7038)  
**Base:** main `7f48d50780c517c27220ab78d16daf2aa70d4a3c`  
**Prod trace:** `b45310a2-4c82-47aa-b8f3-329c2c637d1f` (deploy `7f48d50`, session `326b24ae-7f26-4821-a923-8cdb8a8a0f59`)  
**Scope:** Diagnose only — no production patch in this cycle.

---

## 1. Emit sites for `productsReason: tier_one_unavailable`

See committed artifact `f47c_emit_sites.txt`.

Summary: the literal string is defined once (`chatService.js:192`). Runtime emission flows through **`returnTierOneUnavailableFailSafe`** (4724–4743), invoked from **three selection-path call sites**:

| Site | Lines | Gate immediately preceding emit | Empty-set condition |
|------|-------|--------------------------------|---------------------|
| **E3 (repro hit)** | 12634–12644 | `applyTierOneManufacturerGate(qualityCandidates)` after `applyHardFilter` | Tag-search returns ≥1 hard-filter match, **all** from non-tier-1 manufacturers |
| E4 | 12705–12712 | `applyTierOneManufacturerGate(filteredSelectionProducts)` after material/use-case/flow filters | Post-ranking pipeline empty + tier-1 wipe (not applicability decline) |
| E5 | 12748–12756 | `applyTierOneManufacturerGate(finalProducts)` after APC inclusion | Final trim wipes last tier-1-eligible SKU |

Supporting classifier: `classifyEmptySelectionReason` (4717–4722) uses the same `isTierOneGateWipe` predicate.

---

## 2. Local repro — wax 2-turn

**Script:** `scripts/f47c_wax_repro_diag.js` (not shipped)  
**Log:** `f47c_local_repro.log`

| Turn | Input | Outcome |
|------|-------|---------|
| T1 | `vreau sa dau cu ceara la exterior` | Clarification `missingSlot=object` (expected) |
| T2 | `vopsea` | **0 products**, `productsReason=tier_one_unavailable` ✓ (broken outcome reproduced) |

**T2 gate trace (instrumentation via stdout capture):**

1. **Slots:** `{ context: exterior, surface: paint, object: caroserie, action: protect }` — matches prod snapshot.
2. **Tags:** `[paint, exterior, wax]` — matches prod (`[exterior, wax, paint]` order differs only).
3. **Tag search:** 2 candidates — both Meguiar's solid wax (`manufacturerId=9`), score 620.
4. **Hard filter (`exterior|paint`):** `beforeCount=2 → afterCount=2`, `requiredAny=[wax,sealant,protection]`, **`requiredAllCombos=[]`** (F47b active).
5. **Tier-1 gate (site E3):** `before=2 after=0 droppedManufacturerIds=[9]`.
6. **Emit:** `TIER_ONE_UNAVAILABLE` → `productsReason=tier_one_unavailable`.

**Conclusion:** F47/F47b hard-filter path is **not** the blocker on this repro. Tier-1 manufacturer gate on the **top-2 tag-search hits** is the blocker.

---

## 3. Prod trace cross-check (`b45310a2-…`)

| Field | Prod (CTO-provided) | Local T2 repro |
|-------|---------------------|----------------|
| slots.context | exterior | exterior ✓ |
| slots.surface | paint | paint ✓ |
| slots.object | caroserie | caroserie ✓ |
| slots.action | protect | protect ✓ |
| slotMeta.object | confirmed | confirmed (via clarification answer) |
| intent.tags | exterior, wax, paint | paint, exterior, wax ✓ |

Slot snapshot **matches** before selection pipeline runs. Local repro is valid for drawing conclusions about post-slot gates.

---

## 4. Hypothesis (c) — F47b `requiredAllCombos` conditional

**Commands run:**
```bash
grep -rn 'requiredAllCombos' services/ Tests/
grep -rn '\["paint",\s*"cleaner"\]' services/ Tests/
```

**Findings:**
- Protect lane uses `resolveHardFilterRequiredAllCombos` (`chatService.js:4151–4167`) — returns **`[]`** when `cleaningIntent` is false (protect + wax tags).
- Local repro HARD_FILTER log: `"requiredAllCombos":[]` with `requiredAny=["wax","sealant","protection"]`.
- No duplicate sibling gate found outside `applyHardFilter` + ranking fallback at ~12805 (uses same `hardFilterResult.meta.requiredAllCombos`).
- Tests: `Tests/f47b_waxAllowAndCombo.test.js` asserts protect lane combo empty and clean lane retains `[["paint","cleaner"]]`.

**Verdict for (c): REFUTED** — F47b combo conditional fully landed; protect lane does not demand paint+cleaner on this path.

---

## 5. Hypothesis triage

### (a) Category-aware tier-1 allowlist excludes wax brands for protect lane — **SUPPORTED**

**Evidence:**
- `data/tier-one-manufacturer-ids.json` allowlist: `[13, 39, 44, 70, 92]` — Meguiar's (`9`) excluded.
- Catalog: 100 SKUs in exterior+paint+wax/protection lane; **33 tier-1**, **67 non-tier-1** (25 Meguiar's).
- Tag search returns top-2 **Meguiar's** wax by score; tier-1 gate at E3 wipes both → `tier_one_unavailable`.
- Prod symptom (0 products, tier_one_unavailable) consistent with E3 even without prod log access.

### (b) Applicability/role filter eliminates wax before tier-1; tier_one_unavailable is misleading leftover — **REFUTED (primary path)**

**Evidence:**
- Local repro hits **E3** before ranking, `filterByUseCase`, or `filterByFlow` run.
- `applicabilityDeclineReason` branch (12701–12703) not taken.
- Applicability may still matter on E4/E5 paths, but **not** on the reproduced wax 2-turn failure.

### (c) requiredAllCombos still demands paint+cleaner on protect lane — **REFUTED**

See §4.

---

## 6. Proposed patch shape (NOT code — for F47c patch PR)

**Target:** `services/chatService.js` **12627–12644** (site E3 — early `qualityCandidates` tier-1 wipe).

1. **When `isTierOneGateWipe(preTierOneQuality, qualityCandidates)` on protect/wax lane**, do not immediately call `returnTierOneUnavailableFailSafe`. Instead, **widen the candidate pool** from `hardFilterResult.products` (full hard-filter survivors, not just tag-search top-N) and select tier-1 SKUs first.

2. **Conditional signal:** `hardFilterResult.meta.key === "exterior|paint"` AND (`slots.action === "protect"` OR intent tags include `wax`/`protection`) AND `resolveHardFilterRequiredAllCombos(...) === []` (protect lane, not cleaning).

3. **Implementation sketch:** After line 12635, if wipe detected on protect lane:
   - `const tier1Pool = applyTierOneManufacturerGate(hardFilterResult.products.filter(p => !isGenericProduct(p)))`
   - If `tier1Pool.length > 0`, set `qualityCandidates = tier1Pool` and continue pipeline.
   - Else fall through to existing `returnTierOneUnavailableFailSafe` (true stock-out of tier-1 wax).

4. **Optional secondary guard at E4 (12705):** Same widen-from-`hardFilterResult.products` fallback if post-ranking tier-1 wipe — only if E3 fix insufficient in prod replay.

5. **Do not expand tier-one-manufacturer-ids.json** in this patch — product policy; fix is **search/ranking vs tier-1 ordering**, not brand list change.

6. **Cleaning lane regression guard (shampoo scenario / trace `62ef4492`):** Widen fallback gated on **protect/wax** signal only. Cleaning intent keeps `requiredAllCombos=[["paint","cleaner"]]` and `requiredAny` shampoo lane; no pool widen when `cleaningIntent === true`.

7. **Leather regression guard (F48/F48b PASS — traces `4f73cced`, `bda327d9`):** Change scoped to `exterior|paint` hard-filter key only; `interior|leather` path untouched.

8. **Acceptance probes for patch PR:**
   - Wax 2-turn T2 → ≥1 tier-1 wax SKU (`319001`, `ADB000125`, `G7016` class), `productsReason=strict`, not `tier_one_unavailable`.
   - Shampoo 1-turn still returns Koch/ADBL shampoo, no wax.
   - Leather 2-turn cotiera still no surface re-ask; 3-turn still recommends.

---

## Artifacts in this PR

| File | Purpose |
|------|---------|
| `f47c_emit_sites.txt` | Grep + manual emit-site inventory |
| `f47c_local_repro.log` | Redacted local T1/T2 gate trace |
| `f47c_findings.md` | This document |
| `scripts/f47c_wax_repro_diag.js` | Repro runner (diagnosis only, not production) |

**Tests:** Unchanged — `npm test` 844/844 + golden 5/5 on diagnosis branch.
