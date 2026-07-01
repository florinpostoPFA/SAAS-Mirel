import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {import('../model/artifact.js').Artifact} Artifact
 */

/**
 * Ensure the output directory exists.
 * @param {string} outputDir
 */
export async function ensureOutputDir(outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
}

/**
 * Resolve the output path for an artifact.
 * @param {Artifact} artifact
 * @param {string} outputDir
 * @returns {string}
 */
export function artifactOutputPath(artifact, outputDir) {
  return path.join(outputDir, `${artifact.id}.json`);
}

/**
 * Write a single Artifact as pretty-printed JSON.
 * @param {Artifact} artifact
 * @param {string} outputDir
 * @returns {Promise<string>} Written file path
 */
export async function writeArtifact(artifact, outputDir) {
  await ensureOutputDir(outputDir);
  const filePath = artifactOutputPath(artifact, outputDir);
  const json = JSON.stringify(artifact, null, 2);
  await fs.writeFile(filePath, `${json}\n`, 'utf8');
  return filePath;
}

/**
 * Write all artifacts to the output directory.
 * @param {Artifact[]} artifacts
 * @param {string} outputDir
 * @returns {Promise<string[]>} Written file paths
 */
export async function writeArtifacts(artifacts, outputDir) {
  return Promise.all(artifacts.map((artifact) => writeArtifact(artifact, outputDir)));
}
