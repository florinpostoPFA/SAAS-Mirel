const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseJsonlFile,
  computeEventId,
  buildRawJsonText,
  buildEventTitle,
  buildPageProperties,
  buildPagePayload,
  helpfulValue,
  ingestDailyLogs,
  yesterdayUtc,
  RAW_JSON_MAX,
  TRUNC_SUFFIX,
  RICH_TEXT_CHUNK
} = require("../scripts/ingestDailyLogsToNotion");

const FIXTURE_ROW = {
  timestamp: "2026-05-06T07:53:35.511Z",
  traceId: "636958db-eda8-43fb-960b-6b15c5bec6b6",
  sessionId: "session-abc",
  message: "Ce recomanzi pentru scaune?",
  normalizedMessage: "ce recomanzi pentru scaune?",
  intent: { queryType: "selection", type: "product_search" },
  slots: { context: "interior", object: "scaun", surface: null },
  decision: {
    action: "clarification",
    flowId: null,
    missingSlot: "surface",
    reasonCode: "routing.clarification.slot"
  },
  feedback: { helpful: null, reason: null },
  analysis: { failureType: null, missingSlot: null },
  host: "freeswitch-lab",
  schemaVersion: 2
};

function getRichText(prop) {
  return (prop?.rich_text || []).map((c) => c?.text?.content || "").join("");
}

function getSelect(prop) {
  return prop?.select?.name || null;
}

describe("ingestDailyLogsToNotion: mapping", () => {
  test("buildPageProperties produces expected Notion property shape", () => {
    const props = buildPageProperties({
      row: FIXTURE_ROW,
      date: "2026-05-06",
      eventId: "deadbeef",
      ingestedAtIso: "2026-05-07T00:05:00.000Z"
    });

    expect(props.Event.title[0].text.content).toBe(
      "2026-05-06 INFO clarification 636958db"
    );

    expect(props.Timestamp.date.start).toBe("2026-05-06T07:53:35.511Z");
    expect(props["Ingested at"].date.start).toBe("2026-05-07T00:05:00.000Z");

    expect(getSelect(props["Decision action"])).toBe("clarification");
    expect(getSelect(props["Slot: context"])).toBe("interior");
    expect(getSelect(props["Intent queryType"])).toBe("selection");
    expect(getSelect(props["Feedback helpful"])).toBe("none");

    expect(getRichText(props["User message"])).toBe("ce recomanzi pentru scaune?");
    expect(getRichText(props["Slot: object"])).toBe("scaun");
    expect(getRichText(props["Intent type"])).toBe("product_search");
    expect(getRichText(props["Missing slot"])).toBe("surface");
    expect(getRichText(props.Host)).toBe("freeswitch-lab");
    expect(getRichText(props.SessionId)).toBe("session-abc");
    expect(getRichText(props.TraceId)).toBe(FIXTURE_ROW.traceId);
    expect(getRichText(props.EventId)).toBe("deadbeef");

    expect(props["Slot: surface"]).toBeUndefined();
    expect(props.FlowId).toBeUndefined();
    expect(props.Level).toBeUndefined();
    expect(props.Service).toBeUndefined();
    expect(props.Env).toBeUndefined();

    expect(getRichText(props["Raw JSON"])).toBe(JSON.stringify(FIXTURE_ROW));
  });

  test("buildPagePayload wires the database parent", () => {
    const payload = buildPagePayload({
      row: FIXTURE_ROW,
      date: "2026-05-06",
      eventId: "abc",
      databaseId: "5d5ee3e286a643ac91a9a6bc3152d8f4",
      ingestedAtIso: "2026-05-07T00:05:00.000Z"
    });
    expect(payload.parent.database_id).toBe("5d5ee3e286a643ac91a9a6bc3152d8f4");
    expect(payload.properties.Event.title[0].text.content).toContain("2026-05-06");
  });

  test("helpfulValue maps booleans/strings/null to yes|no|none", () => {
    expect(helpfulValue(true)).toBe("yes");
    expect(helpfulValue("yes")).toBe("yes");
    expect(helpfulValue(false)).toBe("no");
    expect(helpfulValue("no")).toBe("no");
    expect(helpfulValue(null)).toBe("none");
    expect(helpfulValue("")).toBe("none");
  });

  test("buildEventTitle falls back to INFO/unknown and trims trace prefix", () => {
    expect(buildEventTitle({ row: {}, date: "2026-05-06" })).toBe(
      "2026-05-06 INFO unknown"
    );
    expect(
      buildEventTitle({
        row: { level: "ERROR", decision: { action: "knowledge" }, traceId: "abcdef0123456789" },
        date: "2026-05-06"
      })
    ).toBe("2026-05-06 ERROR knowledge abcdef01");
  });
});

