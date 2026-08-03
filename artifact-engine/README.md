# Artifact Engine

Deterministic pipeline that converts engineering artifacts (Markdown and JSON) from `reports/` into normalized **Artifact** JSON files in `artifacts/`.

This is **not** a RAG system. No LLM, embeddings, or summarization — only structural parsing and rule-based classification. A future `llmAnalyzer.js` module can consume Artifact objects for reasoning (executive summary, risks, recommendations, etc.).

## Architecture

```
reports/          →  loader  →  classifier  →  parser  →  writer  →  artifacts/
   *.md, *.json        │            │            │           │
                       │            │            ├─ markdownParser.js
                       │            │            └─ jsonParser.js
                       │            └─ classifier.js (filename, heading, metadata, keywords)
                       └─ loader.js (recursive discovery)
```

### Modules

| Module | Path | Responsibility |
|--------|------|----------------|
| **Loader** | `loader/loader.js` | Recursively scan `reports/`, load `.md` and `.json` as `Document` objects |
| **Classifier** | `classifier/classifier.js` | Assign artifact type (BLOG, FINISH, FLOW, …) using rules — no AI |
| **Model** | `model/artifact.js` | Normalized `Artifact` shape, independent of source format |
| **Markdown parser** | `parsers/markdownParser.js` | Extract title, headings, paragraphs, tables, lists, metadata, code blocks |
| **JSON parser** | `parsers/jsonParser.js` | Map JSON structures into the same Artifact model |
| **Writer** | `output/writer.js` | Write one pretty-printed JSON file per source document |
| **Pipeline** | `index.js` | Orchestrate load → classify → parse → write |

## Artifact model

Every document becomes the same structure:

```json
{
  "id": "flow_gap_analysis",
  "filename": "flow_gap_analysis.md",
  "type": "FLOW",
  "title": "Flow Gap Analysis",
  "metadata": { "Date": "2026-06-14" },
  "sections": [ "..." ],
  "tables": [ "..." ],
  "lists": [ "..." ],
  "metrics": [ "..." ],
  "references": [ "..." ],
  "rawDocument": { "path": "...", "extension": ".md", "size": 29490 }
}
```

Supported artifact types: `BLOG`, `CATALOG`, `DILUTION`, `FINISH`, `FLOW`, `IMPLEMENTATION`, `ROLE`, `METRICS`, `VALIDATION`, `ROADMAP`, `SUMMARY`, `PATCH`, `UNKNOWN`.

## Usage

From the repository root:

```bash
node artifact-engine/index.js
```

Or with custom paths:

```bash
node artifact-engine/index.js ./reports ./artifacts
```

From inside `artifact-engine/`:

```bash
npm start
```

Run unit tests:

```bash
cd artifact-engine && npm test
```

## Programmatic API

```javascript
import { runPipeline, documentToArtifact } from './artifact-engine/index.js';

const { artifacts, written } = await runPipeline({
  reportsDir: './reports',
  outputDir: './artifacts',
});

// Future hook point:
// import { analyzeArtifact } from './artifact-engine/llmAnalyzer.js';
// for (const artifact of artifacts) await analyzeArtifact(artifact);
```

## Design notes

- **Pure functions** where possible — classifier, parsers, and model helpers are unit-testable without I/O.
- **No interpretation** — parsers preserve document structure; they do not summarize or infer meaning.
- **Format-agnostic output** — downstream consumers (including a future LLM analyzer) work only with `Artifact` objects.
- **ES modules** — Node.js 20+, async/await throughout.

## Output

Each file in `reports/` produces exactly one JSON file in `artifacts/`:

```
reports/finish_phase1_candidates.md  →  artifacts/finish_phase1_candidates.json
reports/role-coverage-report.json    →  artifacts/role-coverage-report.json
```
