"use strict";

const { applyDeterministicSessionResetInPlace } = require("../services/chatService").__test;

describe("deterministic_reset interrogative follow-up (F5)", () => {
  function sessionWithProtectSlots() {
    return {
      slots: {
        context: "exterior",
        surface: "paint",
        object: "caroserie",
        action: "protect"
      },
      pendingQuestion: null,
      pendingContexts: [],
      state: "IDLE",
      slotMeta: { context: "inferred", surface: "inferred", object: "inferred" },
      lastHighLevelIntent: "product_search"
    };
  }

  it.each([
    ["de ce?", "de ce?"],
    ["cum asa?", "cum asa?"],
    ["de ce e important?", "de ce e important?"]
  ])("skips wipe for interrogative follow-up: %s", (_label, message) => {
    const sessionContext = sessionWithProtectSlots();
    const applied = applyDeterministicSessionResetInPlace(
      sessionContext,
      "sess-f5",
      "reset.high_level_intent_shift",
      message
    );
    expect(applied).toBe(false);
    expect(sessionContext.slots.action).toBe("protect");
    expect(sessionContext.slots.context).toBe("exterior");
    expect(sessionContext.slots.object).toBe("caroserie");
    expect(sessionContext.lastHighLevelIntent).toBe("product_search");
  });

  it("still resets on cold start with de ce and empty session", () => {
    const sessionContext = {
      slots: {},
      state: "IDLE",
      slotMeta: {},
      lastHighLevelIntent: "knowledge"
    };
    const applied = applyDeterministicSessionResetInPlace(
      sessionContext,
      "sess-f5-cold",
      "reset.new_root_query",
      "de ce"
    );
    expect(applied).toBe(true);
    expect(sessionContext.slots).toEqual({});
    expect(sessionContext.lastHighLevelIntent).toBeNull();
  });
});
