const { analyzeFeedbackLinking } = require("../scripts/feedback-analysis");

describe("feedback-analysis linking", () => {
  test("joins feedback and interactions by traceId", () => {
    const interactions = [
      {
        traceId: "t-1",
        decision: { action: "knowledge", missingSlot: null },
        output: { productsLength: 1 },
        message: "Salut"
      }
    ];
    const feedback = [
      { traceId: "t-1", rating: "up" },
      { traceId: "t-2", rating: "down" }
    ];
    const summary = analyzeFeedbackLinking(interactions, feedback);
    expect(summary.totalFeedback).toBe(2);
    expect(summary.linked).toBe(1);
    expect(summary.linkedPct).toBe(50);
  });

  test("aggregates counts by rating deterministically", () => {
    const summary = analyzeFeedbackLinking(
      [{ traceId: "t-1", decision: { action: "clarification" }, output: { productsLength: 0 } }],
      [
        { traceId: "t-1", rating: "down" },
        { traceId: "missing", rating: "down" },
        { traceId: "t-1", rating: "up" }
      ]
    );
    expect(summary.byRating).toEqual({ down: 2, up: 1 });
    expect(summary.topDownTraces).toHaveLength(2);
  });

  test("redacts/truncates message preview in output", () => {
    const interactions = [
      {
        traceId: "t-1",
        message:
          "My email john.doe@example.com and phone +40 722 123 456 should never leak in full.".repeat(2),
        decision: { action: "knowledge", missingSlot: "surface" },
        output: { productsLength: 0 }
      }
    ];
    const feedback = [{ traceId: "t-1", rating: "down" }];
    const summary = analyzeFeedbackLinking(interactions, feedback);
    const preview = summary.topDownTraces[0].messagePreview;
    expect(preview).toContain("[REDACTED_EMAIL]");
    expect(preview).toContain("[REDACTED_PHONE]");
    expect(preview.length).toBeLessThanOrEqual(120);
  });
});
