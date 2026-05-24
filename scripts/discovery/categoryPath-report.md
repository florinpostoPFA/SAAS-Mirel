# categoryPath discovery report (Step 5e)

**Ticket:** [Step 5e — categoryPath discovery report](https://www.notion.so/f2b306e32b284dd6963e040523dde583)
**Date:** 2026-05-24
**Catalog:** `data/products.json` (2101 rows, 2101 active)
**Generator:** `node scripts/discovery/categoryPathReport.js`

> Discovery only — no `services/` or `data/` changes. Runtime does not read `categoryPath` today.

---

## 1. Coverage

| Metric | Value |
|--------|-------|
| Total products (catalog) | 2101 |
| Active (not removedFromCatalog) | 2101 |
| Non-empty categoryPath | 1969 (94%) |
| Empty / missing categoryPath | 132 |
| Products with non-empty `tags[]` | 0 (0%) |

> **⚠ Tag cross-checks (§4–§5):** This catalog snapshot has **zero** populated `tags` arrays. Agreed/tag-disagree counts reflect empty tags, not categoryPath quality. Re-run after Step 5 retag for meaningful tag↔path alignment.

### Per tier-1 brand

| Brand | manufacturerId | SKUs | Non-empty path | % |
| --- | --- | --- | --- | --- |
| Koch Chemie | 13 | 143 | 137 | 96% |
| Gtechniq | 39 | 148 | 148 | 100% |
| ZviZZer | 44 | 122 | 96 | 79% |
| Ewocar | 70 | 98 | 98 | 100% |
| ADBL | 92 | 415 | 415 | 100% |

---

## 2. Distribution — top 30 distinct paths

| count | tier-1 count | categoryPath |
| --- | --- | --- |
| 251 | 140 | Categorii produse / Corecție & Polish Auto / Polish & Accesorii / Paduri și bureți polish |
| 170 | 82 | Categorii produse / Produse Interior Auto / Interior / Curățarea interioarelor auto |
| 155 | 41 | Categorii produse / Corecție & Polish Auto / Polish & Accesorii / Paste polish auto |
| 137 | 25 | Categorii produse / Kituri Detailing & Oferte / Reduceri |
| 132 | 32 | (empty) |
| 95 | 51 | Categorii produse / Corecție & Polish Auto / Polish & Accesorii / Accesorii pentru polish |
| 86 | 36 | Categorii produse / Produse Interior Auto / Accesorii Detailing / Perii și pensule |
| 67 | 31 | Categorii produse / Produse Interior Auto / Interior / Protejarea interioarelor auto |
| 64 | 6 | Categorii produse / Echipamente Detailing & Aparatură / Aparatură detailing |
| 62 | 39 | Categorii produse / Produse Spălare & Întreținere Auto / Produse decontaminare auto / Produse decontaminare chimică auto |
| 61 | 38 | Categorii produse / Produse Spălare & Întreținere Auto / Prespălare Auto / Soluții prespălare |
| 56 | 29 | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| 53 | 24 | Categorii produse / Produse Spălare & Întreținere Auto / Spălare Auto / Șampon auto |
| 53 | 32 | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 50 | 48 | Categorii produse / Brand feed |
| 48 | 2 | Categorii produse / Corecție & Polish Auto / Șlefuire Auto |
| 39 | 15 | Categorii produse / Produse Interior Auto / Accesorii Detailing / Pulverizatoare și recipiente |
| 38 | 22 | Categorii produse / Produse Spălare & Întreținere Auto / Produse decontaminare auto / Produse decontaminare mecanică auto |
| 34 | 9 | Categorii produse / Produse Spălare & Întreținere Auto / Prespălare Auto / Accesorii prespălare |
| 33 | 16 | Categorii produse / Produse Interior Auto / Accesorii Detailing / Aplicatoare |
| 33 | 19 | Categorii produse / Produse Spălare & Întreținere Auto / Ceară & Sealant Auto |
| 29 | 19 | Categorii produse / Produse Spălare & Întreținere Auto / Parbriz & Geamuri |
| 29 | 18 | Categorii produse / Kituri Detailing & Oferte / Kituri detailing |
| 28 | 12 | Categorii produse / Produse Spălare & Întreținere Auto / Spălare Auto / Accesorii spălare auto |
| 27 | 2 | Categorii produse / Protecții & Coatinguri Auto / PPF (Folie protecție vopsea) / Accesorii PPF |
| 27 | 8 | Categorii produse / Produse Interior Auto / Interior |
| 26 | 16 | Categorii produse / Produse Interior Auto / Interior / Accesorii pentru interioare auto |
| 26 | 18 | Categorii produse / Produse Interior Auto / Odorizante auto |
| 25 | 18 | Categorii produse / Protecții & Coatinguri Auto / Protecții ceramice auto |
| 24 | 9 | Categorii produse / Corecție & Polish Auto / Polish & Accesorii |

---

## 3. Depth distribution

Path segments split on ` / ` (Magento breadcrumb separator).

| Segments | Product count |
|----------|---------------|
| 0 (empty) | 132 |
| 2 | 55 |
| 3 | 529 |
| 4 | 1376 |
| 5+ | 9 |

**Note:** `resolveCategoryPath` (Step 5c) picks the **deepest** path by `/` count, tiebreak alphabetical — see `scripts/lib/magentoCategories.js`.

---

## 4. Tire-bug pattern check

Path pattern: `/cauciuc|anvelop|tire|bandouri/i` on full `categoryPath`.

### tire

Products matching path pattern: **61**

#### Tag `tires`
- Agreed (tag + path): **0**
- Tag says tire, category disagrees: **0**
- Category says tire, tag disagrees: **61**

Path-not-tag: 61 SKUs (first 8):
  - `G17316` · Meguiar's · tags=[]
  - `G7516` · null · tags=[]
  - `G12024` · Meguiar's · tags=[]
  - `77707500` · Koch Chemie · tags=[]
  - `00.0587.15.0004316` · Kenotek · tags=[]
  - `ADB000224` · ADBL · tags=[]
  - `G190424` · Meguiar's · tags=[]
  - `ADB000026` · ADBL · tags=[]

#### Tag `rubber`
- Agreed (tag + path): **0**
- Tag says tire, category disagrees: **0**
- Category says tire, tag disagrees: **61**

Path-not-tag: 61 SKUs (first 8):
  - `G17316` · Meguiar's · tags=[]
  - `G7516` · null · tags=[]
  - `G12024` · Meguiar's · tags=[]
  - `77707500` · Koch Chemie · tags=[]
  - `00.0587.15.0004316` · Kenotek · tags=[]
  - `ADB000224` · ADBL · tags=[]
  - `G190424` · Meguiar's · tags=[]
  - `ADB000026` · ADBL · tags=[]

#### Tag `tire_cleaner`
- Agreed (tag + path): **0**
- Tag says tire, category disagrees: **0**
- Category says tire, tag disagrees: **61**

Path-not-tag: 61 SKUs (first 8):
  - `G17316` · Meguiar's · tags=[]
  - `G7516` · null · tags=[]
  - `G12024` · Meguiar's · tags=[]
  - `77707500` · Koch Chemie · tags=[]
  - `00.0587.15.0004316` · Kenotek · tags=[]
  - `ADB000224` · ADBL · tags=[]
  - `G190424` · Meguiar's · tags=[]
  - `ADB000026` · ADBL · tags=[]

#### Tag `tire_dressing`
- Agreed (tag + path): **0**
- Tag says tire, category disagrees: **0**
- Category says tire, tag disagrees: **61**

Path-not-tag: 61 SKUs (first 8):
  - `G17316` · Meguiar's · tags=[]
  - `G7516` · null · tags=[]
  - `G12024` · Meguiar's · tags=[]
  - `77707500` · Koch Chemie · tags=[]
  - `00.0587.15.0004316` · Kenotek · tags=[]
  - `ADB000224` · ADBL · tags=[]
  - `G190424` · Meguiar's · tags=[]
  - `ADB000026` · ADBL · tags=[]

#### Tag `cauciuc`
- Agreed (tag + path): **0**
- Tag says tire, category disagrees: **0**
- Category says tire, tag disagrees: **61**

Path-not-tag: 61 SKUs (first 8):
  - `G17316` · Meguiar's · tags=[]
  - `G7516` · null · tags=[]
  - `G12024` · Meguiar's · tags=[]
  - `77707500` · Koch Chemie · tags=[]
  - `00.0587.15.0004316` · Kenotek · tags=[]
  - `ADB000224` · ADBL · tags=[]
  - `G190424` · Meguiar's · tags=[]
  - `ADB000026` · ADBL · tags=[]

#### All path matches (sku, brand, path, tags, tier-1)

| SKU | Brand | Tier-1 | manufacturerId | tags | categoryPath |
| --- | --- | --- | --- | --- | --- |
| G17316 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G7516 |  | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G12024 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| 77707500 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| 00.0587.15.0004316 | Kenotek | no | 49 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000224 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G190424 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000026 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000027 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000028 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| SO235300 | Sonax | no | 46 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| SO409100 | Sonax | no | 46 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| SO210141 | Sonax | no | 46 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| 196612 |  | no | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| GWC | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Accesorii pentru cauciucuri și bandouri |
| ADB000141 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000142 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| DRTU14332 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| 173001 |  | no | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G192215 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G192315 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| H0525 | Ma-Fra | no | 135 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| 236500 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| H0253 | Ma-Fra | no | 135 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| H0188 | Ma-Fra | no | 135 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| 236005 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G7516T |  | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| C4 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB-TRC | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB-BW | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| C4 0.015 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| C4 0.03 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| HN085 | Ma-Fra | no | 135 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| H0283 | Ma-Fra | no | 135 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G210419 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| T1 0.25 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| T2 0.25 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000486 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000487 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000092 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000497 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G230416 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB-BLACKOUTER | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| NERO | Labocosmetica | no | 262 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| kit anvelope 1 |  | no |  | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Accesorii pentru cauciucuri și bandouri |
| kit anvelope 2 |  | no |  | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Accesorii pentru cauciucuri și bandouri |
| kit anvelope 3 |  | no |  | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| kit caroserie 6 |  | no |  | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Accesorii pentru cauciucuri și bandouri |
| ADB-TC | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000545 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000546 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| EW-NG | Ewocar | yes | 70 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| NG1 | Ewocar | yes | 70 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| NG5 | Ewocar | yes | 70 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| ADB000488 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| WS 149 | Work Stuff | no | 136 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Accesorii pentru cauciucuri și bandouri |
| CG10007 | ChemicalGuys | no | 266 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| CG10062 | ChemicalGuys | no | 266 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| CG10073 | ChemicalGuys | no | 266 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| G250816 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |
| TT5 | Ewocar | yes | 70 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri |

---

## 5. Wheel-bug pattern check

Path pattern: `/jante|wheel|felgen/i` on full `categoryPath`.

### wheel

Products matching path pattern: **56**

#### Tag `wheels`
- Agreed (tag + path): **0**
- Tag says wheel, category disagrees: **0**
- Category says wheel, tag disagrees: **56**

Path-not-tag: 56 SKUs (first 8):
  - `G14324` · Meguiar's · tags=[]
  - `G9524` · Meguiar's · tags=[]
  - `X1025` · Meguiar's · tags=[]
  - `D14001` · Meguiar's · tags=[]
  - `77704750` · Koch Chemie · tags=[]
  - `218011` · Koch Chemie · tags=[]
  - `00.0674.11.00VG980` · Kenotek · tags=[]
  - `00.0472.15.0004697` · Kenotek · tags=[]

#### Tag `metal`
- Agreed (tag + path): **0**
- Tag says wheel, category disagrees: **0**
- Category says wheel, tag disagrees: **56**

Path-not-tag: 56 SKUs (first 8):
  - `G14324` · Meguiar's · tags=[]
  - `G9524` · Meguiar's · tags=[]
  - `X1025` · Meguiar's · tags=[]
  - `D14001` · Meguiar's · tags=[]
  - `77704750` · Koch Chemie · tags=[]
  - `218011` · Koch Chemie · tags=[]
  - `00.0674.11.00VG980` · Kenotek · tags=[]
  - `00.0472.15.0004697` · Kenotek · tags=[]

#### Tag `wheel_cleaner`
- Agreed (tag + path): **0**
- Tag says wheel, category disagrees: **0**
- Category says wheel, tag disagrees: **56**

Path-not-tag: 56 SKUs (first 8):
  - `G14324` · Meguiar's · tags=[]
  - `G9524` · Meguiar's · tags=[]
  - `X1025` · Meguiar's · tags=[]
  - `D14001` · Meguiar's · tags=[]
  - `77704750` · Koch Chemie · tags=[]
  - `218011` · Koch Chemie · tags=[]
  - `00.0674.11.00VG980` · Kenotek · tags=[]
  - `00.0472.15.0004697` · Kenotek · tags=[]

#### All path matches (sku, brand, path, tags, tier-1)

| SKU | Brand | Tier-1 | manufacturerId | tags | categoryPath |
| --- | --- | --- | --- | --- | --- |
| G14324 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| G9524 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| X1025 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Accesorii pentru jante |
| D14001 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 77704750 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 218011 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 00.0674.11.00VG980 | Kenotek | no | 49 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 00.0472.15.0004697 | Kenotek | no | 49 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 00.0719.15.0005891 | Kenotek | no | 49 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000032 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| SO230400 | Sonax | no | 46 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| SO227400 | Sonax | no | 46 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| WB-45 |  | no | 70 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Accesorii pentru jante |
| ADB000489 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| D180101 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| W6 0.25 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000490 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| W6 0.5 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| G180124 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| Q10206 | Quixx | no | 144 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 425500 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 359500 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| C5 0.015 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 218005 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| C5 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| W6 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| C5 0.03 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 00.0399.24.00VG941 | Kenotek | no | 49 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| H1002 | Ma-Fra | no | 135 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000483 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| WCK | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| Q10208 | Quixx | no | 144 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 359005 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000484 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000485 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB-Rim | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| KC-RRR | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| W6 1 | Gtechniq | yes | 39 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB-WWG | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000532 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000533 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000534 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| SIDERO | Labocosmetica | no | 262 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 00.0719.24.0006396 | Kenotek | no | 49 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB-VLE | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000572 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000573 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| ADB000574 | ADBL | yes | 92 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| SO433300 | Sonax | no | 46 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| CG10026 | ChemicalGuys | no | 266 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| CG10079 | ChemicalGuys | no | 266 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| 187011 | Koch Chemie | yes | 13 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| CG10106 | ChemicalGuys | no | 266 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| G230524 | Meguiar's | no | 9 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| WA5 | Ewocar | yes | 70 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto |
| WS 120 | Work Stuff | no | 136 | (none) | Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Accesorii pentru jante |

---

## 6. Leather sub-variant check (Step 5b axis)

Products with path matching `/piele|leather|tapiterie/i`: **34**

### categoryPath frequency (leather-pattern products)

| count | categoryPath |
| --- | --- |
| 13 | Categorii produse / Produse Interior Auto / Vopsit Piele, Vinil & Plastic / Vopsea |
| 12 | Categorii produse / Produse Interior Auto / Vopsit Piele, Vinil & Plastic / Accesorii pentru vopsire |
| 9 | Categorii produse / Produse Interior Auto / Vopsit Piele, Vinil & Plastic / Primer / filler / lac |

**Sub-variant signal in tree?** Cristi's Magento tree uses **functional buckets** (e.g. `Curățarea interioarelor auto`, `Protejarea interioarelor auto`) — not `leather_natural` / `leather_synthetic` / `alcantara` as separate leaf nodes. Name-level keywords still required for sub-variant disambiguation.

---

## 7. Promo/bundle conflation risk

Products where path contains `Kituri`, `Reduceri`, or `Oferte`: **168** (8% of active catalog).

**Deepest-path-wins:** When a SKU has multiple Magento category assignments, Step 5c stores only one path — the deepest by slash count. If a tire SKU is assigned both `Cauciucuri & Bandouri` (depth ~4) and `Kituri / Reduceri` (depth ~3), **Cauciucuri wins** and tire substring matching still works. Risk is the inverse: promo path deeper than functional path → functional category masked.

### Sample: 5 promo-path products

#### Sample 1: `G7014` — Ceara auto solida Gold Class Carnauba Plus Premium Meguiar's…
- brand: Meguiar's
- categoryPath: Categorii produse / Kituri Detailing & Oferte / Reduceri
- tags: [none]
- searchText category mention: no obvious functional category in searchText

#### Sample 2: `G7016` — Ceara auto lichida Gold Class Carnauba Plus Premium Meguiar'…
- brand: Meguiar's
- categoryPath: Categorii produse / Kituri Detailing & Oferte / Reduceri
- tags: [none]
- searchText category mention: no obvious functional category in searchText

#### Sample 3: `G12711` — Ceara auto solida cu polimeri NXT Generation Tech Wax Meguia…
- brand: Meguiar's
- categoryPath: Categorii produse / Kituri Detailing & Oferte / Reduceri
- tags: [none]
- searchText category mention: no obvious functional category in searchText

#### Sample 4: `G16402` — Odorizant auto reimprospatare aer Meguiar's Air Re-Fresher, …
- brand: Meguiar's
- categoryPath: Categorii produse / Kituri Detailing & Oferte / Reduceri
- tags: [none]
- searchText category mention: no obvious functional category in searchText

#### Sample 5: `G3626` — Solutie spalare si ceruire rapida Meguiar's Waterless Wash&W…
- brand: Meguiar's
- categoryPath: Categorii produse / Kituri Detailing & Oferte / Reduceri
- tags: [none]
- searchText category mention: yes (name/path keywords in searchText)

*Tire-pattern products under promo-only path:* 0 SKUs.

---

## 8. Romanian normalization sample

10 distinct paths with diacritics — raw vs NFKD-stripped lowercase:

| Raw path | norm(path) |
| --- | --- |
| Categorii produse / Produse Spălare & Întreținere Auto / Spălare Auto / Șampon auto | categorii produse / produse spalare & intretinere auto / spalare auto / sampon auto |
| Categorii produse / Corecție & Polish Auto / Polish & Accesorii / Paste polish auto | categorii produse / corectie & polish auto / polish & accesorii / paste polish auto |
| Categorii produse / Produse Spălare & Întreținere Auto / Produse decontaminare auto / Produse decontaminare mecanică auto | categorii produse / produse spalare & intretinere auto / produse decontaminare auto / produse decontaminare mecanica auto |
| Categorii produse / Produse Interior Auto / Interior / Curățarea interioarelor auto | categorii produse / produse interior auto / interior / curatarea interioarelor auto |
| Categorii produse / Produse Spălare & Întreținere Auto / Cauciucuri & Bandouri / Soluții pentru cauciucuri și bandouri | categorii produse / produse spalare & intretinere auto / cauciucuri & bandouri / solutii pentru cauciucuri si bandouri |
| Categorii produse / Produse Spălare & Întreținere Auto / Prespălare Auto / Soluții prespălare | categorii produse / produse spalare & intretinere auto / prespalare auto / solutii prespalare |
| Categorii produse / Echipamente Detailing & Aparatură / Aparatură detailing | categorii produse / echipamente detailing & aparatura / aparatura detailing |
| Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Soluții curățare jante auto | categorii produse / produse spalare & intretinere auto / jante auto / solutii curatare jante auto |
| Categorii produse / Produse Spălare & Întreținere Auto / Jante Auto / Accesorii pentru jante | categorii produse / produse spalare & intretinere auto / jante auto / accesorii pentru jante |
| Categorii produse / Corecție & Polish Auto / Polish & Accesorii / Accesorii pentru polish | categorii produse / corectie & polish auto / polish & accesorii / accesorii pentru polish |

**Matching guidance:** Use `normalize('NFD')` + strip combining marks before substring checks; do not rely on exact equality. Known typo: `PrespălareAuto` (no space) — 0 product(s) affected; substring `prespalare` still matches.

---

## Recommendations (decision gate)

### 1. Tire-bug hotfix via categoryPath substring?

**Yes (narrow hotfix).** 61 SKUs sit under deterministic tire/wheel-band paths (`Cauciucuri & Bandouri / …`). On this snapshot tags are empty — categoryPath is the **only** structured tire signal available. Add a **pre-filter or guard** in tire intent routing: when `categoryPath` matches tire pattern, restrict candidates to same pattern (or boost), without replacing tags entirely.

### 2. Can categoryPath replace Step 5b failing axes?

| Axis | Verdict |
|------|---------|
| **Tire / anvelope** | **Partial replace** — path is strong for product-type gate; keep tags for dressing vs cleaner role. |
| **Wheel / jante** | **Partial replace** — same as tire; path separates jante vs cauciuc trees cleanly. |
| **Leather sub-variant** | **No** — tree is flat (`piele`/`tapiterie` leaves); natural vs synthetic vs alcantara not in categoryPath. |
| **Surface vs material** | **No** — paths encode product department, not slot-level surface enum. |

### 3. Deepest-path-wins risk for promo/bundle?

**Medium risk, mitigable.** 168 SKUs (8%) show promo paths; most are genuinely promo SKUs. Mitigations: (a) when path matches `Reduceri|Kituri`, fall back to `searchText` category breadcrumb if present; (b) never use categoryPath alone for routing — combine with tags/name; (c) re-import audit for hero SKUs stuck on promo path only.

---

*Generated in 0.04s*