describe("ingestDailyLogsToNotion: Raw JSON truncation", () => {
  test("does not truncate small payloads", () => {
    const small = { a: 1 };
    const out = buildRawJsonText(small);
    expect(out).toBe(JSON.stringify(small));
    expect(out.endsWith(TRUNC_SUFFIX)).toBe(false);
  });

  test("truncates large payloads at the configured cap and appends marker", () => {
    const big = { blob: "x".repeat(RAW_JSON_MAX * 2) };
    const out = buildRawJsonText(big);
    expect(out.length).toBe(RAW_JSON_MAX);
    expect(out.endsWith(TRUNC_SUFFIX)).toBe(true);
  });

  test("rich_text chunks each segment under the Notion 2000-char limit", () => {
    const big = { blob: "y".repeat(8000) };
    const props = buildPageProperties({
      row: big,
      date: "2026-05-06",
      eventId: "id",
      ingestedAtIso: null
    });
    const segments = props["Raw JSON"].rich_text;
    expect(segments.length).toBeGreaterThan(1);
    for (const seg of segments) {
      expect(seg.text.content.length).toBeLessThanOrEqual(RICH_TEXT_CHUNK);
    }
  });
});

describe("ingestDailyLogsToNotion: parseJsonlFile", () => {
  test("counts invalid lines instead of silently dropping them", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-jsonl-"));
    const filePath = path.join(tmpDir, "fixture.jsonl");
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ a: 1 })}\nnot-json\n${JSON.stringify({ b: 2 })}\n{oops\n`,
      "utf8"
    );
    const parsed = parseJsonlFile(filePath);
    expect(parsed.totalLines).toBe(4);
    expect(parsed.valid).toHaveLength(2);
    expect(parsed.invalid).toHaveLength(2);
    expect(parsed.invalid[0].index).toBe(1);
  });
});

describe("ingestDailyLogsToNotion: deterministic eventId", () => {
  test("same row + index produces same id; different index produces different id", () => {
    const id1 = computeEventId(FIXTURE_ROW, 0);
    const id2 = computeEventId(FIXTURE_ROW, 0);
    const id3 = computeEventId(FIXTURE_ROW, 1);
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("ingestDailyLogsToNotion: yesterdayUtc", () => {
  test("returns the UTC date 24h before the given timestamp", () => {
    const today = new Date("2026-05-07T03:00:00.000Z").getTime();
    expect(yesterdayUtc(today)).toBe("2026-05-06");
  });
});

function makeNotionMock({ initialIds = [] } = {}) {
  const dbStore = new Map();
  for (const id of initialIds) dbStore.set(id, { id: `pre-${id}` });

  const post = jest.fn(async (url, body) => {
    if (url.endsWith("/pages")) {
      const eventIdSegments = body?.properties?.EventId?.rich_text || [];
      const eventId = eventIdSegments.map((s) => s?.text?.content || "").join("");
      const pageId = `page-${dbStore.size + 1}`;
      dbStore.set(eventId, {
        id: pageId,
        properties: { EventId: { rich_text: eventIdSegments } }
      });
      return { data: { id: pageId, url: `https://notion.so/${pageId}` } };
    }
    if (/\/databases\/.+\/query$/.test(url)) {
      const results = Array.from(dbStore.entries()).map(([eid, page]) => ({
        id: page.id,
        properties: {
          EventId: {
            rich_text: [{ plain_text: eid, text: { content: eid } }]
          }
        }
      }));
      return { data: { results, has_more: false, next_cursor: null } };
    }
    throw new Error(`unexpected url: ${url}`);
  });

  return { post, dbStore };
}

