/**
 * Step 5a — --force-all uses LLM-only tags (no keyword inference union).
 * @jest-environment node
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { runTaggingPipeline, inferDeterministicTags } = require("../scripts/autoTagProducts");

const PLAST_X_FIXTURE = {
  id: "plast-x",
  name: "Pasta polish pentru plastic Meguiar's Plast X G12310, 295ml",
  description: "Restaurare plastic exterior si interior",
  short_description: "Polish plastic Meguiar's Plast X",
  meta_keyword: "plastic, polish, plast x, restaurare",
  searchText:
    "pasta polish pentru plastic meguiar's plast x g12310 restaurare plastic exterior interior",
  tags: ["plastic_interior", "glass", "tires", "cleaning"]
};

const POLISH_PLASTIC_FIXTURE = {
  id: "polish-plastic",
  name: "Pasta polish pentru plastic",
  description: "Curatare si polish suprafete plastic",
  short_description: "Polish plastic",
  meta_keyword: "plastic, polish",
  searchText: "pasta polish pentru plastic curatare polish",
  tags: []
};

describe("autoTagProducts --force-all LLM-only (Step 5a)", () => {
  let tmpDir;
  let diffLogPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "retag-force-all-"));
    diffLogPath = path.join(tmpDir, "retag-test.jsonl");
    askLLM.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("forceAll=true: persisted tags match LLM only (no keyword contamination)", async () => {
    askLLM.mockResolvedValue('["paint","polish_compound","exterior"]');
    const products = [{ ...POLISH_PLASTIC_FIXTURE }];

    const keywordOnly = inferDeterministicTags(products[0]);
    expect(keywordOnly.length).toBeGreaterThan(0);

    await runTaggingPipeline(products, {
      forceAll: true,
      persistPath: null,
      diffLogPath
    });

    expect(products[0].tags).toEqual(["paint", "polish_compound", "exterior"]);
    for (const noise of ["plastic_interior", "plastic_exterior", "tires", "glass", "cleaning"]) {
      expect(products[0].tags).not.toContain(noise);
    }
  });

  test("forceAll=false: keyword inference union preserved", async () => {
    askLLM.mockResolvedValue('["paint","polish_compound","exterior"]');
    const products = [{ ...POLISH_PLASTIC_FIXTURE, tags: [] }];

    await runTaggingPipeline(products, {
      forceAll: false,
      persistPath: null,
      diffLogPath
    });

    expect(products[0].tags).toEqual(
      expect.arrayContaining(["paint", "polish_compound", "exterior"])
    );
    const keywordOnly = inferDeterministicTags(POLISH_PLASTIC_FIXTURE);
    expect(keywordOnly.some((tag) => products[0].tags.includes(tag))).toBe(true);
  });

  test("forceAll=true: empty LLM output stays empty (no keyword fallback)", async () => {
    askLLM.mockResolvedValue("[]");
    const products = [{ ...POLISH_PLASTIC_FIXTURE }];

    await runTaggingPipeline(products, {
      forceAll: true,
      persistPath: null,
      diffLogPath
    });

    expect(products[0].tags).toEqual([]);
  });

  test("Plast X regression: forceAll strips tires/glass/cleaning; non-forceAll keeps keyword tags", async () => {
    const llmTags = [
      "exterior",
      "plastic_exterior",
      "restoration",
      "polish_compound",
      "coating_caution"
    ];
    askLLM.mockResolvedValue(JSON.stringify(llmTags));

    const forceProducts = [{ ...PLAST_X_FIXTURE }];
    await runTaggingPipeline(forceProducts, {
      forceAll: true,
      persistPath: null,
      diffLogPath: path.join(tmpDir, "plast-force.jsonl")
    });

    for (const noise of ["tires", "plastic_interior", "glass", "cleaning"]) {
      expect(forceProducts[0].tags).not.toContain(noise);
    }
    expect(forceProducts[0].tags).toEqual(expect.arrayContaining(llmTags));

    askLLM.mockResolvedValue(JSON.stringify(llmTags));
    const mergeProducts = [{ ...PLAST_X_FIXTURE }];
    await runTaggingPipeline(mergeProducts, {
      forceAll: false,
      persistPath: null,
      diffLogPath: path.join(tmpDir, "plast-merge.jsonl")
    });

    const keywordHits = ["tires", "plastic_interior", "glass", "cleaning"].filter((tag) =>
      mergeProducts[0].tags.includes(tag)
    );
    expect(keywordHits.length).toBeGreaterThan(0);
  });
});
