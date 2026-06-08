"use strict";

const {
  deriveResponsePath,
  buildAssemblySnapshotMeta,
  countFromFlowDefinition
} = require("../services/assemblySnapshot");

describe("F45 assembly snapshot", () => {
  it("clarification turns map to responsePath clarification", () => {
    expect(
      deriveResponsePath({
        decision: { action: "clarification", flowId: null },
        finalOutputType: "question"
      })
    ).toBe("clarification");
  });

  it("handoff reasonCode maps to handoff", () => {
    expect(
      deriveResponsePath({
        decision: { action: "knowledge", reasonCode: "routing.handoff.operator" },
        finalOutputType: "reply"
      })
    ).toBe("handoff");
  });

  it("buildAssemblySnapshotMeta includes counts from flow definition", () => {
    const flowDef = {
      flowId: "textile_cleaning_basic",
      steps: [
        { id: "clean", knowledgeIds: ["textile_cleaning"], roles: ["interior_brush"] },
        { id: "dry", knowledgeIds: ["microfiber_usage"], roles: ["microfiber_towel"] }
      ]
    };
    const counts = countFromFlowDefinition(flowDef);
    expect(counts.knowledgeCount).toBeGreaterThanOrEqual(2);
    expect(counts.toolCount).toBeGreaterThanOrEqual(2);

    const meta = buildAssemblySnapshotMeta({
      interactionRef: { assemblyTelemetry: { flowDef, ...counts } },
      decision: { action: "flow", flowId: "textile_cleaning_basic" },
      finalOutputType: "flow",
      finalProducts: [{ id: "p1" }, { id: "p2" }]
    });
    expect(meta.responsePath).toBe("flow");
    expect(meta.productsCount).toBe(2);
    expect(meta.knowledgeCount).toBeGreaterThanOrEqual(2);
  });
});
