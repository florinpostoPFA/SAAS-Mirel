/**
 * @jest-environment node
 */

const {
  analyzeWheelTireMessage,
  maybeWheelTireCombinedWorkflowReply,
  maybeWheelTireAmbiguousProductClarification
} = require("../services/wheelTireSemantics");
const { extractSlotsFromMessage } = require("../services/chatService");

describe("wheelTireSemantics analyzer", () => {
  test("luciu / dressing anvelope → tire_dressing, object anvelope", () => {
    for (const msg of [
      "Vreau luciu anvelope",
      "dressing anvelope",
      "tire shine recomandare",
      "tire gel pentru anvelope",
      "tyre gel",
      "ce dau pe cauciucuri sa fie negre",
      "tire blackener"
    ]) {
      const a = analyzeWheelTireMessage(msg);
      expect(a.wheelTireIntent).toBe("tire_dressing");
      expect(a.objectSlot).toBe("anvelope");
    }
  });

  test("curățare jante / wheel cleaner → wheel_cleaning, object jante", () => {
    for (const msg of [
      "Cu ce curăț jantele?",
      "Cu ce curat jantele?",
      "wheel cleaner pentru jante",
      "degresant jante si iron remover"
    ]) {
      const a = analyzeWheelTireMessage(msg);
      expect(a.wheelTireIntent).toBe("wheel_cleaning");
      expect(a.objectSlot).toBe("jante");
    }
  });

  test("mixed sequence → combined workflow reply (no clarification)", () => {
    const msg = "Curăț jantele și apoi dau cu dressing pe anvelope";
    const a = analyzeWheelTireMessage(msg);
    expect(a.bothTargetsMentioned).toBe(true);
    expect(a.mixedCleanAndDress).toBe(true);
    const reply = maybeWheelTireCombinedWorkflowReply(msg, "ro");
    expect(reply).toBeTruthy();
    expect(reply).toContain("Curăță jantele");
    expect(reply).toContain("dressing");
    expect(maybeWheelTireAmbiguousProductClarification(msg)).toBeNull();
  });

  test("ambiguous product request (both targets, no sequence) → clarification", () => {
    const msg = "Vreau ceva pentru jante și anvelope";
    expect(maybeWheelTireAmbiguousProductClarification(msg)).toMatch(/jantelor|anvelope/);
  });

  test("generic roti query clarifies tires vs rims", () => {
    const msg = "solutie roti";
    expect(maybeWheelTireAmbiguousProductClarification(msg)).toMatch(/jantelor|anvelope/);
    const a = analyzeWheelTireMessage(msg);
    expect(a.ambiguousWheelTarget).toBe(true);
  });
});

describe("extractSlotsFromMessage + wheel/tire disambiguation", () => {
  test("dressing context sets object anvelope, not jante", () => {
    const slots = extractSlotsFromMessage("Vreau dressing pentru anvelope la exterior");
    expect(slots.object).toBe("anvelope");
  });

  test("jante cleaning keeps object jante", () => {
    const slots = extractSlotsFromMessage("cum curat jantele murdare");
    expect(slots.object).toBe("jante");
  });
});
