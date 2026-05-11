# Shipping the blog

We added a blog to Posto without changing frameworks.

## Why CRA

The Posto frontend is a small Create React App SPA today. Migrating to a new framework just to publish a few posts would have cost more than it returned, so we kept the existing setup and added a thin blog layer on top of it.

## How it works

- Posts live as Markdown files under `src/content/blog/posts/`.
- An index file, `posts.json`, holds the metadata for each post.
- A small loader maps slugs to fetchable Markdown URLs and returns the parsed HTML at runtime.
- Routes `/blog` and `/blog/:slug` render the index and detail pages inside a shared layout.

## What we deliberately skipped

1. A CMS.
2. SSR / SSG.
3. A design system.

We will revisit those if and when content volume justifies them.
