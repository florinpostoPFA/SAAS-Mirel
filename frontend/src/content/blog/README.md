# Blog content

This directory holds the content sources for the `/blog` routes.

## Structure

- `posts.json` — index metadata (array of posts).
- `posts/<slug>.md` — markdown body for each post. Each slug must also be
  registered in the `markdownLoaders` map in `src/blog/blogData.js`.

## Post metadata fields

```
{
  "slug": "hello-world",
  "title": "Hello, world",
  "date": "2026-05-10",          // ISO date
  "description": "Short summary used on the index and SEO meta.",
  "coverImage": "/blog/file.svg" // optional, see "Images" below
}
```

## Images

Two conventions are supported, in order of preference:

1. **Public images (default)** — store images under `frontend/public/blog/` and
   reference them in `coverImage` (or markdown) with an absolute path like
   `/blog/<file>`. No import or import map needed. This is the path used by the
   sample post.
2. **Bundled images** — store images under `frontend/src/assets/blog/` and
   import them from a small mapping util (mirrors how markdown is loaded). Use
   this only when you need cache-busted hashed URLs.

## Image performance rules

- Cover image: rendered eagerly inside a 16:9 aspect-ratio wrapper to reserve
  layout space and avoid CLS.
- Inline images in markdown: rendered with `loading="lazy"` automatically by
  the `marked` renderer override in `src/pages/BlogPostPage.js`.
- Keep source images reasonably sized; avoid uncompressed multi-MB files in
  the repo.
