# Frontend scripts

Lightweight, zero-dependency Node helpers for the frontend.

## migrate-blog.js

Imports a folder of `.md` files into the as-built blog content layout
(`src/content/blog/posts.json` + `src/content/blog/posts/<slug>.md`).
Loader registrations in `src/blog/blogData.js` stay explicit by design and
are not modified — the script prints the exact lines you need to add.

### Usage

```
npm run migrate:blog -- <input-dir> [--dry-run]
```

or directly:

```
node scripts/migrate-blog.js <input-dir> [--dry-run]
```

### Supported input

A directory of `.md` files. Each file may optionally start with a YAML
frontmatter block:

```
---
title: My post
slug: my-post
date: 2026-05-10
description: One sentence summary.
categories: [Engineering, Product]
coverImage: /blog/cover.svg
---

# My post

Body of the post.
```

All frontmatter fields are optional. Fallbacks:

| Field | Fallback |
| --- | --- |
| `slug` | filename without `.md` (date prefix stripped if filename is `YYYY-MM-DD-slug.md`), slugified |
| `title` | first `# heading` in the body, else the slug source |
| `date` | `YYYY-MM-DD` prefix in the filename, else file mtime in UTC |
| `description` | first non-heading paragraph (truncated to 200 chars) |
| `categories` | omitted if not present (defaults to `[]` at runtime in `blogData.js`) |
| `coverImage` | omitted if not present |

### Behavior

- `--dry-run` writes nothing; prints what would change.
- Existing slugs are **updated** (metadata merged, markdown body replaced),
  not duplicated.
- `posts.json` is rewritten sorted newest-first to match `getAllPosts()`.
- For each NEW slug, the script prints the import + loader-map lines you
  need to paste into `src/blog/blogData.js`.

### Validation

After running:

1. Add the printed loader lines into `src/blog/blogData.js`.
2. `npm run build` — must finish with `Compiled successfully.`
3. `npm run start` — visit `/blog` to confirm the new post appears, then
   `/blog/<slug>` to confirm the body renders.
