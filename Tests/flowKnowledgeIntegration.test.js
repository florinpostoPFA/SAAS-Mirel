const config = require("../config");
const { executeFlow } = require("../services/flowExecutor");
const knowledgeFlow = require("../data/knowledge_flow.json");

const NEW_FLOW_IDS = [
  "decontamination_basics",
  "protection_prep_basic",
  "interior_quick_maintenance",
  "textile_cleaning_basic",
  "leather_program_basic",
  "engine_bay_safety_basic",
  "spot_correction_escalation",
  "leather_ink_removal"
];

function collectMissingKnowledgeIds(flow, knownIds) {
  const missing = [];
  const steps = Array.isArray(flow?.steps) ? flow.steps : [];
  for (const step of steps) {
    const ids = Array.isArray(step?.knowledgeIds) ? step.knowledgeIds : [];
    for (const id of ids) {
      if (!knownIds.has(String(id))) {
        missing.push(String(id));
      }
    }
  }
  return missing;
}

describe("Flow knowledge integration", () => {
  it("all new flows reference only existing knowledge_flow IDs", () => {
    const knownIds = new Set((Array.isArray(knowledgeFlow) ? knowledgeFlow : []).map((entry) => String(entry?.id || "")));
    const missingByFlow = {};

    for (const flowId of NEW_FLOW_IDS) {
      const flow = config?.flows?.[flowId];
      expect(flow).toBeTruthy();
      const missing = collectMissingKnowledgeIds(flow, knownIds);
      if (missing.length > 0) {
        missingByFlow[flowId] = Array.from(new Set(missing)).sort();
      }
    }

    const report = Object.entries(missingByFlow)
      .map(([flowId, ids]) => `${flowId}: ${ids.join(", ")}`)
      .join("\n");

    expect(report).toBe("");
  });

  it("executes decontamination_basics with real flowExecutor and returns a reply", () => {
    const flow = config?.flows?.decontamination_basics;
    expect(flow).toBeTruthy();

    const result = executeFlow(
      flow,
      [],
      { context: "exterior", surface: "paint", object: "caroserie" },
      { responseLocale: "ro" }
    );

    expect(result).toBeTruthy();
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.reply).toContain("Decontaminare de baza");
    expect(result.reply).toContain("Pasul 1: Decontaminare chimica");
  });

  it("executes leather_ink_removal with real flowExecutor and includes safety copy", () => {
    const flow = config?.flows?.leather_ink_removal;
    expect(flow).toBeTruthy();

    const result = executeFlow(
      flow,
      [],
      { context: "interior", surface: "leather", object: "scaun" },
      { responseLocale: "ro" }
    );

    expect(result).toBeTruthy();
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
    const reply = result.reply.toLowerCase();
    expect(
      reply.includes("test") ||
        reply.includes("zona ascunsa") ||
        reply.includes("zonă ascunsă")
    ).toBe(true);
    expect(
      reply.includes("acetona") ||
        reply.includes("acetonă") ||
        reply.includes("acetone")
    ).toBe(true);
  });
});
