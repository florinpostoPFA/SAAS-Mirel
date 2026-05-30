"use strict";

const { __test } = require("../services/chatService");
const {
  buildSmartNoProductFallbackMessage,
  buildSmartValidatorClarificationMessage,
  extractUserNounFromMessage
} = __test;

describe("F12 — smart fallback templates", () => {
  it("extracts longest content noun from message", () => {
    expect(extractUserNounFromMessage("cum curat farurile?")).toBe("farurile");
  });

  it("zero-product fallback echoes noun and slots", () => {
    const msg = buildSmartNoProductFallbackMessage("cum curat farurile?", {
      context: "exterior",
      surface: "glass"
    });
    expect(msg).toMatch(/farurile/i);
    expect(msg).toMatch(/exterior.*glass/i);
    expect(msg).toMatch(/nu am gasit produs potrivit/i);
  });

  it("validator fallback uses smart template when noun present", () => {
    const msg = buildSmartValidatorClarificationMessage(
      "cum curat farurile?",
      { context: "exterior", surface: "glass", object: "caroserie" },
      "Caroseria are suprafata de vopsea. Vrei sa continui cu tratamentul ei?"
    );
    expect(msg).not.toMatch(/Caroseria are suprafata de vopsea/i);
    expect(msg).toMatch(/farurile/i);
  });

  it("falls back to default validator question without noun", () => {
    const defaultQ = "Caroseria are suprafata de vopsea. Vrei sa continui cu tratamentul ei?";
    expect(buildSmartValidatorClarificationMessage("da", {}, defaultQ)).toBe(defaultQ);
  });
});
