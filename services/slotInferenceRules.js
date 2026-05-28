/**
 * Token → slot inference rules (v0) — data only (Run A).
 * Consumed by `services/slotInferenceFromMessage.js` in Run B.
 *
 * @see Notion: Token→slot inference (d12e6afe-c408-430e-aeca-77dd14429cd0)
 *
 * Apply order (lower `priority` runs first):
 *   10–19  family `ood`      — out-of-domain qualifiers (short-circuit)
 *   100–199 family `surface` — sets surface + context
 *   200–299 family `context` — sets context only
 *   300–399 family `action`   — sets action (may combine with surface/context)
 *
 * `token` is a single normalized token or a multi-word phrase matched on normalized message text.
 * `raw` preserves the Romanian phrasing from the ticket for founder review.
 */

/** @typedef {'ood'|'surface'|'context'|'action'} SlotInferenceRuleFamily */

/**
 * @typedef {Object} SlotInferenceRule
 * @property {string|RegExp} token
 * @property {{ surface?: string, context?: string, action?: string, domain?: string }} sets
 * @property {number} priority
 * @property {SlotInferenceRuleFamily} family
 * @property {string} [raw]
 * @property {string} [notes]
 */

/** @type {readonly SlotInferenceRule[]} */
const SLOT_INFERENCE_RULES = Object.freeze([
  // ── Out-of-domain qualifiers (short-circuit) ─────────────────────────────
  {
    token: "din casa",
    raw: "din casa",
    family: "ood",
    priority: 10,
    sets: { domain: "out_of_domain" },
    notes: "Coordinate with domain guardrail ticket; do not infer interior/exterior surface."
  },
  {
    token: "din apartament",
    raw: "din apartament",
    family: "ood",
    priority: 11,
    sets: { domain: "out_of_domain" }
  },
  {
    token: "din birou",
    raw: "din birou",
    family: "ood",
    priority: 12,
    sets: { domain: "out_of_domain" }
  },

  // ── Strong surface + context ─────────────────────────────────────────────
  {
    token: "caroserie",
    raw: "caroserie / caroseria",
    family: "surface",
    priority: 100,
    sets: { surface: "paint", context: "exterior" }
  },
  {
    token: "caroseria",
    raw: "caroseria",
    family: "surface",
    priority: 101,
    sets: { surface: "paint", context: "exterior" }
  },
  {
    token: "vopsea",
    raw: "vopsea",
    family: "surface",
    priority: 102,
    sets: { surface: "paint", context: "exterior" },
    notes: "Trap: vopsea must not coerce interior when no exterior cue."
  },
  {
    token: "vopseaua",
    raw: "vopseaua",
    family: "surface",
    priority: 103,
    sets: { surface: "paint", context: "exterior" }
  },
  {
    token: "vopsita",
    raw: "vopsită",
    family: "surface",
    priority: 104,
    sets: { surface: "paint", context: "exterior" }
  },
  {
    token: "geamuri",
    raw: "geamuri",
    family: "surface",
    priority: 110,
    sets: { surface: "glass", context: "exterior" },
    notes: "NOT when followed by din casa / din apartament (OOD rules fire first)."
  },
  {
    token: "geam",
    raw: "geam",
    family: "surface",
    priority: 111,
    sets: { surface: "glass", context: "exterior" }
  },
  {
    token: "parbriz",
    raw: "parbriz",
    family: "surface",
    priority: 112,
    sets: { surface: "glass", context: "exterior" }
  },
  {
    token: "luneta",
    raw: "lunetă",
    family: "surface",
    priority: 113,
    sets: { surface: "glass", context: "exterior" }
  },
  {
    token: "oglinzi",
    raw: "oglinzi",
    family: "surface",
    priority: 114,
    sets: { surface: "glass", context: "exterior" }
  },
  {
    token: "jante",
    raw: "jante",
    family: "surface",
    priority: 120,
    sets: { surface: "wheels", context: "exterior" }
  },
  {
    token: "janta",
    raw: "jantă",
    family: "surface",
    priority: 121,
    sets: { surface: "wheels", context: "exterior" }
  },
  {
    token: "anvelope",
    raw: "anvelope",
    family: "surface",
    priority: 122,
    sets: { surface: "tires", context: "exterior" }
  },
  {
    token: "anvelopa",
    raw: "anvelopă",
    family: "surface",
    priority: 123,
    sets: { surface: "tires", context: "exterior" }
  },
  {
    token: "cauciucuri",
    raw: "cauciucuri",
    family: "surface",
    priority: 124,
    sets: { surface: "tires", context: "exterior" }
  },
  {
    token: "faruri",
    raw: "faruri",
    family: "surface",
    priority: 125,
    sets: { surface: "glass", context: "exterior" }
  },
  {
    token: "farurile",
    raw: "farurile",
    family: "surface",
    priority: 126,
    sets: { surface: "glass", context: "exterior" }
  },
  {
    token: "scaun",
    raw: "scaun",
    family: "surface",
    priority: 130,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "scaune",
    raw: "scaune",
    family: "surface",
    priority: 131,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "bancheta",
    raw: "bancheta",
    family: "surface",
    priority: 132,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "banchete",
    raw: "banchete",
    family: "surface",
    priority: 133,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "cotiera",
    raw: "cotieră",
    family: "surface",
    priority: 134,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "cotiere",
    raw: "cotiere",
    family: "surface",
    priority: 135,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "bord",
    raw: "bord",
    family: "surface",
    priority: 136,
    sets: { surface: "plastic", context: "interior" }
  },
  {
    token: "plansa de bord",
    raw: "planșă de bord",
    family: "surface",
    priority: 137,
    sets: { surface: "plastic", context: "interior" }
  },
  {
    token: "plansa",
    raw: "planșă",
    family: "surface",
    priority: 138,
    sets: { surface: "plastic", context: "interior" },
    notes: "Only when phrase context is dashboard (plansa de bord); Run B may gate."
  },
  {
    token: "mocheta",
    raw: "mochetă",
    family: "surface",
    priority: 139,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "covorase",
    raw: "covorașe",
    family: "surface",
    priority: 140,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "covor",
    raw: "covor",
    family: "surface",
    priority: 141,
    sets: { surface: "textile", context: "interior" }
  },
  {
    token: "piele",
    raw: "piele",
    family: "surface",
    priority: 142,
    sets: { surface: "piele", context: "interior" },
    notes: "NOT when followed by din casa; NOT after exterior-strong context (Run B guard)."
  },
  {
    token: "alcantara",
    raw: "alcantara",
    family: "surface",
    priority: 143,
    sets: { surface: "alcantara", context: "interior" }
  },
  {
    token: "motor",
    raw: "motor",
    family: "surface",
    priority: 144,
    sets: { context: "exterior" }
  },
  {
    token: "compartiment motor",
    raw: "compartiment motor",
    family: "surface",
    priority: 145,
    sets: { context: "exterior" }
  },

  // ── Strong context-only ───────────────────────────────────────────────────
  {
    token: "hidrofob",
    raw: "hidrofob",
    family: "context",
    priority: 200,
    sets: { context: "exterior" },
    notes: "Highest-leverage FN rescue (audit: 4/10 events)."
  },
  {
    token: "hidrofobic",
    raw: "hidrofobic",
    family: "context",
    priority: 201,
    sets: { context: "exterior" }
  },
  {
    token: "efect hidrofob",
    raw: "efect hidrofob",
    family: "context",
    priority: 202,
    sets: { context: "exterior" }
  },
  {
    token: "ceramic",
    raw: "ceramic",
    family: "context",
    priority: 210,
    sets: { context: "exterior" },
    notes: "Also sets action=protect (diagonal rule below)."
  },
  {
    token: "ceramica",
    raw: "ceramică",
    family: "context",
    priority: 211,
    sets: { context: "exterior" }
  },
  {
    token: "coating ceramic",
    raw: "coating ceramic",
    family: "context",
    priority: 212,
    sets: { context: "exterior" }
  },
  {
    token: "wax",
    raw: "wax",
    family: "context",
    priority: 220,
    sets: { context: "exterior" }
  },
  {
    token: "ceara",
    raw: "ceară",
    family: "context",
    priority: 221,
    sets: { context: "exterior" }
  },
  {
    token: "sealant",
    raw: "sealant",
    family: "context",
    priority: 222,
    sets: { context: "exterior" }
  },
  {
    token: "sealer",
    raw: "sealer",
    family: "context",
    priority: 223,
    sets: { context: "exterior" }
  },
  {
    token: "spalare",
    raw: "spălare",
    family: "context",
    priority: 230,
    sets: { context: "exterior" }
  },
  {
    token: "spalat",
    raw: "spălat",
    family: "context",
    priority: 231,
    sets: { context: "exterior" }
  },
  {
    token: "spuma activa",
    raw: "spumă activă",
    family: "context",
    priority: 232,
    sets: { context: "exterior" }
  },
  {
    token: "decontaminare",
    raw: "decontaminare",
    family: "context",
    priority: 240,
    sets: { context: "exterior" }
  },
  {
    token: "argila",
    raw: "argilă",
    family: "context",
    priority: 241,
    sets: { context: "exterior" }
  },
  {
    token: "clay bar",
    raw: "clay bar",
    family: "context",
    priority: 242,
    sets: { context: "exterior" }
  },
  {
    token: "aspirare",
    raw: "aspirare",
    family: "context",
    priority: 250,
    sets: { context: "interior" }
  },
  {
    token: "aspirator",
    raw: "aspirator",
    family: "context",
    priority: 251,
    sets: { context: "interior" }
  },

  // ── Action-verb signals (5th slot dimension) ─────────────────────────────
  {
    token: "curat",
    raw: "curăț",
    family: "action",
    priority: 300,
    sets: { action: "clean" }
  },
  {
    token: "curata",
    raw: "curățat",
    family: "action",
    priority: 301,
    sets: { action: "clean" }
  },
  {
    token: "curatare",
    raw: "curățare",
    family: "action",
    priority: 302,
    sets: { action: "clean" }
  },
  {
    token: "spal",
    raw: "spăl",
    family: "action",
    priority: 303,
    sets: { action: "clean" }
  },
  {
    token: "spalat",
    raw: "spălat",
    family: "action",
    priority: 304,
    sets: { action: "clean" }
  },
  {
    token: "sterg",
    raw: "șterg",
    family: "action",
    priority: 305,
    sets: { action: "clean" }
  },
  {
    token: "spuma activa",
    raw: "spumă activă",
    family: "action",
    priority: 306,
    sets: { action: "clean" },
    notes: "Diagonal: also context=exterior via context-family rule."
  },
  {
    token: "intretin",
    raw: "întrețin",
    family: "action",
    priority: 310,
    sets: { action: "maintain" }
  },
  {
    token: "intretinere",
    raw: "întreținere",
    family: "action",
    priority: 311,
    sets: { action: "maintain" }
  },
  {
    token: "pastrez",
    raw: "păstrez",
    family: "action",
    priority: 312,
    sets: { action: "maintain" }
  },
  {
    token: "quick detail",
    raw: "quick detail",
    family: "action",
    priority: 313,
    sets: { action: "maintain" }
  },
  {
    token: "quick det",
    raw: "quick det",
    family: "action",
    priority: 314,
    sets: { action: "maintain" }
  },
  {
    token: "refresh",
    raw: "refresh",
    family: "action",
    priority: 315,
    sets: { action: "maintain" }
  },
  {
    token: "decontamin",
    raw: "decontamin",
    family: "action",
    priority: 320,
    sets: { action: "decontaminate" }
  },
  {
    token: "iron",
    raw: "iron",
    family: "action",
    priority: 321,
    sets: { action: "decontaminate" },
    notes: "Exterior context only in Run B; exclude fier de calcat."
  },
  {
    token: "fier",
    raw: "fier",
    family: "action",
    priority: 322,
    sets: { action: "decontaminate" },
    notes: "Run B: only when exterior context; NOT fier de calcat."
  },
  {
    token: "tar",
    raw: "tar",
    family: "action",
    priority: 323,
    sets: { action: "decontaminate" }
  },
  {
    token: "smoal",
    raw: "smoală",
    family: "action",
    priority: 324,
    sets: { action: "decontaminate" }
  },
  {
    token: "clay",
    raw: "clay",
    family: "action",
    priority: 325,
    sets: { action: "decontaminate" }
  },
  {
    token: "fallout",
    raw: "fallout",
    family: "action",
    priority: 326,
    sets: { action: "decontaminate" }
  },
  {
    token: "argila",
    raw: "argilă",
    family: "action",
    priority: 327,
    sets: { action: "decontaminate" },
    notes: "Diagonal: also context=exterior via context family rule."
  },
  {
    token: "lustruiesc",
    raw: "lustruiesc",
    family: "action",
    priority: 330,
    sets: { action: "polish" }
  },
  {
    token: "lustruire",
    raw: "lustruire",
    family: "action",
    priority: 331,
    sets: { action: "polish" }
  },
  {
    token: "polish",
    raw: "polish",
    family: "action",
    priority: 332,
    sets: { action: "polish" }
  },
  {
    token: "corectez",
    raw: "corectez",
    family: "action",
    priority: 333,
    sets: { action: "polish" }
  },
  {
    token: "corectare",
    raw: "corectare",
    family: "action",
    priority: 334,
    sets: { action: "polish" }
  },
  {
    token: "cut",
    raw: "cut",
    family: "action",
    priority: 335,
    sets: { action: "polish" }
  },
  {
    token: "compound",
    raw: "compound",
    family: "action",
    priority: 336,
    sets: { action: "polish" }
  },
  {
    token: "swirl",
    raw: "swirl",
    family: "action",
    priority: 337,
    sets: { action: "polish" }
  },
  {
    token: "zgarietur",
    raw: "zgârietură",
    family: "action",
    priority: 338,
    sets: { action: "polish" }
  },
  {
    token: "protejez",
    raw: "protejez",
    family: "action",
    priority: 340,
    sets: { action: "protect" }
  },
  {
    token: "protectie",
    raw: "protecție",
    family: "action",
    priority: 341,
    sets: { action: "protect" }
  },
  {
    token: "ceramic",
    raw: "ceramic",
    family: "action",
    priority: 342,
    sets: { action: "protect" },
    notes: "Diagonal: also context=exterior."
  },
  {
    token: "ceramica",
    raw: "ceramică",
    family: "action",
    priority: 343,
    sets: { action: "protect" }
  },
  {
    token: "ceara",
    raw: "ceară",
    family: "action",
    priority: 344,
    sets: { action: "protect" },
    notes: "Diagonal: also context=exterior."
  },
  {
    token: "wax",
    raw: "wax",
    family: "action",
    priority: 345,
    sets: { action: "protect" }
  },
  {
    token: "sealant",
    raw: "sealant",
    family: "action",
    priority: 346,
    sets: { action: "protect" }
  },
  {
    token: "sigilez",
    raw: "sigilez",
    family: "action",
    priority: 347,
    sets: { action: "protect" }
  },
  {
    token: "coating",
    raw: "coating",
    family: "action",
    priority: 348,
    sets: { action: "protect" }
  },
  {
    token: "ppf",
    raw: "ppf",
    family: "action",
    priority: 349,
    sets: { action: "protect" }
  },
  {
    token: "hidrofob",
    raw: "hidrofob",
    family: "action",
    priority: 350,
    sets: { action: "protect", context: "exterior" },
    notes: "Diagonal edge: protect + exterior + (downstream) paint shelf."
  },
  {
    token: "hidrofobic",
    raw: "hidrofobic",
    family: "action",
    priority: 351,
    sets: { action: "protect", context: "exterior" }
  },
  {
    token: "restaurez",
    raw: "restaurez",
    family: "action",
    priority: 360,
    sets: { action: "restore" }
  },
  {
    token: "restaurare",
    raw: "restaurare",
    family: "action",
    priority: 361,
    sets: { action: "restore" }
  },
  {
    token: "recondition",
    raw: "recondițion",
    family: "action",
    priority: 362,
    sets: { action: "restore" }
  },
  {
    token: "ingalbenit",
    raw: "îngălbenit",
    family: "action",
    priority: 363,
    sets: { action: "restore" }
  },
  {
    token: "cracat",
    raw: "crăpat",
    family: "action",
    priority: 364,
    sets: { action: "restore" }
  },
  {
    token: "dresez",
    raw: "dresez",
    family: "action",
    priority: 370,
    sets: { action: "dress" }
  },
  {
    token: "dressing",
    raw: "dressing",
    family: "action",
    priority: 371,
    sets: { action: "dress" }
  },
  {
    token: "hranesc",
    raw: "hrănesc",
    family: "action",
    priority: 372,
    sets: { action: "dress" }
  },
  {
    token: "luciu pe anvelope",
    raw: "luciu pe anvelope",
    family: "action",
    priority: 373,
    sets: { action: "dress" }
  },
  {
    token: "condition",
    raw: "condițion",
    family: "action",
    priority: 374,
    sets: { action: "dress" }
  },
  {
    token: "tire shine",
    raw: "tire shine",
    family: "action",
    priority: 375,
    sets: { action: "dress" }
  }
]);

/** Apply families in this order when Run B sorts rules. */
const SLOT_INFERENCE_RULE_FAMILY_ORDER = Object.freeze(["ood", "surface", "context", "action"]);

module.exports = {
  SLOT_INFERENCE_RULES,
  SLOT_INFERENCE_RULE_FAMILY_ORDER
};
