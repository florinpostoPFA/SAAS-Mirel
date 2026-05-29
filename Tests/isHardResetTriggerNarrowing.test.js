const { __test } = require("../services/chatService");

const { isHardReset } = __test;

describe("isHardReset trigger narrowing (F4 patch 1)", () => {
  const shouldNotTrigger = [
    "Vreau sa protejez vopseaua",
    "vreau sa curat scaunele",
    "cum curat",
    "cum curat scaunele?",
    "Detergent pentru scaune textile interior",
    "Recomanda detergent pentru scaune textile",
    "Protejeaza vopseaua exterioara",
    "exterior masina mea are zgarieturi",
    "interior si exterior"
  ];

  const shouldTrigger = [
    "cum spal masina",
    "cum fac sa curat",
    "interior masina",
    "trec la exterior",
    "schimb la interior",
    "exterior",
    "interior"
  ];

  it.each(shouldNotTrigger)("does not hard-reset: %s", (phrase) => {
    expect(isHardReset(phrase)).toBe(false);
  });

  it.each(shouldTrigger)("still hard-resets: %s", (phrase) => {
    expect(isHardReset(phrase)).toBe(true);
  });
});
