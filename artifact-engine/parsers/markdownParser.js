/**
 * Deterministic Markdown parser — extracts structure without interpretation.
 */

/**
 * @typedef {import('../model/artifact.js').ArtifactSection} ArtifactSection
 * @typedef {import('../model/artifact.js').ArtifactList} ArtifactList
 * @typedef {import('../model/artifact.js').ArtifactTable} ArtifactTable
 * @typedef {import('../model/artifact.js').ArtifactCodeBlock} ArtifactCodeBlock
 * @typedef {import('../model/artifact.js').ArtifactMetric} ArtifactMetric
 * @typedef {import('../model/artifact.js').ArtifactReference} ArtifactReference
 */

/**
 * @typedef {Object} MarkdownParseResult
 * @property {string} title
 * @property {Record<string, string>} metadata
 * @property {ArtifactSection[]} sections
 * @property {ArtifactTable[]} tables
 * @property {ArtifactList[]} lists
 * @property {ArtifactMetric[]} metrics
 * @property {ArtifactReference[]} references
 */

/**
 * @param {string} line
 * @returns {boolean}
 */
function isTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|', 1);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isTableSeparator(line) {
  return /^\|?[\s:-]+\|[\s|:-]+\|?$/.test(line.trim());
}

/**
 * @param {string} row
 * @returns {string[]}
 */
function parseTableCells(row) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {string} [sectionHeading]
 * @returns {ArtifactTable}
 */
function buildTable(headers, rows, sectionHeading) {
  return { headers, rows, sectionHeading };
}

/**
 * @param {string} line
 * @returns {{ ordered: boolean, text: string } | null}
 */
function parseListItem(line) {
  const unordered = line.match(/^(\s*)[-*+]\s+(.+)$/);
  if (unordered) {
    return { ordered: false, text: unordered[2].trim() };
  }
  const ordered = line.match(/^(\s*)\d+\.\s+(.+)$/);
  if (ordered) {
    return { ordered: true, text: ordered[2].trim() };
  }
  return null;
}

/**
 * @param {string} text
 * @returns {ArtifactReference[]}
 */
