const { enrichTagsFromCatalogSignals } = require("../services/catalogTagEnrichment");

describe("catalogTagEnrichment (Step 5b Phase 3 lever 2)", () => {
  it("maps iron fallout wheel cleaners to iron_remover + decontamination", () => {
    const tags = enrichTagsFromCatalogSignals(
      {
        name: "Solutie decontaminare jante Reactive Wheel Cleaner Koch Chemie, 750ml",
        short_description: "formula sigura pt. orice tip de jante indicator rosu",
        meta_keyword: "decontaminare jante"
      },
      ["exterior", "wheels", "cleaning", "wheel_cleaner", "ph_neutral", "ready_to_use"]
    );
    expect(tags).toContain("iron_remover");
    expect(tags).toContain("decontamination");
    expect(tags).not.toContain("wheel_cleaner");
  });

  it("sets glass cleaners to exterior location", () => {
    const tags = enrichTagsFromCatalogSignals(
      {
        name: "Solutie curatare geamuri Ewocar CleanGlass-1 L",
        short_description: "solutie curatare geamuri sigur pentru sticla"
      },
      ["interior", "glass", "cleaning", "glass_cleaner", "ready_to_use"]
    );
    expect(tags).toContain("exterior");
    expect(tags).not.toContain("interior");
  });

  it("maps trim dressings with protectie to purpose protection", () => {
    const tags = enrichTagsFromCatalogSignals(
      {
        name: "Dressing protectie suprafete din plastic interior Adbl Interior Wow, 1L",
        short_description: "dressing protectie plastic interior"
      },
      ["interior", "plastic_interior", "conditioning", "trim_dressing", "satin"]
    );
    expect(tags).toContain("protection");
    expect(tags).not.toContain("conditioning");
  });

  it("does not override conditioning purpose on matte trim dressing without protectie", () => {
    const tags = enrichTagsFromCatalogSignals(
      {
        name: "Dressing mat pentru plastic si cauciuc interior GUF Gummifix Koch Chemie, 1L",
        short_description: "dressing mat interior plastic"
      },
      ["interior", "plastic_interior", "conditioning", "trim_dressing", "matte"]
    );
    expect(tags).toContain("conditioning");
    expect(tags).not.toContain("protection");
  });

  it("forces leather care products to interior location", () => {
    const tags = enrichTagsFromCatalogSignals(
      {
        name: "Solutie hidratare piele Protect Leather Care Koch Chemie, 500ml",
        short_description: "hidratare piele orice tip"
      },
      ["exterior", "leather_natural", "leather_synthetic", "conditioning", "leather_conditioner"]
    );
    expect(tags).toContain("interior");
    expect(tags).not.toContain("exterior");
  });

  it("fills Pol Star multi-surface interior cleaner axes", () => {
    const tags = enrichTagsFromCatalogSignals(
      {
        name: "Solutie curatare textil, piele si alcantara Po Koch Chemie Pol Star, 5L",
        short_description: "curatare textil piele alcantara concentrat"
      },
      []
    );
    expect(tags).toEqual(
      expect.arrayContaining([
        "interior",
        "textile",
        "alcantara",
        "leather_natural",
        "leather_synthetic",
        "cleaning",
        "interior_cleaner",
        "ph_neutral",
        "concentrate"
      ])
    );
  });
});
