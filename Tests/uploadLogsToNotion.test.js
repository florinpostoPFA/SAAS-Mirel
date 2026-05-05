const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseJsonlFile,
  buildLogSummary,
  runUpload
} = require("../scripts/uploadLogsToNotion");

describe("uploadLogsToNotion", () => {
  test("computes summary from fixture JSONL", () => {
    const rows = [
      { decision: { action: "clarification" }, output: { productsReason: "none" } },
      { decision: { action: "knowledge" }, output: { productsReason: "no_matching_products" }, analysis: { failureType: "no_products" } },
      { decision: { action: "knowledge" }, output: { productsReason: "no_matching_products" }, analysis: { failureType: "no_products" } }
    ];
    const summary = buildLogSummary(rows, "logs/fixture.jsonl");
    expect(summary.totalRows).toBe(3);
    expect(summary.actionCounts.knowledge).toBe(2);
    expect(summary.noMatchingProducts).toBe(2);
    expect(summary.topFailures[0]).toEqual({ name: "no_products", count: 2 });
  });

  test("redacts and truncates previews", () => {
    const row = {
      traceId: "t-1",
      message:
        "please contact me on john.doe@example.com and +40 722 123 456 for details ".repeat(3)
    };
    const summary = buildLogSummary([row], "logs/fixture.jsonl");
    const preview = summary.previews[0].messagePreview;
    expect(preview).toContain("[REDACTED_EMAIL]");
    expect(preview).toContain("[REDACTED_PHONE]");
    expect(preview.length).toBeLessThanOrEqual(120);
  });

  test("mocks notion upload call and asserts payload title", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "upload-logs-"));
    const filePath = path.join(tmpDir, "2026-05-05.jsonl");
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ traceId: "t-1", decision: { action: "knowledge" } })}\n`,
      "utf8"
    );

    const notionPost = jest.fn().mockResolvedValue({
      data: { url: "https://notion.so/fake-page" }
    });

    const result = await runUpload({
      file: filePath,
      apiKey: "key",
      databaseId: "db",
      notionPost
    });

    expect(result.notionUrl).toBe("https://notion.so/fake-page");
    expect(notionPost).toHaveBeenCalledTimes(1);
    const payload = notionPost.mock.calls[0][1];
    expect(payload.properties.Name.title[0].text.content).toContain("Log upload");
  });

  test("parseJsonlFile reads valid rows and skips invalid lines", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parse-jsonl-"));
    const filePath = path.join(tmpDir, "fixture.jsonl");
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ a: 1 })}\ninvalid-json\n${JSON.stringify({ b: 2 })}\n`,
      "utf8"
    );
    const rows = parseJsonlFile(filePath);
    expect(rows).toHaveLength(2);
    expect(rows[0].a).toBe(1);
    expect(rows[1].b).toBe(2);
  });
});
