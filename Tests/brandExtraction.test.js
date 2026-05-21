/**
 * @jest-environment node
 */

const { extractBrandFromMessage, productMatchesBrand } = require("../services/brandExtraction");
const chat = require("../services/chatService");

describe("brand extraction from user query", () => {
  test("extracts Koch Chemie and Gtechniq", () => {
    expect(extractBrandFromMessage("ce produs Koch Chemie aveti pentru jante")).toBe(
      "Koch Chemie"
    );
    expect(extractBrandFromMessage("ce produs Gtechniq aveti pentru jante")).toBe("Gtechniq");
  });

  test("extractSlotsFromMessage plumbs brand slot", () => {
    const slots = chat.extractSlotsFromMessage("ce produs Koch Chemie aveti pentru jante");
    expect(slots.brand).toBe("Koch Chemie");
    expect(slots.object).toBe("jante");
  });

  test("filterProducts keeps only matching brand", () => {
    const { filterProducts } = chat.__test;
    const koch = {
      id: "k1",
      name: "Magic Wheel Cleaner Koch Chemie",
      brand: "Koch Chemie",
      tags: ["wheels", "cleaning", "exterior"]
    };
    const other = {
      id: "g1",
      name: "Wheel Cleaner Gtechniq",
      brand: "Gtechniq",
      tags: ["wheels", "cleaning", "exterior"]
    };
    const slots = { context: "exterior", object: "jante", surface: "wheels", brand: "Koch Chemie" };
    const out = filterProducts([koch, other], slots);
    expect(out.map((p) => p.id)).toEqual(["k1"]);
  });

  test("productMatchesBrand falls back to name when brand field missing", () => {
    expect(
      productMatchesBrand({ name: "ADBL Wheel Cleaner 500ml", brand: null }, "ADBL")
    ).toBe(true);
    expect(
      productMatchesBrand({ name: "Wheel Cleaner Gtechniq", brand: null }, "Koch Chemie")
    ).toBe(false);
  });
});
