const { __test } = require("../services/chatService");

const { mergeSlots } = __test;

describe("mergeSlots action preservation (F4 patch 2)", () => {
  const cases = [
    {
      name: "incoming action on empty prev",
      prev: {},
      next: { action: "protect" },
      sessionSlots: null,
      expected: "protect"
    },
    {
      name: "prev action when incoming omits action",
      prev: { action: "clean" },
      next: { context: "interior" },
      sessionSlots: null,
      expected: "clean"
    },
    {
      name: "session fallback when prev and incoming omit action",
      prev: {},
      next: { context: "exterior", surface: "paint" },
      sessionSlots: { action: "protect" },
      expected: "protect"
    },
    {
      name: "incoming overrides prev action",
      prev: { action: "clean" },
      next: { action: "protect" },
      sessionSlots: null,
      expected: "protect"
    },
    {
      name: "both empty",
      prev: {},
      next: {},
      sessionSlots: null,
      expected: null
    }
  ];

  it.each(cases)("$name", ({ prev, next, sessionSlots, expected }) => {
    const merged = mergeSlots(prev, next, sessionSlots ? { sessionSlots } : {});
    expect(merged.action).toBe(expected);
  });
});
