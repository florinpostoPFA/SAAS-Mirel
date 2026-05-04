"use strict";

const { evaluateTop25Expectation, evaluateSessionSlots } = require("../tests/regression/top25Evaluator");

describe("top25Evaluator rubric helper", () => {
  it("actionAnyOf passes when action matches", () => {
    const r = evaluateTop25Expectation(
      { decision: { action: "safety", flowId: null, missingSlot: null } },
      { actionAnyOf: ["safety", "knowledge"] }
    );
    expect(r.pass).toBe(true);
  });

  it("forbidActionAnyOf fails when action is forbidden", () => {
    const r = evaluateTop25Expectation(
      { decision: { action: "safety", flowId: null, missingSlot: null } },
      { forbidActionAnyOf: ["safety"] }
    );
    expect(r.pass).toBe(false);
  });

  it("sessionSlots objectNot fails when object matches", () => {
    const r = evaluateSessionSlots(
      { slots: { object: "cotiera", context: "interior" } },
      { objectNot: "cotiera" }
    );
    expect(r.pass).toBe(false);
  });
});
