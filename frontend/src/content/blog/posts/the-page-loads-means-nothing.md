# The moment we realized “the page loads” means almost nothing

If the browser shows your blog, you still do not know what shipped.

A successful paint only proves that **some** HTML and **some** JavaScript ran. It does not prove:

- which **git commit** is live on the server;
- that the **API** behind the SPA matches that same build;
- that you are not looking at a **cached** bundle, stale static files, or an old process that never restarted;
- that your **markdown** or **data** assets match the code you think you deployed.

Operational trust needs **evidence**, not a screenshot of a hero section.

## What we use instead

**1. Frontend build identity (in HTML)**  
The production build stamps the SPA shell with short git SHA and build time (meta tags in `index.html`). You can verify them without opening DevTools:

```bash
curl -sS https://example.com/blog | grep -iE 'x-frontend-(sha|build-time)'
```

Replace `example.com` with your host. You should see non-empty values after a real deploy.

**2. Backend deploy identity**  
The API exposes the same kind of truth in one place:

```bash
curl -sS https://example.com/api/version
```

Expect JSON with `sha` and `buildTime`. The response should also carry an `x-backend-sha` header you can grep from headers alone:

```bash
curl -sS -D- -o /dev/null https://example.com/api/version | grep -i x-backend-sha
```

**3. One deterministic deploy path**  
Manual edits on the server are how variance sneaks in. Prefer: pull pinned revision → install from lockfile → build → reload reverse proxy → **restart the Node process** so it reads the deploy stamp file written at build time. If your repo ships a single `deploy.sh`, that script is the contract; anything else is improvisation.

**4. Optional smoke pass**  
After deploy, hit `/api/health`, `/api/version`, and a blog URL in one short script. Count network requests for markdown on a post page once (no refresh loops). Idle for a minute and confirm you do not see surprise refetches.

## Rule of thumb

Treat **“I see the page”** as a **UI smoke check**. Treat **matching stamps on HTML + `/api/version` + no stale processes** as the **deploy acceptance check**. When those disagree, assume the environment is lying until proven otherwise.

That is deploy trust: small, repeatable signals that tell you **what** is running—not that something merely rendered.
