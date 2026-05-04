/**
 * High-recall deterministic product vs knowledge intent signals (no LLM).
 */

const { analyzeSafetyQuery } = require("./safetyQueryService");

function normalizeForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
}

const PRODUCT_VERB_FRAGMENTS = [
  "vreau",
  "recomanzi",
  "recomanda",
  "recomandă",
  "da-mi",
  "dami",
  "imi dai",
  "îmi dai",
  "caut",
  "am nevoie de",
  "am nevoie",
  "ce solutie",
  "ce soluție",
  "ce dressing",
  "ce produs",
  "ce folosesc",
  "imi recomanzi",
  "îmi recomanzi",
  "ce imi recomanzi",
  "ce îmi recomanzi",
  "vreau sa cumpar",
  "vreau să cumpăr",
  "as vrea",
  "aș vrea",
  "poti sa imi dai",
  "poți să îmi dai",
  "ajuta-ma cu",
  "ajută-mă cu"
];

function hasProductRequestVerb(text) {
  const s = normalizeForMatch(text);
  return PRODUCT_VERB_FRAGMENTS.some((f) => s.includes(normalizeForMatch(f)));
}

/** Multi-token and single-token domain cues (RO + common typos). */
const DOMAIN_PHRASES = [
  "jante",
  "anvelope",
  "cauciuc",
  "tire shine",
  "tire dressing",
  "tire gel",
  "dressing",
  "luciu",
  "prosop",
  "laveta",
  "laveț",
  "microfibra",
  "microfibră",
  "microfiber",
  "sampon",
  "șampon",
  "spuma activa",
  "spumă activă",
  "snow foam",
  "polish",
  "polishez",
  "polisez",
  "taler",
  "pad",
  "burete",
  "carbuni",
  "cărbuni",
  "carbunii",
  "extractor",
  "apc",
  "bord",
  "mocheta",
  "plafon",
  "cotiera",
  "scaun",
  "scaune",
  "bancheta",
  "tapiterie",
  "piele",
  "textil",
  "plastic",
  "alcantara",
  "chedere",
  "geam",
  "parbriz",
  "vopsea",
  "ceramic",
  "wax",
  "coating",
  "flash detail",
  "clay",
  "degresor"
];

function hasProductDomainNoun(text) {
  const s = normalizeForMatch(text);
  return DOMAIN_PHRASES.some((p) => s.includes(normalizeForMatch(p)));
}

function isInformationalKnowledgeShape(text) {
  const s = normalizeForMatch(text);
  const raw = String(text || "").trim();

  if (/^ce\s+(este|e|inseamna|insemna|face|sunt)\b/i.test(raw)) return true;
  if (/^cum\s+function(eaza|ează)\b/i.test(s)) return true;
  if (/^de\s+ce\b/i.test(s)) return true;
  if (/^cat\s+(dureaza|cost|e|este)\b/i.test(s)) return true;
  if (/\bcare\s+(e|este)\s+diferenta\b/i.test(s)) return true;
  if (/\bcare\s+sunt\s+diferentele\b/i.test(s)) return true;
  if (/\bla\s+ce\s+foloseste\b/i.test(s)) return true;
  if (/\b(pot\s+folosi|este\s+sigur|afecteaza|exista)\b/i.test(s)) return true;

  return false;
}

function isProceduralHowTo(text) {
  const s = normalizeForMatch(text);
  const patterns = [
    "cum curat",
    "cum spal",
    "cum scot",
    "cum indepartez",
    "cum indepar",
    "cum aplic",
    "cum folosesc",
    "cum protejez",
    "cum intretin",
    "cum întrețin",
    "cum sa curat",
    "cum să curat",
    "cum sa spal",
    "cum să spal",
    "cum sa aplic",
    "cum să aplic",
    "cum sa folosesc",
    "cum să folosesc",
    "cum sa protejez",
    "cum să protejez",
    "vreau sa curat",
    "vreau să curat",
    "vreau sa spal",
    "vreau să spal",
    "vreau sa protejez",
    "vreau să protejez"
  ];
  return patterns.some((p) => s.includes(p));
}

function tokenCount(s) {
  return normalizeForMatch(s).split(/\s+/).filter(Boolean).length;
}

/**
 * @returns {"product_search"|"product_guidance"|"knowledge"|"unknown"}
 */
function inferHighLevelIntent(text) {
  const raw = String(text || "").trim();
  if (!raw) return "unknown";

  const safety = analyzeSafetyQuery(raw);
  if (safety.triggered) return "unknown";

  const norm = normalizeForMatch(raw);
  // Discount / promo without any cleaning product cue — let non-cleaning domain reset win.
  if (
    (/\breducere\b/.test(norm) ||
      /\bdiscount\b/.test(norm) ||
      /\bcampanie\b/.test(norm) ||
      /\bcod\s+de\s+reducere\b/.test(norm)) &&
    !hasProductDomainNoun(raw)
  ) {
    return "unknown";
  }

  if (isInformationalKnowledgeShape(raw)) return "knowledge";
  if (isProceduralHowTo(raw)) return "product_guidance";

  const hasVerb = hasProductRequestVerb(raw);
  const hasNoun = hasProductDomainNoun(raw);

  if (hasVerb && hasNoun) return "product_search";
  if (hasNoun && tokenCount(raw) <= 10) return "product_search";
  if (hasVerb && tokenCount(raw) <= 12) return "product_search";

  // Prod: "bmw negru sa luceasca" — finish/shine goal + vehicle cue → product search, not knowledge dead-end.
  const shineFinish =
    /\b(luceasc|straluc|lucios|luciu|shine|gloss|opalesc|reflex)\b/.test(norm);
  const carMake =
    /\b(bmw|audi|mercedes|dacia|ford|vw|volkswagen|skoda|seat|peugeot|renault|toyota|honda|mazda|hyundai|kia|opel|porsche|tesla)\b/.test(
      norm
    );
  const carColor =
    /\b(negru|neagra|alb|alba|gri|rosu|albastru|albastra|verde|argintiu|metalic)\b/.test(norm);
  if (shineFinish && (carMake || carColor)) {
    return "product_search";
  }

  return "unknown";
}

module.exports = {
  normalizeForMatch,
  hasProductRequestVerb,
  hasProductDomainNoun,
  isInformationalKnowledgeShape,
  isProceduralHowTo,
  inferHighLevelIntent
};