describe("ingestDailyLogsToNotion: end-to-end with mocked Notion", () => {
  function writeJsonl(rows) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-e2e-"));
    const filePath = path.join(tmpDir, "2026-05-06.jsonl");
    fs.writeFileSync(filePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    return filePath;
  }

  test("first run uploads all rows; second run skips them all (idempotent)", async () => {
    const rows = [
      { ...FIXTURE_ROW, traceId: "trace-1" },
      { ...FIXTURE_ROW, traceId: "trace-2", decision: { action: "knowledge" } },
      { ...FIXTURE_ROW, traceId: "trace-3", decision: { action: "recommend" } }
    ];
    const file = writeJsonl(rows);
    const mock = makeNotionMock();

    const first = await ingestDailyLogs({
      file,
      date: "2026-05-06",
      apiKey: "key",
      databaseId: "db",
      notionPost: mock.post,
      concurrency: 2
    });

    expect(first.uploaded).toBe(3);
    expect(first.skipped).toBe(0);
    expect(first.failed).toBe(0);
    expect(first.invalidCount).toBe(0);

    const pageCalls = mock.post.mock.calls.filter((c) => c[0].endsWith("/pages"));
    expect(pageCalls).toHaveLength(3);

    const second = await ingestDailyLogs({
      file,
      date: "2026-05-06",
      apiKey: "key",
      databaseId: "db",
      notionPost: mock.post,
      concurrency: 2
    });

    expect(second.uploaded).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.failed).toBe(0);
    const pageCallsAfter = mock.post.mock.calls.filter((c) => c[0].endsWith("/pages"));
    expect(pageCallsAfter).toHaveLength(3);
  });

  test("counts invalid lines without uploading them, and exits valid lines correctly", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-e2e-"));
    const filePath = path.join(tmpDir, "2026-05-06.jsonl");
    fs.writeFileSync(
      filePath,
      [JSON.stringify({ ...FIXTURE_ROW, traceId: "x1" }), "not-json", JSON.stringify({ ...FIXTURE_ROW, traceId: "x2" })].join(
        "\n"
      ) + "\n",
      "utf8"
    );

    const mock = makeNotionMock();
    const result = await ingestDailyLogs({
      file: filePath,
      date: "2026-05-06",
      apiKey: "key",
      databaseId: "db",
      notionPost: mock.post,
      concurrency: 1
    });

    expect(result.totalLines).toBe(3);
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    expect(result.uploaded).toBe(2);
  });

  test("missing env vars throw a clear error", async () => {
    const file = writeJsonl([FIXTURE_ROW]);
    const savedKey = process.env.NOTION_API_KEY;
    const savedDb = process.env.NOTION_DATABASE_ID;
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_DATABASE_ID;
    try {
      await expect(
        ingestDailyLogs({ file, date: "2026-05-06" })
      ).rejects.toThrow(/NOTION_API_KEY and NOTION_DATABASE_ID/);
    } finally {
      if (savedKey !== undefined) process.env.NOTION_API_KEY = savedKey;
      if (savedDb !== undefined) process.env.NOTION_DATABASE_ID = savedDb;
    }
  });

  test("reports failed pages without aborting the batch", async () => {
    const rows = [
      { ...FIXTURE_ROW, traceId: "ok-1" },
      { ...FIXTURE_ROW, traceId: "boom" },
      { ...FIXTURE_ROW, traceId: "ok-2" }
    ];
    const file = writeJsonl(rows);

    const post = jest.fn(async (url, body) => {
      if (/\/databases\/.+\/query$/.test(url)) {
        return { data: { results: [], has_more: false, next_cursor: null } };
      }
      const seg = body?.properties?.TraceId?.rich_text || [];
      const tid = seg.map((s) => s?.text?.content || "").join("");
      if (tid === "boom") {
        const err = new Error("notion validation");
        err.response = { data: { message: "validation_error: bad property" } };
        throw err;
      }
      return { data: { id: `p-${tid}`, url: `https://notion.so/p-${tid}` } };
    });

    const result = await ingestDailyLogs({
      file,
      date: "2026-05-06",
      apiKey: "k",
      databaseId: "d",
      notionPost: post,
      concurrency: 1
    });

    expect(result.uploaded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/validation_error/);
  });
});
