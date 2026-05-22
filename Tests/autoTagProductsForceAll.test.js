const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

const { askLLM } = require("../services/llm");
const {
  parseCliArgs,
  runTaggingPipeline,
  mergeDeterministicTags
} = require("../scripts/autoTagProducts");

describe("autoTagProducts --force-all", () => {
  let tmpDir;
  let diffLogPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "retag-test-"));
    diffLogPath = path.join(tmpDir, "retag-test.jsonl");
    askLLM.mockReset();
    askLLM.mockResolvedValue(
      '["exterior","tires","tire_dressing","protection","wet_look"]'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parseCliArgs detects --force-all", () => {
    expect(parseCliArgs(["node", "script.js", "--force-all"]).forceAll).toBe(true);
    expect(parseCliArgs(["node", "script.js"]).forceAll).toBe(false);
  });

  it("without --force-all, skip-if-tagged merges deterministic tags only", async () => {
    const products = [
      {
        id: "A",
        name: "Dressing pentru anvelope",
        tags: ["legacy_unknown", "cleaning"]
      },
      { id: "B", name: "Untagged product", tags: [] },
      { id: "C", name: "Already tagged interior", tags: ["interior", "apc"] }
    ];

    let llmCalls = 0;
    await runTaggingPipeline(products, {
      forceAll: false,
      persistPath: null,
      diffLogPath,
      llmFn: async () => {
        llmCalls += 1;
        return {
          tags: ["exterior", "wheel_cleaner"],
          llmRawResponse: '["exterior","wheel_cleaner"]',
          droppedUnknownTags: []
        };
      }
    });

    expect(llmCalls).toBe(1);
    expect(products[0].tags).not.toContain("legacy_unknown");
    expect(products[0].tags).toContain("tires");
    expect(products[1].tags).toEqual(expect.arrayContaining(["exterior", "wheel_cleaner"]));
    expect(products[2].tags).toEqual(["interior", "apc"]);
  });

  it("with --force-all, clears tags and re-tags every product", async () => {
    const products = [
      { id: "1", name: "Tire foam", tags: ["cleaning"], aiTags: ["old"] },
      { id: "2", name: "Wheel cleaner jante", tags: ["wheels"] },
      { id: "3", name: "Interior APC", tags: ["interior", "apc"] }
    ];

    await runTaggingPipeline(products, {
      forceAll: true,
      persistPath: null,
      diffLogPath
    });

    expect(askLLM).toHaveBeenCalledTimes(3);
    for (const product of products) {
      expect(product.tags.length).toBeGreaterThan(0);
      expect(product.tags).toEqual(
        expect.arrayContaining(["exterior", "tires", "tire_dressing"])
      );
      if (product.id === "1") {
        expect(product.aiTags).toEqual([]);
      }
    }

    const lines = fs.readFileSync(diffLogPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({
      id: "1",
      tagsBefore: ["cleaning"],
      droppedUnknownTags: expect.any(Array),
      durationMs: expect.any(Number)
    });
    expect(first.llmRawResponse).toContain("tire_dressing");
  });

  it("mergeDeterministicTags reports dropped unknown tags from existing rows", () => {
    const { tags, droppedUnknownTags } = mergeDeterministicTags({
      name: "Cleaner Jante Pro",
      tags: ["wheels", "mat", "dressing"]
    });
    expect(tags).toContain("wheels");
    expect(droppedUnknownTags).toEqual(expect.arrayContaining(["mat", "dressing"]));
  });
});
