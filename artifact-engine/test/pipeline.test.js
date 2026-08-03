import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDocument } from '../classifier/classifier.js';
import { parseMarkdown } from '../parsers/markdownParser.js';
import { deriveId } from '../model/artifact.js';
import { documentToArtifact } from '../index.js';

describe('classifier', () => {
  it('classifies finish_phase1_candidates as FINISH', () => {
    const type = classifyDocument({
      filename: 'finish_phase1_candidates.md',
      extension: '.md',
      content: '# Finish Phase 1 Candidates',
    });
    assert.equal(type, 'FINISH');
  });

  it('classifies flow_gap_analysis as FLOW', () => {
    const type = classifyDocument({
      filename: 'flow_gap_analysis.md',
      extension: '.md',
      content: '# Flow Gap Analysis',
    });
    assert.equal(type, 'FLOW');
  });

  it('classifies implementation_roadmap as IMPLEMENTATION', () => {
    const type = classifyDocument({
      filename: 'implementation_roadmap.md',
      extension: '.md',
      content: '# Implementation Roadmap',
    });
    assert.equal(type, 'IMPLEMENTATION');
  });

  it('classifies role-coverage-report.json as ROLE', () => {
    const type = classifyDocument({
      filename: 'role-coverage-report.json',
      extension: '.json',
      content: '{"totalProducts": 2101}',
    });
    assert.equal(type, 'ROLE');
  });
});

describe('markdownParser', () => {
  it('extracts title, metadata, tables, and lists', () => {
    const md = `# Test Report

**Date:** 2026-06-14

---

## Scope

| Metric | Count |
|--------|------:|
| Items | 10 |

- first item
- second item
`;

    const parsed = parseMarkdown(md);
    assert.equal(parsed.title, 'Test Report');
    assert.equal(parsed.metadata.Date, '2026-06-14');
    assert.equal(parsed.tables.length, 1);
    assert.equal(parsed.tables[0].headers[0], 'Metric');
    assert.equal(parsed.lists[0].items.length, 2);
    assert.ok(parsed.metrics.some((m) => m.name === 'Items'));
  });
});

describe('pipeline', () => {
  it('derives stable artifact ids', () => {
    assert.equal(deriveId('flow_gap_analysis.md'), 'flow_gap_analysis');
  });

  it('produces a complete artifact object', () => {
    const proper = documentToArtifact({
      path: '/tmp/finish_phase1_metrics.md',
      filename: 'finish_phase1_metrics.md',
      extension: '.md',
      size: 100,
      content: `# Finish Phase 1 Metrics

| Metric | Count |
|--------|------:|
| Total | 120 |
`,
    });

    assert.equal(proper.id, 'finish_phase1_metrics');
    assert.equal(proper.type, 'METRICS');
    assert.equal(proper.title, 'Finish Phase 1 Metrics');
    assert.ok(proper.tables.length >= 1);
    assert.ok(proper.rawDocument);
  });
});
