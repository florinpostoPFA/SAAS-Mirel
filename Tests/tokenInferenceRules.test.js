"use strict";

const {
  inferSlotsFromMessage,
  applyTokenInferenceToSessionSlots,
  pickWorkflowAction
} = require("../services/slotInferenceFromMessage");

describe("token inference rules (F35)", () => {
  it("scaun_alone_does_not_infer_surface", () => {
    const result = inferSlotsFromMessage({
      message: "vreau sa curat scaunul",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.surface).toBeUndefined();
    expect(result.slotUpdates.context).toBe("interior");
    expect(result.matches.some((m) => m.slotKey === "surface" && m.slotValue === "textile")).toBe(
      false
    );
  });

  it("scaun_de_piele_murdar_infers_surface_piele_action_clean_normal_intensity", () => {
    const result = inferSlotsFromMessage({
      message: "scaun de piele murdar",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.surface).toBe("piele");
    expect(result.slotUpdates.action).toBe("clean");
    expect(result.actionIntensity).toBe("normal");
  });

  it("scaun_textil_murdar_infers_surface_textile_action_clean_normal_intensity", () => {
    const result = inferSlotsFromMessage({
      message: "scaun textil murdar",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.surface).toBe("textile");
    expect(result.slotUpdates.action).toBe("clean");
    expect(result.actionIntensity).toBe("normal");
  });

  it("scaun_de_piele_murdara_grea_infers_intensity_deep", () => {
    const result = inferSlotsFromMessage({
      message: "scaun de piele murdara grea",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.surface).toBe("piele");
    expect(result.slotUpdates.action).toBe("clean");
    expect(result.actionIntensity).toBe("deep");
  });

  it("protejez_scaunul_de_piele_infers_action_protect", () => {
    const result = inferSlotsFromMessage({
      message: "vreau sa protejez scaunul de piele",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.action).toBe("protect");
    expect(result.actionIntensity).toBeNull();
  });

  it("polish_token_infers_action_polish", () => {
    const result = inferSlotsFromMessage({
      message: "dam cu polish pe caroserie",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.action).toBe("polish");
  });

  it("intent_tags_cleaning_promotes_slot_action_clean_when_no_token_match", () => {
    const sessionContext = {
      slots: { context: "interior", object: "cotiera" },
      slotMeta: { context: "inferred", surface: "unknown", object: "unknown" },
      tags: ["interior", "cleaning"]
    };
    const interactionRef = {};

    applyTokenInferenceToSessionSlots({
      message: "ce recomanzi?",
      sessionContext,
      interactionRef
    });

    expect(sessionContext.slots.action).toBe("clean");
    expect(sessionContext.slots.actionIntensity ?? null).toBeNull();
  });

  it("multi_action_tokens_resolved_via_workflow_order_wins", () => {
    expect(pickWorkflowAction(["protect", "clean"])).toBe("clean");
    expect(pickWorkflowAction(["dress", "protect"])).toBe("protect");
    expect(pickWorkflowAction(["polish", "clean"])).toBe("clean");
    expect(pickWorkflowAction(["decontaminate", "clean"])).toBe("decontaminate");

    const result = inferSlotsFromMessage({
      message: "vreau sa curat si sa protejez scaunul de piele",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.action).toBe("clean");
    expect(result.actionIntensity).toBeNull();
  });

  it("cotiera_alone_does_not_force_textile_without_textile_marker", () => {
    const result = inferSlotsFromMessage({
      message: "am cotiera foarte murdara",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.surface).toBeUndefined();
    expect(result.slotUpdates.context).toBe("interior");
    expect(result.slotUpdates.action).toBe("clean");
    expect(result.actionIntensity).toBe("normal");
  });

  it("bancheta_alone_does_not_force_textile_without_textile_marker", () => {
    const result = inferSlotsFromMessage({
      message: "bancheta murdara",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.surface).toBeUndefined();
    expect(result.slotUpdates.context).toBe("interior");
  });

  it("plansa_without_bord_context_does_not_force_plastic_surface", () => {
    const result = inferSlotsFromMessage({
      message: "plansa murdara",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.surface).toBeUndefined();
  });

  it("sigilat_token_maps_to_action_protect", () => {
    const result = inferSlotsFromMessage({
      message: "scaunul este deja sigilat",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.action).toBe("protect");
  });

  it("sigilez_token_maps_to_action_protect", () => {
    const result = inferSlotsFromMessage({
      message: "vreau sa sigilez pielea",
      currentSlots: {},
      slotMeta: {}
    });
    expect(result.slotUpdates.action).toBe("protect");
  });
});
