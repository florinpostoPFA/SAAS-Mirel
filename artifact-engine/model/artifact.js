/**
 * Normalized Artifact model — format-agnostic representation of engineering knowledge.
 * Designed for downstream consumption by llmAnalyzer.js (future).
 */

/**
 * @typedef {Object} ArtifactSection
 * @property {number} level - Heading depth (1 = document title, 2+ = sections)
 * @property {string} heading
 * @property {string[]} paragraphs
 * @property {ArtifactList[]} lists
 * @property {ArtifactTable[]} tables
 * @property {ArtifactCodeBlock[]} codeBlocks
 * @property {ArtifactSection[]} subsections
 */

/**
 * @typedef {Object} ArtifactList
 * @property {boolean} ordered
 * @property {string[]} items
 */

/**
 * @typedef {Object} ArtifactTable
 * @property {string[]} headers
 * @property {string[][]} rows
 * @property {string} [caption]
 * @property {string} [sectionHeading]
 */

/**
 * @typedef {Object} ArtifactCodeBlock
 * @property {string} language
 * @property {string} content
 */

/**
 * @typedef {Object} ArtifactMetric
 * @property {string} name
 * @property {string|number} value
 * @property {string} [unit]
 * @property {string} [context]
 */

/**
 * @typedef {Object} ArtifactReference
 * @property {string} text
 * @property {string} [href]
 * @property {string} type - 'link' | 'file' | 'id'
 */

/**
 * @typedef {Object} Artifact
 * @property {string} id
 * @property {string} filename
 * @property {string} type
 * @property {string} title
 * @property {Record<string, string>} metadata
 * @property {ArtifactSection[]} sections
 * @property {ArtifactTable[]} tables
 * @property {ArtifactList[]} lists
 * @property {ArtifactMetric[]} metrics
 * @property {ArtifactReference[]} references
 * @property {Object} rawDocument
 */

/**
 * Derive a stable artifact id from a filename (without extension).
 * @param {string} filename
 * @returns {string}
 */
export function deriveId(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * Create a blank Artifact shell for a source document.
 * @param {{ filename: string, path: string, extension: string, content: string }} document
 * @param {string} type - Classified artifact type
 * @returns {Artifact}
 */
export function createArtifact(document, type) {
  return {
    id: deriveId(document.filename),
    filename: document.filename,
    type,
    title: '',
    metadata: {},
    sections: [],
    tables: [],
    lists: [],
    metrics: [],
    references: [],
    rawDocument: {
      path: document.path,
      extension: document.extension,
      size: document.content.length,
    },
  };
}

/**
 * Merge parser output into an existing Artifact.
 * @param {Artifact} artifact
 * @param {Partial<Artifact>} parsed
 * @returns {Artifact}
 */
export function mergeParsedContent(artifact, parsed) {
  return {
    ...artifact,
    title: parsed.title ?? artifact.title,
    metadata: { ...artifact.metadata, ...(parsed.metadata ?? {}) },
    sections: parsed.sections ?? artifact.sections,
    tables: [...artifact.tables, ...(parsed.tables ?? [])],
    lists: [...artifact.lists, ...(parsed.lists ?? [])],
    metrics: [...artifact.metrics, ...(parsed.metrics ?? [])],
    references: [...artifact.references, ...(parsed.references ?? [])],
  };
}
