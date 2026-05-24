/**
 * Deterministic Carhub long-form description section extractor (template carhub-h2-v1).
 */

const SECTION_DEFS = [
  { key: "whatIs", patterns: [/ce\s+este(\s+un)?\b/i] },
  { key: "whyAppreciated", patterns: [/de\s+ce\b/i] },
  {
    key: "whereToUse",
    patterns: [/unde\s+se\s+(poate\s+folosi|incadreaza)\b/i, /\bunde\s+poate\s+fi\s+folosit\b/i]
  },
  { key: "howToUse", patterns: [/cum\s+se\s+(foloseste|aplica|utilizeaza)\b/i, /\bcum\s+se\s+foloseste\s+corect\b/i] },
  { key: "whatNext", patterns: [/ce\s+urmeaza\b/i, /ce\s+trebuie\s+facut\b/i] },
  { key: "whatItIsNot", patterns: [/ce\s+nu\s+este\b/i] },
  { key: "forWhom", patterns: [/pentru\s+cine\b/i] },
  { key: "faq", patterns: [/\bfaq\b/i, /intrebari\s+frecvente/i] }
];

const MIN_PRESENT_CHARS = 40;

function normChar(ch) {
  return String(ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Map normalized string index to original description index (accent-insensitive).
 */
function normIndexToOrigIndex(description, normIndex) {
  const target = Math.max(0, Math.min(normIndex, norm(description).length));
  let ni = 0;
  for (let oi = 0; oi < description.length; oi++) {
    if (ni >= target) return oi;
    const slice = norm(description[oi]);
    if (slice.length > 0) ni += slice.length;
  }
  return description.length;
}

function sliceOrigByNormRange(description, normStart, normEnd) {
  const oStart = normIndexToOrigIndex(description, normStart);
  const oEnd = normIndexToOrigIndex(description, normEnd);
  return description.slice(oStart, oEnd).replace(/\s+/g, " ").trim();
}

function findSectionHits(description) {
  const text = norm(description);
  const hits = [];

  for (const def of SECTION_DEFS) {
    let best = null;
    for (const re of def.patterns) {
      const m = text.match(re);
      if (m && m.index != null) {
        const candidate = { key: def.key, index: m.index, len: m[0].length };
        if (
          best === null ||
          candidate.len > best.len ||
          (candidate.len === best.len && candidate.index < best.index)
        ) {
          best = candidate;
        }
      }
    }
    if (best) hits.push(best);
  }

  hits.sort((a, b) => a.index - b.index);
  return hits;
}

function parseWhatItIsNot(body) {
  if (!body) return null;
  const lines = body
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  const bullets = [];
  const re = /nu\s+(?:este|trebuie|e\s+)/gi;
  let last = 0;
  let m;
  const text = body.replace(/\s+/g, " ");
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const chunk = text.slice(last, m.index).trim();
      if (chunk && chunk.length > 8) bullets.push(chunk);
    }
    last = m.index;
  }
  const tail = text.slice(last).trim();
  if (tail) {
    const parts = tail.split(/(?=nu\s+(?:este|trebuie|e\s+))/i).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      if (p.length > 8) bullets.push(p);
    }
  }
  if (bullets.length === 0 && lines.length > 0) {
    return lines.filter((l) => l.length > 8);
  }
  return bullets.length > 0 ? bullets : null;
}

function parseFaq(body) {
  if (!body) return null;
  const items = [];
  const text = body.replace(/\s+/g, " ").trim();
  const parts = text.split(/(?=\?)/);
  for (const part of parts) {
    const qEnd = part.indexOf("?");
    if (qEnd < 0) continue;
    const q = part.slice(0, qEnd + 1).trim();
    const a = part.slice(qEnd + 1).trim();
    if (q.length > 3 && a.length > 3) items.push({ q, a });
  }
  return items.length > 0 ? items : null;
}

function presenceForBody(body, key) {
  if (!body) return "missing";
  const len = body.length;
  if (len >= MIN_PRESENT_CHARS) return "present";
  if (len > 0) return "partial";
  if (key === "whatItIsNot" || key === "faq") return "partial";
  return "missing";
}

/**
 * @param {string} description
 * @param {string} sku
 * @returns {object}
 */
function extractProductSections(description, sku) {
  const desc = String(description || "");
  const hits = findSectionHits(desc);
  const n = norm(desc);

  const sectionPresence = {};
  for (const def of SECTION_DEFS) {
    sectionPresence[def.key] = "missing";
  }

  const sections = {
    whatIs: null,
    whyAppreciated: null,
    whereToUse: null,
    howToUse: null,
    whatNext: null,
    whatItIsNot: null,
    forWhom: null,
    faq: null
  };

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const normStart = hit.index + hit.len;
    const normEnd = i + 1 < hits.length ? hits[i + 1].index : n.length;
    const body = sliceOrigByNormRange(desc, normStart, normEnd);

    if (hit.key === "whatItIsNot") {
      sections.whatItIsNot = parseWhatItIsNot(body);
      sectionPresence.whatItIsNot = sections.whatItIsNot?.length
        ? presenceForBody(body, hit.key)
        : presenceForBody(body, hit.key);
    } else if (hit.key === "faq") {
      sections.faq = parseFaq(body);
      sectionPresence.faq = sections.faq?.length ? "present" : presenceForBody(body, hit.key);
    } else {
      sections[hit.key] = body || null;
      sectionPresence[hit.key] = presenceForBody(body, hit.key);
    }
  }

  return {
    sku: String(sku || ""),
    sections,
    sectionPresence,
    extractedAt: new Date().toISOString(),
    templateVersion: "carhub-h2-v1"
  };
}

module.exports = {
  SECTION_DEFS,
  MIN_PRESENT_CHARS,
  norm,
  extractProductSections,
  findSectionHits,
  parseWhatItIsNot,
  parseFaq
};
