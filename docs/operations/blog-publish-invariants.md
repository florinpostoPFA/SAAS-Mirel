<!--
Canonical source: Notion → 6.2. Blog Publishing Procedure (Locked v2)
Do not edit here. Edit canonical, regenerate this shard on next lock cycle.
Last synced: 2026-05-13 (v2)
-->

# Blog publishing invariants

- No blog post enters the Frontend Board without explicit V&C approval.
- One blog post = one Frontend Board ticket. No batched tickets.
- Cursor never edits sitemap.xml directly. The check-sitemap-posts prebuild gate is the contract.
- Local `npm run build` PASS is required before any push.
- Deploy chain is operator-driven. Cursor never runs `npm run deploy:prod`.
- `publish:push` and `deploy:prod` remain separate scripts. Merging them requires a new lock cycle.
- Handoff phrase is literal: "go to board, do ticket <Title>".
- Cursor's scope is bound to the named ticket. Out-of-scope edits abort the run.
