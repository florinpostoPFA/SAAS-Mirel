/**
 * JSON parser — maps existing JSON reports into the shared Artifact model.
 */

/**
 * @typedef {import('../model/artifact.js').ArtifactSection} ArtifactSection
 * @typedef {import('../model/artifact.js').ArtifactTable} ArtifactTable
 * @typedef {import('../model/artifact.js').ArtifactList} ArtifactList
 * @typedef {import('../model/artifact.js').ArtifactMetric} ArtifactMetric
 * @typedef {import('../model/artifact.js').ArtifactReference} ArtifactReference
 */

/**
 * @typedef {Object} JsonParseResult
 * @property {string} title
 * @property {Record<string, string>} metadata
 * @property {ArtifactSection[]} sections
 * @property {ArtifactTable[]} tables
 * @property {ArtifactList[]} lists
 * @property {ArtifactMetric[]} metrics
 * @property {ArtifactReference[]} references
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} filename
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
function deriveTitle(filename, data) {
  if (typeof data.title === 'string') return data.title;
  if (typeof data.name === 'string') return data.name;
  if (typeof data.report === 'string') return data.report;

  const stem = filename.replace(/\.[^.]+$/, '');
  return stem
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * @param {Record<string, unknown>} data
 * @returns {Record<string, string>}
 */
function extractScalarMetadata(data) {
  const metadata = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || Array.isArray(value) || isPlainObject(value)) continue;
    metadata[key] = String(value);
  }
  return metadata;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {string} [sectionHeading]
 * @returns {ArtifactTable | null}
 */
function tableFromObjectArray(rows, sectionHeading) {
  if (rows.length === 0) return null;

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const tableRows = rows.map((row) => headers.map((h) => formatCell(row[h])));

  return { headers, rows: tableRows, sectionHeading };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {ArtifactMetric[]}
 */
function metricsFromScalars(key, value) {
  if (typeof value === 'number') {
    return [{ name: key, value, context: 'root' }];
  }
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
    return [{ name: key, value: Number(value), context: 'root' }];
  }
  return [];
}

/**
 * @param {Record<string, unknown>} data
 * @returns {ArtifactMetric[]}
 */
function extractRootMetrics(data) {
  const metricKeys = [
    'totalProducts',
    'totalRolesChecked',
    'total',
    'count',
    'generated_at',
    'generatedAt',
  ];

  const metrics = [];
  for (const key of Object.keys(data)) {
    if (metricKeys.includes(key) || /^(total|count|num)/i.test(key)) {
      metrics.push(...metricsFromScalars(key, data[key]));
    }
  }
  return metrics;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} depth
 * @returns {ArtifactSection}
 */
function sectionFromValue(key, value, depth = 2) {
  const section = {
    level: Math.min(depth, 6),
    heading: key,
    paragraphs: [],
    lists: [],
    tables: [],
    codeBlocks: [],
    subsections: [],
  };

  if (Array.isArray(value)) {
    if (value.length > 0 && isPlainObject(value[0])) {
      const table = tableFromObjectArray(value, key);
      if (table) section.tables.push(table);
    } else {
      section.lists.push({
        ordered: false,
        items: value.map((item) => formatCell(item)),
      });
    }
    return section;
  }

  if (isPlainObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (Array.isArray(childValue) && childValue.length > 0 && isPlainObject(childValue[0])) {
        const table = tableFromObjectArray(childValue, childKey);
        if (table) section.tables.push(table);
      } else if (isPlainObject(childValue)) {
        section.subsections.push(sectionFromValue(childKey, childValue, depth + 1));
      } else if (Array.isArray(childValue)) {
        section.lists.push({
          ordered: false,
          items: childValue.map((item) => formatCell(item)),
        });
      } else {
        section.paragraphs.push(`${childKey}: ${formatCell(childValue)}`);
      }
    }
    return section;
  }

  section.paragraphs.push(formatCell(value));
  return section;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {ArtifactSection[]}
 */
function buildSections(data) {
  const sections = [];
  const reserved = new Set(['title', 'name', 'report']);

  for (const [key, value] of Object.entries(data)) {
    if (reserved.has(key)) continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      continue;
    }
    sections.push(sectionFromValue(key, value));
  }

  return sections;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {ArtifactTable[]}
 */
function collectTables(sections) {
  const tables = [];

  function walk(section) {
    tables.push(...section.tables);
    for (const sub of section.subsections) walk(sub);
  }

  for (const section of sections) walk(section);
  return tables;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {ArtifactList[]}
 */
function collectLists(sections) {
  const lists = [];

  function walk(section) {
    lists.push(...section.lists);
    for (const sub of section.subsections) walk(sub);
  }

  for (const section of sections) walk(section);
  return lists;
}

/**
 * Parse a JSON document into normalized artifact fields.
 * @param {string} content
 * @param {string} filename
 * @returns {JsonParseResult}
 */
export function parseJson(content, filename) {
  const data = JSON.parse(content);

  if (!isPlainObject(data)) {
    return {
      title: deriveTitle(filename, {}),
      metadata: {},
      sections: [
        {
          level: 1,
          heading: 'Root',
          paragraphs: [formatCell(data)],
          lists: [],
          tables: [],
          codeBlocks: [],
          subsections: [],
        },
      ],
      tables: [],
      lists: [],
      metrics: [],
      references: [],
    };
  }

  const title = deriveTitle(filename, data);
  const metadata = extractScalarMetadata(data);
  const sections = buildSections(data);
  const tables = collectTables(sections);
  const lists = collectLists(sections);
  const metrics = extractRootMetrics(data);

  for (const table of tables) {
    const headers = table.headers.map((h) => h.toLowerCase());
    if (headers.some((h) => /confidence|risk|id|name/.test(h))) {
      continue;
    }
    const metricIdx = headers.findIndex((h) => /metric|name|action|finish/.test(h));
    const valueIdx = headers.findIndex((h) => /count|value|total/.test(h));
    if (metricIdx >= 0 && valueIdx >= 0) {
      for (const row of table.rows) {
        metrics.push({
          name: row[metricIdx],
          value: row[valueIdx],
          context: table.sectionHeading,
        });
      }
    }
  }

  const references = [];
  if (Array.isArray(data.updated)) {
    for (const item of data.updated) {
      if (isPlainObject(item) && typeof item.id === 'string') {
        references.push({ text: item.id, type: 'id' });
      }
    }
  }

  return {
    title,
    metadata,
    sections,
    tables,
    lists,
    metrics,
    references,
  };
}
