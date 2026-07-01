/**
 * Artifact Engine — deterministic document processing pipeline.
 *
 * Converts engineering artifacts (Markdown, JSON) from reports/ into
 * normalized Artifact JSON files in artifacts/.
 *
 * Future: pass each Artifact to llmAnalyzer.js for reasoning (not implemented).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDocuments } from './loader/loader.js';
import { classifyDocument } from './classifier/classifier.js';
import { createArtifact, mergeParsedContent } from './model/artifact.js';
import { parseMarkdown } from './parsers/markdownParser.js';
import { parseJson } from './parsers/jsonParser.js';
import { writeArtifacts } from './output/writer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * @typedef {import('./loader/loader.js').Document} Document
 * @typedef {import('./model/artifact.js').Artifact} Artifact
 */

/**
 * Parse a document into artifact fields based on its extension.
 * @param {Document} document
 * @returns {import('./model/artifact.js').Artifact}
 */
export function documentToArtifact(document) {
  const type = classifyDocument(document);
  const artifact = createArtifact(document, type);

  const parsed =
    document.extension === '.json'
      ? parseJson(document.content, document.filename)
      : parseMarkdown(document.content);

  return mergeParsedContent(artifact, parsed);
}

/**
 * Run the full pipeline: load → classify → parse → write.
 * @param {{ reportsDir?: string, outputDir?: string }} [options]
 * @returns {Promise<{ artifacts: Artifact[], written: string[] }>}
 */
export async function runPipeline(options = {}) {
  const reportsDir = options.reportsDir ?? path.join(PROJECT_ROOT, 'reports');
  const outputDir = options.outputDir ?? path.join(PROJECT_ROOT, 'artifacts');

  const documents = await loadDocuments(reportsDir);
  const artifacts = documents.map(documentToArtifact);
  const written = await writeArtifacts(artifacts, outputDir);

  return { artifacts, written };
}

/**
 * Entry point when executed directly.
 */
async function main() {
  const reportsDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(PROJECT_ROOT, 'reports');
  const outputDir = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(PROJECT_ROOT, 'artifacts');

  console.log(`Artifact Engine`);
  console.log(`  Input:  ${reportsDir}`);
  console.log(`  Output: ${outputDir}`);
  console.log('');

  const { artifacts, written } = await runPipeline({ reportsDir, outputDir });

  const typeCounts = {};
  for (const artifact of artifacts) {
    typeCounts[artifact.type] = (typeCounts[artifact.type] ?? 0) + 1;
  }

  console.log(`Processed ${artifacts.length} documents → ${written.length} artifacts`);
  console.log('');
  console.log('By type:');
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(16)} ${count}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
