const { __test: t } = require("../services/chatService");

describe("Clarification UX Consistency (P1)", () => {
  it("generates slot-pure clarification prompts for context/object/surface", () => {
    const contextQ = t.getClarificationQuestion("context", { object: "caroserie" }, "ro");
    expect(contextQ.toLowerCase()).toContain("interior");
    expect(contextQ.toLowerCase()).toContain("exterior");
    expect(contextQ.toLowerCase()).not.toContain("scaune");

    const objectQ = t.getClarificationQuestion("object", { context: "interior" }, "ro");
    expect(objectQ.toLowerCase()).toMatch(/interiorului|interior/);
    expect(objectQ.toLowerCase()).toMatch(/scaune|bord|plafon/);
    expect(objectQ.toLowerCase()).not.toContain("interior sau exterior");

    const surfaceQ = t.getClarificationQuestion("surface", { context: "exterior", object: "caroserie" }, "ro");
    expect(surfaceQ.toLowerCase()).toContain("suprafata");
    expect(surfaceQ.toLowerCase()).toContain("vopsea");
    expect(surfaceQ.toLowerCase()).not.toContain("ce vrei sa cureti mai exact");
  });
});
