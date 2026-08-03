/**
 * Rule-based artifact classifier — no AI, no embeddings.
 * Uses filename, first heading, metadata, and keyword signals.
 */

/** @type {readonly string[]} */
export const ARTIFACT_TYPES = [
  'BLOG',
  'CATALOG',
  'DILUTION',
  'FINISH',
  'FLOW',
  'IMPLEMENTATION',
  'ROLE',
  'METRICS',
  'VALIDATION',
  'ROADMAP',
  'SUMMARY',
  'PATCH',
  'UNKNOWN',
];

/**
 * Filename prefix / substring rules (checked in order; first strong match wins).
 * @type {Array<{ pattern: RegExp, type: string }>}
 */
const FILENAME_RULES = [
  { pattern: /^role[-_]/i, type: 'ROLE' },
  { pattern: /role[-_]coverage/i, type: 'ROLE' },
  { pattern: /_metrics\.md$/i, type: 'METRICS' },
  { pattern: /_validation\.md$/i, type: 'VALIDATION' },
  { pattern: /_summary\.md$/i, type: 'SUMMARY' },
  { pattern: /_patch\.(md|json)$/i, type: 'PATCH' },
  { pattern: /^blog_/i, type: 'BLOG' },
  { pattern: /blog/i, type: 'BLOG' },
  { pattern: /pre_ingestion|ingestion/i, type: 'BLOG' },
  { pattern: /^catalog_/i, type: 'CATALOG' },
  { pattern: /enrichment|unenriched|top\d+_product/i, type: 'CATALOG' },
  { pattern: /^dilution_/i, type: 'DILUTION' },
  { pattern: /dilution/i, type: 'DILUTION' },
  { pattern: /^finish_/i, type: 'FINISH' },
  { pattern: /finish/i, type: 'FINISH' },
  { pattern: /^flow_|_flow_/i, type: 'FLOW' },
  { pattern: /flow_gap|flow_rational|p1_flow/i, type: 'FLOW' },
  { pattern: /^implementation_/i, type: 'IMPLEMENTATION' },
  { pattern: /roadmap/i, type: 'ROADMAP' },
  { pattern: /metrics/i, type: 'METRICS' },
  { pattern: /validation/i, type: 'VALIDATION' },
  { pattern: /audit/i, type: 'VALIDATION' },
  { pattern: /summary|retrospective|scorecard/i, type: 'SUMMARY' },
  { pattern: /patch|merge_preview/i, type: 'PATCH' },
  { pattern: /weak_customer_questions/i, type: 'CATALOG' },
  { pattern: /cleanup/i, type: 'BLOG' },
];

/**
 * Keyword signals scored across filename + heading + early content.
 * @type {Record<string, string[]>}
 */
const KEYWORD_SIGNALS = {
  BLOG: ['blog', 'ingestion', 'knowledge.json', 'knowledge_flow'],
  CATALOG: ['catalog', 'enrichment', 'product', 'coverage', 'taxonomy'],
  DILUTION: ['dilution', 'ratio', 'merge patch'],
  FINISH: ['finish', 'dressing', 'gloss', 'satin', 'protectant'],
  FLOW: ['flow', 'gap analysis', 'rationalization', 'procedure'],
  IMPLEMENTATION: ['implementation', 'phase', 'deliverable', 'milestone'],
  ROLE: ['role', 'roles', 'matching products'],
  METRICS: ['metric', 'count', 'percentage', '%'],
  VALIDATION: ['validation', 'audit', 'verify', 'false positive'],
  ROADMAP: ['roadmap', 'timeline', 'quarter'],
  SUMMARY: ['summary', 'overview', 'retrospective'],
  PATCH: ['patch', 'merge', 'apply order', 'updated'],
};

/**
 * Extract the first Markdown H1 heading.
 * @param {string} content
 * @returns {string}
 */
export function extractFirstHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

/**
 * Extract **Key:** value metadata lines from the document preamble.
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function extractInlineMetadata(content) {
  const metadata = {};
  const lines = content.split('\n');
  let inPreamble = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#\s/.test(trimmed)) {
      inPreamble = false;
      break;
    }
    if (/^---\s*$/.test(trimmed)) break;
    if (/^##\s/.test(trimmed)) break;

    const metaMatch = trimmed.match(/^\*\*([^*]+):\*\*\s*(.+)$/);
    if (metaMatch) {
      metadata[metaMatch[1].trim()] = metaMatch[2].trim();
      continue;
    }

    if (!/^\*\*/.test(trimmed) && trimmed !== '---') {
      inPreamble = false;
    }
  }

  return metadata;
}

/**
 * Parse JSON top-level scalar fields as metadata hints.
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function extractJsonMetadata(content) {
  try {
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

    const metadata = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === null || typeof value === 'object') continue;
      metadata[key] = String(value);
    }
    return metadata;
  } catch {
    return {};
  }
}

/**
 * Score artifact types from combined text signals.
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function scoreByKeywords(text) {
  const lower = text.toLowerCase();
  const scores = {};

  for (const [type, keywords] of Object.entries(KEYWORD_SIGNALS)) {
    scores[type] = keywords.reduce(
      (sum, kw) => sum + (lower.includes(kw.toLowerCase()) ? 1 : 0),
      0
    );
  }

  return scores;
}

/**
 * Pick the highest-scoring type from a score map.
 * @param {Record<string, number>} scores
 * @returns {string}
 */
export function topScoredType(scores) {
  let best = 'UNKNOWN';
  let bestScore = 0;

  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }

  return bestScore > 0 ? best : 'UNKNOWN';
}

/**
 * Classify a document into an artifact type.
 * @param {{ filename: string, extension: string, content: string }} document
 * @returns {string}
 */
export function classifyDocument(document) {
  const { filename, extension, content } = document;
  const stem = filename.replace(/\.[^.]+$/, '');

  for (const rule of FILENAME_RULES) {
    if (rule.pattern.test(filename) || rule.pattern.test(stem)) {
      return rule.type;
    }
  }

  const firstHeading = extension === '.md' ? extractFirstHeading(content) : '';
  const metadata =
    extension === '.md'
      ? extractInlineMetadata(content)
      : extractJsonMetadata(content);

  const combined = [filename, firstHeading, ...Object.values(metadata), content.slice(0, 2000)].join(
    ' '
  );
  const scores = scoreByKeywords(combined);

  if (firstHeading) {
    const headingScores = scoreByKeywords(firstHeading);
    for (const [type, score] of Object.entries(headingScores)) {
      scores[type] = (scores[type] ?? 0) + score * 2;
    }
  }

  return topScoredType(scores);
}
