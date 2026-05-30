"use strict";

const { __test } = require("../services/chatService");
const {
  invalidateStaleObjectFromTags,
  invalidateStaleSurfaceFromTags,
  TAG_OBJECT_INCOMPATIBLE
} = __test;

describe("F12 — stale object invalidation (TAG_OBJECT_INCOMPATIBLE)", () => {
  test("glass_cleaner tag invalidates stale object=caroserie", () => {
    const slots = { context: "exterior", surface: "glass", object: "caroserie" };
    const tags = ["glass_cleaner", "cleaning"];
    const result = invalidateStaleObjectFromTags(slots, tags, "f12-obj-1");
    expect(result).not.toBeNull();
    expect(result.object).toBe("caroserie");
    expect(slots.object).toBeNull();
    expect(slots.surface).toBe("glass");
  });

  test("glass_cleaner tag keeps object=glass", () => {
    const slots = { context: "exterior", surface: "glass", object: "glass" };
    const tags = ["glass_cleaner", "exterior"];
    const result = invalidateStaleObjectFromTags(slots, tags, "f12-obj-2");
    expect(result).toBeNull();
    expect(slots.object).toBe("glass");
  });

  test("ceramic_coating tag invalidates stale object=geam", () => {
    const slots = { context: "exterior", surface: "paint", object: "geam" };
    const tags = ["ceramic_coating"];
    const result = invalidateStaleObjectFromTags(slots, tags, "f12-obj-3");
    expect(result).not.toBeNull();
    expect(slots.object).toBeNull();
  });

  test("no invalidation when object is null", () => {
    const slots = { context: "exterior", surface: "glass", object: null };
    const tags = ["glass_cleaner"];
    expect(invalidateStaleObjectFromTags(slots, tags, "f12-obj-4")).toBeNull();
  });

  test("TAG_SURFACE_INCOMPATIBLE regression still fires on surface conflicts", () => {
    const slots = { surface: "glass", object: "glass", context: "exterior" };
    const tags = ["ceramic_coating", "exterior"];
    const result = invalidateStaleSurfaceFromTags(slots, tags, "f12-surf-reg");
    expect(result).not.toBeNull();
    expect(slots.surface).toBeNull();
  });

  test("TAG_OBJECT_INCOMPATIBLE map is exported", () => {
    expect(TAG_OBJECT_INCOMPATIBLE.glass_cleaner).toBeDefined();
    expect(TAG_OBJECT_INCOMPATIBLE.glass_cleaner.has("caroserie")).toBe(true);
  });
});
