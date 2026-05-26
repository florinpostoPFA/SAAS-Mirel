const {
  inferContext,
  detectExplicitContext
} = require("../services/contextInferenceService");
const { extractSlotsFromMessage } = require("../services/chatService");
const { applyUserCorrection } = require("../services/slotCorrectionService");

describe("contextInferenceService", () => {
  it("A: ambiguous leather-only message yields no strong context", () => {
    const r = inferContext({
      message: "vreau ceva pt piele",
      slots: { object: null, surface: "piele" }
    });
    expect(r.inferredContext).toBeNull();
    expect(r.confidence).toBe("weak");
  });

  it("B: cabin object yields interior", () => {
    const r = inferContext({ message: "curat bordul", slots: {} });
    expect(r.inferredContext).toBe("interior");
    expect(r.confidence).toBe("strong");
    expect(r.reason).toBe("cabin_object");
  });

  it("C: insect on windshield yields exterior", () => {
    const r = inferContext({
      message: "insecte pe parbriz",
      slots: { object: "glass" }
    });
    expect(r.inferredContext).toBe("exterior");
    expect(r.confidence).toBe("strong");
  });

  it("detectExplicitContext: cabina and pe afara", () => {
    expect(detectExplicitContext("e pentru cabina")).toBe("interior");
    expect(detectExplicitContext("e pe afara")).toBe("exterior");
  });

  it("confirmed slotMeta blocks reinference", () => {
    const r = inferContext({
      message: "jante",
      slots: { object: "jante" },
      slotMeta: { context: "confirmed" },
      pendingQuestion: null
    });
    expect(r.inferredContext).toBeNull();
    expect(r.reason).toBe("context_confirmed_no_reinfer");
  });

  it("confirmed slotMeta allows inference when answering context pending", () => {
    const r = inferContext({
      message: "exterior",
      slots: {},
      slotMeta: { context: "confirmed" },
      pendingQuestion: { slot: "context" }
    });
    expect(r.inferredContext).toBe("exterior");
  });
});

describe("extractSlotsFromMessage + context", () => {
  it("A: leather phrase does not set exterior", () => {
    const s = extractSlotsFromMessage("vreau ceva pt piele");
    expect(s.context).toBeFalsy();
    expect(s.surface).toBe("piele");
  });

  it("B: bord sets interior via strong bundle", () => {
    const s = extractSlotsFromMessage("curat bordul");
    expect(s.context).toBe("interior");
  });
});

describe("coating/wax/sealant → exterior context inference", () => {
  it("ceramic coating message infers exterior", () => {
    const r = inferContext({ message: "vreau un coating ceramic", slots: {} });
    expect(r.inferredContext).toBe("exterior");
    expect(r.confidence).toBe("strong");
    expect(r.reason).toBe("coating_wax_polish_cues");
  });

  it("wax (ceara) message infers exterior", () => {
    const r = inferContext({ message: "ce ceara recomanzi", slots: {} });
    expect(r.inferredContext).toBe("exterior");
    expect(r.confidence).toBe("strong");
    expect(r.reason).toBe("coating_wax_polish_cues");
  });

  it("polish alone does NOT infer exterior (ambiguous)", () => {
    const r = inferContext({ message: "am nevoie de polish", slots: {} });
    expect(r.inferredContext).toBeNull();
    expect(r.confidence).toBe("weak");
  });

  it("sealant message infers exterior", () => {
    const r = inferContext({ message: "sigilant pentru masina", slots: {} });
    expect(r.inferredContext).toBe("exterior");
    expect(r.confidence).toBe("strong");
    expect(r.reason).toBe("coating_wax_polish_cues");
  });

  it("explicit interior overrides coating cue", () => {
    const r = inferContext({ message: "protectie ceramica interior", slots: {} });
    expect(r.inferredContext).toBe("interior");
    expect(r.reason).toBe("explicit_context");
  });
});

describe("D: user correction nu interior overrides exterior", () => {
  it("applyUserCorrection flips context deterministically", () => {
    const r = applyUserCorrection({
      prevSlots: { context: "exterior", surface: null, object: null },
      newExtraction: { context: null, surface: null, object: null },
      pendingQuestion: null,
      message: "nu, interior",
      slotMeta: { context: "inferred", surface: "unknown", object: "unknown" }
    });
    expect(r.nextSlots.context).toBe("interior");
    expect(r.slotMeta.context).toBe("confirmed");
  });
});

