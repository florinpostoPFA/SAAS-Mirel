<!--
Canonical source: Notion → 6.2. Blog Publishing Procedure (Locked v2)
Do not edit here. Edit canonical, regenerate this shard on next lock cycle.
Last synced: 2026-05-13 (v2)
-->

# Blog publish — Cursor ticket template

Paste this block into every Frontend Board ticket of type "Publish blog post".

Ticket: Publish blog post — <Title> (<slug>)
Source task: <link to V&C task>
Approved: yes (<date>)

Actions (in order, do not deviate):
1. git pull origin main
2. Place <slug>.md in the blog content folder per as-built §7.
3. Append posts.json entry matching the most recent entry's shape.
4. Place hero/image assets in the configured folder.
5. cd frontend && npm run build  → must print "check-sitemap-posts: OK"
6. If PASS: git commit -m "content(blog): publish <slug>"
7. npm run publish:push
8. Update this ticket status to "Pushed — awaiting deploy".

Do NOT:
- run npm run deploy:prod
- edit sitemap.xml
- modify any other route/component/config
- SSH to the VPS
- skip step 5
