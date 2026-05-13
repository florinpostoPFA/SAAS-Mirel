<!--
Canonical source(s):
- Notion → 6.2. Blog Publishing Procedure (Locked v2), §Step 8
This file is shared across procedures. New recipes append here.
Last synced: 2026-05-13
-->

# Validation recipes

Reusable post-deploy checks. Pick the section that matches what you shipped.

## Blog post publish

curl -sI https://postosaas.com/blog/<slug>                 # expect 200
curl -s  https://postosaas.com/sitemap.xml | grep <slug>   # expect a match
curl -sI https://postosaas.com/api/health                  # x-backend-sha sanity

Visual: load /blog/<slug> in a browser, confirm render and per-post meta.
Known limitation: react-helmet injects meta client-side; non-JS unfurlers will not see it (TD5).
