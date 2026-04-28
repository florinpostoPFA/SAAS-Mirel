# SAAS-Mirel
Mirel is the best

## LAN backend start checklist

```bash
pkill -f "node server.js" || true
lsof -i :3001
npm start
```

- Expect `lsof -i :3001` to be empty before start.
- After `npm start`, expect a single `node` process bound to `*:3001`.
