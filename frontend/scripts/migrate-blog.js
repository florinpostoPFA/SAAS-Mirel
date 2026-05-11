#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * migrate-blog.js
 *
 * Lightweight migration helper for the Posto blog.
 *
 * Reads a folder of `.md` files (optionally with YAML frontmatter)
 * and merges them into the as-built blog structure:
 *
 *   - frontend/src/content/blog/posts.json        (metadata index, deduped by slug)
 *   - frontend/src/content/blog/posts/<slug>.md   (markdown body)
 *
 * Loader registrations in `frontend/src/blog/blogData.js` are intentionally
 * explicit by design and are NOT modified by this script. The script prints
 * the exact lines you need to add for each migrated slug.
 *
 * Usage:
 *   node scripts/migrate-blog.js <input-dir> [--dry-run]
 *
 * Frontmatter (all fields optional, sensible fallbacks applied):
 *   ---
 *   title: My post
 *   slug: my-post
 *   date: 2026-05-10
 *   description: One sentence summary.
 *   categories: [Engineering, Product]
 *   coverImage: /blog/cover.svg
 *   ---
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const POSTS_JSON = path.join(ROOT, "src", "content", "blog", "posts.json");
const POSTS_DIR = path.join(ROOT, "src", "content", "blog", "posts");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const inputDir = args.find((a) => !a.startsWith("--"));

if (!inputDir) {
  console.error("Usage: node scripts/migrate-blog.js <input-dir> [--dry-run]");
  process.exit(1);
}

const inputDirAbs = path.resolve(inputDir);
if (!fs.existsSync(inputDirAbs) || !fs.statSync(inputDirAbs).isDirectory()) {
  console.error(`Input directory not found: ${inputDirAbs}`);
  process.exit(1);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[\u00C0-\u017F]/g, (c) => c.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const [, yaml, body] = match;
  const frontmatter = {};
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function firstHeadingTitle(body) {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function firstParagraph(body) {
  const stripped = body.replace(/^#.*$/gm, "").trim();
  const para = stripped.split(/\r?\n\s*\r?\n/).find((p) => p.trim());
  if (!para) return null;
  return para.replace(/\s+/g, " ").trim().slice(0, 200);
}

function loadExistingPosts() {
  if (!fs.existsSync(POSTS_JSON)) return [];
  try {
    return JSON.parse(fs.readFileSync(POSTS_JSON, "utf8"));
  } catch (err) {
    console.error(`Failed to parse ${POSTS_JSON}: ${err.message}`);
    process.exit(1);
  }
}

function writePostsJson(posts) {
  const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));
  const json = JSON.stringify(sorted, null, 2) + "\n";
  fs.writeFileSync(POSTS_JSON, json, "utf8");
}

function migrateOne(filePath, existingPosts) {
  const filename = path.basename(filePath);
  if (!filename.endsWith(".md")) {
    return { skipped: true, reason: "not a .md file" };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);

  const fileBase = filename.replace(/\.md$/, "");
  const dateFromFilename = (fileBase.match(/^(\d{4}-\d{2}-\d{2})(.*)$/) || [])[1];
  const slugSourceFromFilename =
    (fileBase.match(/^\d{4}-\d{2}-\d{2}-(.+)$/) || [])[1] || fileBase;

  const title = frontmatter.title || firstHeadingTitle(body) || slugSourceFromFilename;
  const slug = slugify(frontmatter.slug || slugSourceFromFilename || title);
  const date = frontmatter.date || dateFromFilename || isoDate(fs.statSync(filePath).mtime);
  const description = frontmatter.description || firstParagraph(body) || "";

  const post = { slug, title, date, description };

  const cats = frontmatter.categories;
  if (Array.isArray(cats) && cats.length) post.categories = cats;
  else if (typeof cats === "string" && cats.trim()) post.categories = [cats.trim()];

  if (frontmatter.coverImage) post.coverImage = frontmatter.coverImage;

  const trimmedBody = body.replace(/^\s*\n+/, "").replace(/\s+$/, "") + "\n";
  const existingIdx = existingPosts.findIndex((p) => p.slug === slug);

  return {
    skipped: false,
    slug,
    post,
    body: trimmedBody,
    targetMarkdownPath: path.join(POSTS_DIR, `${slug}.md`),
    isUpdate: existingIdx !== -1,
  };
}

function isoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function camelCase(slug) {
  return slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function main() {
  const inputs = fs
    .readdirSync(inputDirAbs)
    .map((f) => path.join(inputDirAbs, f))
    .filter((p) => fs.statSync(p).isFile());

  if (inputs.length === 0) {
    console.error(`No files found in ${inputDirAbs}`);
    process.exit(1);
  }

  console.log(`migrate-blog: scanning ${inputs.length} file(s) in ${inputDirAbs}`);
  console.log(`migrate-blog: target posts.json = ${POSTS_JSON}`);
  console.log(`migrate-blog: target markdown dir = ${POSTS_DIR}`);
  console.log(`migrate-blog: dry-run = ${dryRun ? "yes" : "no"}\n`);

  const existing = loadExistingPosts();
  const updated = [...existing];
  const reports = [];
  const seenSlugs = new Set(existing.map((p) => p.slug));

  for (const filePath of inputs) {
    const result = migrateOne(filePath, updated);
    if (result.skipped) {
      reports.push({ file: filePath, action: "skip", reason: result.reason });
      continue;
    }

    if (seenSlugs.has(result.slug) && !result.isUpdate) {
      reports.push({
        file: filePath,
        action: "skip",
        slug: result.slug,
        reason: "slug already taken in this run",
      });
      continue;
    }
    seenSlugs.add(result.slug);

    const idx = updated.findIndex((p) => p.slug === result.slug);
    if (idx === -1) {
      updated.push(result.post);
    } else {
      updated[idx] = { ...updated[idx], ...result.post };
    }

    if (!dryRun) {
      if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });
      fs.writeFileSync(result.targetMarkdownPath, result.body, "utf8");
    }

    reports.push({
      file: filePath,
      action: result.isUpdate ? "update" : "create",
      slug: result.slug,
      target: result.targetMarkdownPath,
      post: result.post,
    });
  }

  if (!dryRun) writePostsJson(updated);

  for (const r of reports) {
    if (r.action === "skip") {
      console.log(`SKIP  ${path.basename(r.file)}  (${r.reason})`);
    } else {
      const tag = r.action.toUpperCase().padEnd(7, " ");
      console.log(`${tag}${path.basename(r.file)}  ->  ${r.slug}.md`);
    }
  }

  const newOrUpdated = reports.filter((r) => r.action !== "skip");
  if (newOrUpdated.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  console.log(
    `\n${dryRun ? "[dry-run] would " : ""}wrote ${newOrUpdated.length} post(s) to posts.json` +
      (dryRun ? "" : ".")
  );

  console.log(
    "\nNext step: register each NEW slug in src/blog/blogData.js (loaders are explicit by design)."
  );
  console.log("Add the import + map entry, e.g.:\n");
  for (const r of newOrUpdated.filter((r) => r.action === "create")) {
    const camel = camelCase(r.slug);
    console.log(`  import ${camel}Url from "../content/blog/posts/${r.slug}.md";`);
    console.log(`  // markdownLoaders["${r.slug}"] = () => fetchMarkdown(${camel}Url);`);
    console.log("");
  }

  console.log("Then validate with:");
  console.log("  npm run build");
  console.log("  npm run start");
}

main();
