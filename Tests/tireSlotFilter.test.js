/**
 * @jest-environment node
 */

const {
  extractSlotsFromMessage,
  __test: { filterProducts, inferWheelsSurfaceFromObject }
} = require("../services/chatService");

describe("wheel surface filter — jante queries", () => {
  test("PRODUCT_FILTER keeps tier-1 wheel cleaner with empty tags when name matches", () => {
    const slots = inferWheelsSurfaceFromObject(
      extractSlotsFromMessage("recomanda-mi o solutie pentru curatat jantele")
    );
    const koch = {
      id: "425500",
      name: "Solutie curatare jante Koch Chemie Magic Wheel Cleaner, Mwc, 500ml",
      description: "Wheel cleaner pentru jante.",
      manufacturerId: "13",
      brand: "Koch Chemie",
      tags: []
    };
    const after = filterProducts([koch], slots);
    expect(after.length).toBe(1);
    expect(after[0].id).toBe("425500");
  });
});

describe("tire slot filter — vreau ceva pentru anvelope", () => {
  test("PRODUCT_FILTER keeps tire product with empty tags but anvelope in name", () => {
    const msg = "vreau ceva pentru anvelope";
    const slots = inferWheelsSurfaceFromObject(extractSlotsFromMessage(msg));
    expect(slots.object).toBe("anvelope");
    expect(slots.surface).toBe("tires");

    const tireProduct = {
      id: "G7516",
      name: "Gel luciu anvelope Endurance Tire Gel, 473ml",
      description: "Dressing pentru anvelope.",
      tags: []
    };

    const before = [tireProduct];
    const after = filterProducts(before, slots);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0].id).toBe("G7516");
  });

  test("PRODUCT_FILTER drops non-tire SKU when description contains cauciuc but name is not tire", () => {
    const msg = "vreau ceva pentru anvelope";
    const slots = inferWheelsSurfaceFromObject(extractSlotsFromMessage(msg));
    expect(slots.surface).toBe("tires");

    const interiorRubberMention = {
      id: "G13616",
      name: "Solutie detailing interior Quick Interior Detailer Meguiar's, G13616",
      description:
        "Curata rapid plastic, piele, vinil, cauciuc, metal, sticla — produs interior, nu roti.",
      tags: [],
      manufacturerId: "9"
    };

    const after = filterProducts([interiorRubberMention], slots);
    expect(after.length).toBe(0);
  });
});
