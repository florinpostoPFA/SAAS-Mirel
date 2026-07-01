import fs from 'node:fs/promises';
import path from 'node:path';

/** @type {readonly string[]} */
export const SUPPORTED_EXTENSIONS = ['.md', '.json'];

/**
 * @typedef {Object} Document
 * @property {string} path - Absolute path to the file
 * @property {string} filename - Base name
 * @property {string} extension - Lowercase extension including dot
 * @property {number} size - Byte size on disk
 * @property {string} content - UTF-8 file contents
 */

/**
 * Recursively collect supported files under a directory.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

/**
 * Load a single file as a Document.
 * @param {string} filePath
 * @returns {Promise<Document>}
 */
export async function loadDocument(filePath) {
  const stat = await fs.stat(filePath);
  const content = await fs.readFile(filePath, 'utf8');

  return {
    path: filePath,
    filename: path.basename(filePath),
    extension: path.extname(filePath).toLowerCase(),
    size: stat.size,
    content,
  };
}

/**
 * Discover and load every supported document under reportsDir.
 * @param {string} reportsDir
 * @returns {Promise<Document[]>}
 */
export async function loadDocuments(reportsDir) {
  const filePaths = await collectFiles(reportsDir);
  return Promise.all(filePaths.map(loadDocument));
}
