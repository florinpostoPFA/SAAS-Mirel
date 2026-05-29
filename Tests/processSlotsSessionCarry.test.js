"use strict";

const { processSlots, mergeSlots } = require("../services/chatService").__test;

describe("processSlots session carry (F6 patch B)", () => {
  it("carries session action on declarative product follow-up when incoming omits action", () => {
    const sessionContext = {
      slots: {
        context: "exterior",
        surface: "paint",
        object: "caroserie",
        action: "protect"
      }
    };
    const result = processSlots(
      "Recomanda un produs bun pentru protejarea vopselei",
      "selection",
      sessionContext,
      { mergeWithSession: false }
    );
    expect(result.slots.action).toBe("protect");
    expect(result.slots.context).toBe("exterior");
    expect(result.slots.surface).toBe("paint");
    expect(result.slots.object).toBe("caroserie");
  });

  it("mergeSlots sessionFallback still preserves action when prev empty", () => {
    const merged = mergeSlots(
      {},
      { context: "exterior", surface: "paint", object: "caroserie" },
      { sessionSlots: { action: "protect" } }
    );
    expect(merged.action).toBe("protect");
  });
});
