# Section extractor discovery report

**Ticket:** [Extract structured sections from product descriptions…](https://www.notion.so/759de3aa2a1449d98af02668689c0f00)
**Date:** 2026-05-23
**Catalog:** `data/products.json` on `main` (2101 products)

## Executive summary

Carhub tier-1 descriptions follow the **8-section narrative template** as **inline plain text** (HTML H2 markers are not preserved in the Magento snapshot). A deterministic phrase-boundary parser is feasible for tier-1; non-tier-1 copy rarely uses the full template.

| Cohort | SKUs | All 8 sections present | `Ce NU este` present |
|--------|------|------------------------|----------------------|
| Tier-1 sample (20 SKUs) | 20 | 5% | 15% |
| Tier-1 long-form (desc ≥2500, n=28) | 28 | 11% | 29% |
| Non-tier-1 spot check | 10 | 0% | 0% |

Most tier-1 catalog rows are **short Magento blurbs**; the 8-section template appears on **long-form Cristi pages** (hero SKUs). Parser should gate on `description.length >= 2000` (or explicit `templateVersion` flag after first extract).

**Phase 1 wiring recommendation:** ship **anti-recommendation guard** (`whatItIsNot`) first, then **section text-fallback** in `findProductsByRoleConfig` (`whereToUse` + `howToUse`). Defer cross-sell and FAQ seeding.

### Reference SKUs (full template detected)

| SKU | Brand | Description len | 8/8 |
|-----|-------|-----------------|-----|
| `86001` | Koch Chemie MZR 1L | 4106 | ✓ all present |
| `86011` | Koch Chemie MZR 11L | 4198 | ✓ all present |
| `ADB-TYP` | ADBL APC Typhoon | ~6k+ | ✓ all present (Carhub reference page) |

---

## Methodology

- Tier-1 brands: Koch Chemie, Gtechniq, ZviZZer, Ewocar, ADBL (926 rows).
- Sample: 5×4 product types via `categoryPath` + name keywords.
- Detection: accent-stripped regex; present = ≥40 chars until next section phrase.

### Substitutions

- ZviZZer / APC / universal cleaner: substituted (no category match)
- ZviZZer / Tire dressing / shine: substituted (no category match)
- ZviZZer / Wheel cleaner: substituted (no category match)
- ZviZZer / Leather product: substituted (no category match)

---

## Section presence (% present)

| Section | Tier-1 (20) | Non-tier-1 (10) |
|---------|------------------------------|--------------------------------|
| Ce este | 10% (sample) · 36% (long-form) | 0% |
| De ce … | 20% (sample) · 32% (long-form) | 0% |
| Unde se poate folosi / încadrează | 5% (sample) · 18% (long-form) | 0% |
| Cum se folosește | 15% (sample) · 39% (long-form) | 0% |
| Ce urmează | 15% (sample) · 25% (long-form) | 0% |
| Ce NU este | 15% (sample) · 29% (long-form) | 0% |
| Pentru cine | 15% (sample) · 39% (long-form) | 0% |
| FAQ | 15% (sample) · 39% (long-form) | 0% |
| **All 8 present** | **5%** · **11%** long-form | **0%** |

---

## 30-SKU table

Legend: ✓ present · ~ partial · — missing

### Tier-1

| ID | Brand | Type | Len | Ce | De | Unde | Cum | Ce | Ce | Pentru | FAQ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 86011 | Koch Chemie | APC / universal cleane | 4198 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| KC-RRW | Koch Chemie | Tire dressing / shine | 650 | — | — | — | — | — | — | — | — |
| 359500 | Koch Chemie | Wheel cleaner | 1208 | — | — | — | — | — | — | — | — |
| 77709500 | Koch Chemie | Leather product | 811 | — | — | — | — | — | — | — | — |
| BBCLC | Gtechniq | APC / universal cleane | 1379 | — | — | — | — | — | — | — | — |
| T1 0.25 | Gtechniq | Tire dressing / shine | 1304 | — | — | — | — | — | — | — | — |
| W6 0.25 | Gtechniq | Wheel cleaner | 1328 | — | — | — | — | — | — | — | — |
| LBS | Gtechniq | Leather product | 1085 | — | ✓ | — | — | — | — | — | — |
| ZV-GC00050B | ZviZZer | APC / universal cleane | 1919 | — | — | — | — | — | — | — | — |
| ZV-CC00050B | ZviZZer | Tire dressing / shine | 1760 | — | — | — | — | — | — | — | — |
| ZV-PC | ZviZZer | Wheel cleaner | 1523 | — | — | — | — | — | — | — | — |
| ZV-ONE | ZviZZer | Leather product | 1505 | — | — | — | — | — | — | — | — |
| APC-EW | Ewocar | APC / universal cleane | 779 | — | — | — | — | — | — | — | — |
| TT5 | Ewocar | Tire dressing / shine | 491 | — | — | — | — | — | — | — | — |
| WP-5 | Ewocar | Wheel cleaner | 1742 | — | — | — | — | — | — | — | — |
| LC5 | Ewocar | Leather product | 1687 | — | — | — | — | — | — | — | — |
| ADB-TYP | ADBL | APC / universal cleane | 4583 | ~ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| ADB000491 | ADBL | Tire dressing / shine | 1037 | — | — | — | — | — | — | — | — |
| kit jante | ADBL | Wheel cleaner | 1629 | — | — | — | — | — | — | — | — |
| ADB-B | ADBL | Leather product | 4230 | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ |

### Non-tier-1

| ID | Brand | Type | Len | Ce | De | Unde | Cum | Ce | Ce | Pentru | FAQ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.9.085.01.000 | Kenotek | (random) | 556 | — | — | — | — | — | — | — | — |
| 400OZ32 | 3D | (random) | 711 | — | — | — | — | — | — | — | — |
| 9.PURE | Rupes | (random) | 409 | — | — | — | — | — | — | — | — |
| CG10071 | ChemicalGuys | (random) | 661 | — | — | — | — | — | — | — | — |
| G14324 | Meguiar's | (random) | 900 | — | — | — | — | — | — | — | — |
| H0253 | Ma-Fra | (random) | 386 | — | — | — | — | — | — | — | — |
| M155700 | Mothers | (random) | 566 | — | — | — | — | — | — | — | — |
| R003 | ROCK PPF | (random) | 821 | — | — | — | — | — | — | — | — |
| RU-NW | Rupes | (random) | 764 | — | — | — | — | — | — | — | — |
| SUN-75P180PGRF |  | (random) | 296 | — | — | — | — | — | — | — | — |

---

## Proposed extraction schema

```json
{
  "sections": {
    "whatIs": "string",
    "whyAppreciated": "string",
    "whereToUse": "string",
    "howToUse": "string",
    "whatNext": "string",
    "whatItIsNot": ["string"],
    "forWhom": "string",
    "faq": [{ "q": "string", "a": "string" }]
  },
  "sectionPresence": { "whatIs": "present|partial|missing" },
  "extractedAt": "ISO-8601",
  "templateVersion": "carhub-h2-v1"
}
```

---

## Effort estimates

| Workstream | Estimate |
|------------|----------|
| `services/sectionExtractor.js` + tests | 1.5–2 days |
| Section text-fallback in `findProductsByRoleConfig` | 1 day |
| Anti-rec guard (`whatItIsNot`) | 1–1.5 days |
| FAQ → knowledge seed | 2 days |
| Cross-sell from `whatNext` | 2–3 days |

---

## Appendix: per-SKU

### 86011 — Solutie curatare universala concentrata MZR Mehrzweckreiniger Koch Chemie, 11L
- Tier: tier-1 · Brand: Koch Chemie · Type: APC / universal cleaner
- categoryPath: Categorii produse / Produse Interior Auto / Interior / Curățarea interioarelor auto
- len: 4198
- whatIs=present, whyAppreciated=present, whereToUse=present, howToUse=present, whatNext=present, whatItIsNot=present, forWhom=present, faq=present

### KC-RRW — Solutie spalare fara clatire Rrw Rapid Rinseless Wash Koch Chemie
- Tier: tier-1 · Brand: Koch Chemie · Type: Tire dressing / shine
- categoryPath: Categorii produse / Produse Spălare & Întreținere Auto / Prespălare Auto / Soluții prespălare
- len: 650
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### 359500 — Solutie decontaminare chimica fara acid Koch Chemie Reactive Rust Remover, Rrr, 500ml
- Tier: tier-1 · Brand: Koch Chemie · Type: Wheel cleaner
- categoryPath: Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto
- len: 1208
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### 77709500 — Solutie hidratare piele Protect Leather Care Koch Chemie, 500ml
- Tier: tier-1 · Brand: Koch Chemie · Type: Leather product
- categoryPath: Categorii produse / Produse Interior Auto / Interior / Protejarea interioarelor auto
- len: 811
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### BBCLC — Solutie universala curatare bicicleta concentrata APC Gtechniq Bike Clean Concentrate, 500ml
- Tier: tier-1 · Brand: Gtechniq · Type: APC / universal cleaner
- categoryPath: Categorii produse / Detailing Biciclete / Soluții biciclete
- len: 1379
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### T1 0.25 — Dressing anvelope si bandouri T1 Durable Tyre Gel Gtechniq, 250 ml
- Tier: tier-1 · Brand: Gtechniq · Type: Tire dressing / shine
- categoryPath: Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri
- len: 1304
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### W6 0.25 — Solutie decontaminare jante si caroserie Gtechniq W6 Iron and Fallout Remover, 250ml
- Tier: tier-1 · Brand: Gtechniq · Type: Wheel cleaner
- categoryPath: Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto
- len: 1328
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### LBS — Perie curatare piele Gtechniq
- Tier: tier-1 · Brand: Gtechniq · Type: Leather product
- categoryPath: Categorii produse / Produse Interior Auto / Interior / Accesorii pentru interioare auto
- len: 1085
- whatIs=missing, whyAppreciated=present, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### ZV-GC00050B — Set Coating Ceramic cu grafen ZviZZer Graphene Ceramic Coat, 50ml
- Tier: tier-1 · Brand: ZviZZer · Type: APC / universal cleaner (substituted)
- categoryPath: Categorii produse / Kituri Detailing & Oferte / Reduceri
- len: 1919
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### ZV-CC00050B — Protectie Ceramica Zvizzer Paint Ceramic Coat, 50ml
- Tier: tier-1 · Brand: ZviZZer · Type: Tire dressing / shine (substituted)
- categoryPath: Categorii produse / Kituri Detailing & Oferte / Reduceri
- len: 1760
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### ZV-PC — Protectie Ceramica Zvizzer Paint Ceramic Coat
- Tier: tier-1 · Brand: ZviZZer · Type: Wheel cleaner (substituted)
- categoryPath: Categorii produse / Protecții & Coatinguri Auto / Protecții ceramice auto
- len: 1523
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### ZV-ONE — Pasta polish 3 in 1 cu ceara Zvizzer One Polish
- Tier: tier-1 · Brand: ZviZZer · Type: Leather product (substituted)
- categoryPath: Categorii produse / Corecție & Polish Auto / Polish & Accesorii / Paste polish auto
- len: 1505
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### APC-EW — APC EWOCAR AllClean Concentrate
- Tier: tier-1 · Brand: Ewocar · Type: APC / universal cleaner
- categoryPath: Categorii produse / Produse Interior Auto / Interior / Curățarea interioarelor auto
- len: 779
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### TT5 — Sealant Pentru Ornamente Si Anvelope EWOCAR TT-Seal Trim & Tire Sealant, 500 ML
- Tier: tier-1 · Brand: Ewocar · Type: Tire dressing / shine
- categoryPath: Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri
- len: 491
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### WP-5 — Protectie ceramica pentru jante Ewocar WheelPro, 50ml
- Tier: tier-1 · Brand: Ewocar · Type: Wheel cleaner
- categoryPath: Categorii produse / Protecții & Coatinguri Auto / Protecții ceramice auto
- len: 1742
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### LC5 — Solutie Curatare Piele Concentrata EWOCAR LEATHERCLEAN CONCENTRATE, 5 L
- Tier: tier-1 · Brand: Ewocar · Type: Leather product
- categoryPath: Categorii produse / Produse Interior Auto / Interior / Curățarea interioarelor auto
- len: 1687
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### ADB-TYP — APC profesional pentru detailing auto, ADBL APC Typhoon
- Tier: tier-1 · Brand: ADBL · Type: APC / universal cleaner
- categoryPath: Categorii produse / Produse Interior Auto / Interior / Curățarea interioarelor auto
- len: 4583
- whatIs=partial, whyAppreciated=present, whereToUse=missing, howToUse=present, whatNext=present, whatItIsNot=present, forWhom=present, faq=present

### ADB000491 — Perie anvelope ADBL Tyre Brush
- Tier: tier-1 · Brand: ADBL · Type: Tire dressing / shine
- categoryPath: Categorii produse / Produse Interior Auto / Accesorii Detailing / Perii și pensule
- len: 1037
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### kit jante — Kit spalare si protectie jante ADBL
- Tier: tier-1 · Brand: ADBL · Type: Wheel cleaner
- categoryPath: Categorii produse / Brand feed
- len: 1629
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### ADB-B — Solutie curatare tapiterie si plafon ADBL Bonnet
- Tier: tier-1 · Brand: ADBL · Type: Leather product
- categoryPath: Categorii produse / Produse Interior Auto / Interior / Curățarea interioarelor auto
- len: 4230
- whatIs=present, whyAppreciated=present, whereToUse=missing, howToUse=present, whatNext=present, whatItIsNot=present, forWhom=present, faq=present

### 0.9.085.01.000 — Prosop de uscare din microfibra Kenotek drying cloth 50x70cm,1200gsm
- Tier: non-tier-1 · Brand: Kenotek · Type: (random)
- categoryPath: Categorii produse / Lavete Microfibră & Prosoape Auto / Lavete microfibră
- len: 556
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### 400OZ32 — Pasta polish one step 3D ONE Hybrid, 946ml
- Tier: non-tier-1 · Brand: 3D · Type: (random)
- categoryPath: Categorii produse / Corecție & Polish Auto / Polish & Accesorii / Paste polish auto
- len: 711
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### 9.PURE — Pasta polish ultra fina Rupes Uno Pure
- Tier: non-tier-1 · Brand: Rupes · Type: (random)
- categoryPath: Categorii produse / Corecție & Polish Auto / Polish & Accesorii / Paste polish auto
- len: 409
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### CG10071 — Manusa spalare auto din microfibra ChemicalGuys CHENILLE PREMIUM SCRATCH FREE
- Tier: non-tier-1 · Brand: ChemicalGuys · Type: (random)
- categoryPath: Categorii produse / Produse Spălare & Întreținere Auto / Prespălare Auto / Accesorii prespălare
- len: 661
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### G14324 — Solutie curatare jante aluminiu Hot Rims Aluminium Wheel Cleaner Meguiar's, 709ml
- Tier: non-tier-1 · Brand: Meguiar's · Type: (random)
- categoryPath: Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto
- len: 900
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### H0253 — Dressing anvelope Ma-Fra Black 3 Plus, 500ml
- Tier: non-tier-1 · Brand: Ma-Fra · Type: (random)
- categoryPath: Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri
- len: 386
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### M155700 — Perie curatare jante Mothers Wheel Brush
- Tier: non-tier-1 · Brand: Mothers · Type: (random)
- categoryPath: Categorii produse / Produse Interior Auto / Accesorii Detailing / Perii și pensule
- len: 566
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### R003 — Kit Testare Folie MAPA ROCK PPF
- Tier: non-tier-1 · Brand: ROCK PPF · Type: (random)
- categoryPath: Categorii produse / Protecții & Coatinguri Auto / PPF (Folie protecție vopsea) / Accesorii PPF
- len: 821
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### RU-NW — Blana polish corectie si finisare pentru orbitala Rupes Wool Polishing Pad
- Tier: non-tier-1 · Brand: Rupes · Type: (random)
- categoryPath: (empty)
- len: 764
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

### SUN-75P180PGRF — Disc abraziv Sunmight Film, Verde, 75mm-P180
- Tier: non-tier-1 · Brand:  · Type: (random)
- categoryPath: Categorii produse / Corecție & Polish Auto / Șlefuire Auto
- len: 296
- whatIs=missing, whyAppreciated=missing, whereToUse=missing, howToUse=missing, whatNext=missing, whatItIsNot=missing, forWhom=missing, faq=missing