export function extractReferences(text) {
  const references = [];
  const seen = new Set();

  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const key = `${match[1]}::${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ text: match[1], href: match[2], type: 'link' });
  }

  const filePattern = /`([^`]+\.(?:json|md|js|txt|sh))`/g;
  while ((match = filePattern.exec(text)) !== null) {
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ text: key, href: key, type: 'file' });
  }

  const idPattern = /`([a-z][a-z0-9_]+)`/g;
  while ((match = idPattern.exec(text)) !== null) {
    const key = `id:${match[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ text: match[1], type: 'id' });
  }

  return references;
}

/**
 * @param {ArtifactTable} table
 * @param {string} [context]
 * @returns {ArtifactMetric[]}
 */
export function metricsFromTable(table, context) {
  const headers = table.headers.map((h) => h.toLowerCase());
  const metricIdx = headers.findIndex((h) => /metric|name|indicator|action|finish|category|level/.test(h));
  const valueIdx = headers.findIndex((h) => /count|value|%|total/.test(h));

  if (metricIdx === -1 || valueIdx === -1) return [];

  return table.rows
    .map((row) => ({
      name: row[metricIdx] ?? '',
      value: row[valueIdx] ?? '',
      context: context ?? table.sectionHeading,
    }))
    .filter((m) => m.name && m.value);
}

/**
 * Parse YAML frontmatter if present.
 * @param {string} content
 * @returns {{ metadata: Record<string, string>, body: string }}
 */
export function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) {
    return { metadata: {}, body: content };
  }

  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    return { metadata: {}, body: content };
  }

  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, '');
  const metadata = {};

  for (const line of raw.split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (kv) metadata[kv[1]] = kv[2].trim();
  }

  return { metadata, body };
}

/**
 * @param {string} body
 * @returns {Record<string, string>}
 */
function parsePreambleMetadata(body) {
  const metadata = {};
  const lines = body.split('\n');
  let pastTitle = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^#\s/.test(trimmed)) {
      pastTitle = true;
      continue;
    }

    if (!pastTitle) continue;
    if (/^---\s*$/.test(trimmed)) break;
    if (/^##\s/.test(trimmed)) break;

    const metaMatch = trimmed.match(/^\*\*([^*]+):\*\*\s*(.+)$/);
    if (metaMatch) {
      metadata[metaMatch[1].trim()] = metaMatch[2].trim();
      continue;
    }

    if (!/^\*\*/.test(trimmed)) break;
  }

  return metadata;
}

/**
 * @returns {ArtifactSection}
 */
function createSection(level, heading) {
  return {
    level,
    heading,
    paragraphs: [],
    lists: [],
    tables: [],
    codeBlocks: [],
    subsections: [],
  };
}

/**
 * @param {ArtifactSection} root
 * @param {number} level
 * @param {string} heading
 * @returns {ArtifactSection}
 */
function ensureSection(root, level, heading) {
  if (level <= 1) {
    root.heading = heading;
    root.level = 1;
    return root;
  }

  if (level === 2) {
    const section = createSection(2, heading);
    root.subsections.push(section);
    return section;
  }

  const parentLevel = level - 1;
  let parent = root;

  if (parentLevel >= 2) {
    const subs = root.subsections;
    parent = subs[subs.length - 1] ?? root;
    for (let l = 3; l < level; l++) {
      const nested = parent.subsections;
      parent = nested[nested.length - 1] ?? parent;
    }
  }

  const section = createSection(level, heading);
  parent.subsections.push(section);
  return section;
}

/**
 * Parse Markdown into normalized artifact fields.
 * @param {string} content
 * @returns {MarkdownParseResult}
 */
export function parseMarkdown(content) {
  const { metadata: frontmatter, body } = parseFrontmatter(content);
  const preambleMeta = parsePreambleMetadata(body);
  const metadata = { ...frontmatter, ...preambleMeta };
  const metadataLine = /^\*\*([^*]+):\*\*\s*(.+)$/;

  const lines = body.split('\n');
  const root = createSection(1, '');
  let current = root;
  let currentSectionHeading = '';
  let inTitleMetadata = false;

  const allTables = [];
  const allLists = [];
  const allMetrics = [];
  const paragraphBuffer = [];

  /**
   * @param {ArtifactSection} section
   */
  function flushParagraph(section) {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    paragraphBuffer.length = 0;
    if (text) section.paragraphs.push(text);
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph(current);
      const language = trimmed.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const block = { language, content: codeLines.join('\n') };
      current.codeBlocks.push(block);
      i++;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph(current);
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      currentSectionHeading = heading;
      current = ensureSection(root, level, heading);
      inTitleMetadata = level === 1;
      i++;
      continue;
    }

    if (inTitleMetadata) {
      if (!trimmed) {
        i++;
        continue;
      }
      if (metadataLine.test(trimmed) || /^---\s*$/.test(trimmed)) {
        i++;
        continue;
      }
      inTitleMetadata = false;
    }

    if (isTableRow(trimmed)) {
      flushParagraph(current);
      const tableLines = [];
      while (i < lines.length && isTableRow(lines[i].trim())) {
        tableLines.push(lines[i].trim());
        i++;
      }

      const dataLines = tableLines.filter((l) => !isTableSeparator(l));
      if (dataLines.length > 0) {
        const headers = parseTableCells(dataLines[0]);
        const rows = dataLines.slice(1).map(parseTableCells);
        const table = buildTable(headers, rows, currentSectionHeading || current.heading);
        current.tables.push(table);
        allTables.push(table);
        allMetrics.push(...metricsFromTable(table, currentSectionHeading || current.heading));
      }
      continue;
    }

    const listItem = parseListItem(line);
    if (listItem) {
      flushParagraph(current);
      const list = { ordered: listItem.ordered, items: [listItem.text] };
      current.lists.push(list);
      allLists.push(list);
      i++;
      while (i < lines.length) {
        const nextItem = parseListItem(lines[i]);
        if (!nextItem || nextItem.ordered !== list.ordered) break;
        list.items.push(nextItem.text);
        i++;
      }
      continue;
    }

    if (!trimmed) {
      flushParagraph(current);
      i++;
      continue;
    }

    if (/^---\s*$/.test(trimmed)) {
      flushParagraph(current);
      inTitleMetadata = false;
      i++;
      continue;
    }

    if (metadataLine.test(trimmed) && current.level <= 1 && current.subsections.length === 0) {
      i++;
      continue;
    }

    if (/^\*\*[^*]+:\*\*/.test(trimmed) && current === root && !root.heading) {
      i++;
      continue;
    }

    paragraphBuffer.push(trimmed);
    i++;
  }

  flushParagraph(current);

  const title = root.heading || extractTitleFallback(body);
  const references = extractReferences(content);

  return {
    title,
    metadata,
    sections: root.heading || root.subsections.length > 0 ? [root] : [],
    tables: allTables,
    lists: allLists,
    metrics: allMetrics,
    references,
  };
}

/**
 * @param {string} body
 * @returns {string}
 */
function extractTitleFallback(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}
