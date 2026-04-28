const { stableStringify, canonicalize } = require("./canonicalize");

function collectPathDiffs(a, b, prefix = "") {
  const diffs = [];
  if (a === b) return diffs;
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb || (ta !== "object" && ta !== "undefined") || a === null || b === null) {
    diffs.push({ path: prefix || "(root)", left: a, right: b });
    return diffs;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const sa = stableStringify(a);
    const sb = stableStringify(b);
    if (sa !== sb) {
      diffs.push({ path: prefix || "(root)", left: a, right: b });
    }
    return diffs;
  }
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of [...keys].sort()) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (!(k in a)) {
      diffs.push({ path: p, left: undefined, right: b[k] });
    } else if (!(k in b)) {
      diffs.push({ path: p, left: a[k], right: undefined });
    } else {
      diffs.push(...collectPathDiffs(a[k], b[k], p));
    }
  }
  return diffs;
}

function buildDiffMarkdown(diffs, { limit = 40 } = {}) {
  const lines = ["# Golden diff summary", "", `Showing up to ${limit} changes (total ${diffs.length}).`, ""];
  const slice = diffs.slice(0, limit);
  for (const d of slice) {
    const l = JSON.stringify(d.left);
    const r = JSON.stringify(d.right);
    lines.push(`- **${d.path}**`);
    lines.push(`  - expected: \`${l.length > 120 ? `${l.slice(0, 117)}...` : l}\``);
    lines.push(`  - actual: \`${r.length > 120 ? `${r.slice(0, 117)}...` : r}\``);
    lines.push("");
  }
  if (diffs.length > limit) {
    lines.push(`… and ${diffs.length - limit} more (see diff.json).`, "");
  }
  return lines.join("\n");
}

function diffGoldenObjects(expected, actual) {
  const ca = canonicalize(expected);
  const cb = canonicalize(actual);
  const equal = stableStringify(ca) === stableStringify(cb);
  const pathDiffs = equal ? [] : collectPathDiffs(ca, cb);
  return {
    equal,
    pathDiffs,
    expectedSerialized: stableStringify(ca),
    actualSerialized: stableStringify(cb)
  };
}

module.exports = {
  diffGoldenObjects,
  buildDiffMarkdown,
  collectPathDiffs
};
