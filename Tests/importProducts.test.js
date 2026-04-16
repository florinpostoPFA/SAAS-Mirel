const fs = require("fs");
const { getAttr, mapMagentoToRow, readProductsFromMagento, importProducts } = require("../scripts/importProducts");

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  writeFileSync: jest.fn()
}));

// ---------------------------------------------------------------------------
// getAttr
// ---------------------------------------------------------------------------
describe("getAttr()", () => {
  const product = {
    custom_attributes: [
      { attribute_code: "description", value: "Great cleaner" },
      { attribute_code: "meta_keyword", value: "clean,interior" }
    ]
  };

  it("returns the correct value when attribute exists", () => {
    expect(getAttr(product, "description")).toBe("Great cleaner");
    expect(getAttr(product, "meta_keyword")).toBe("clean,interior");
  });

  it("returns empty string when attribute is missing", () => {
    expect(getAttr(product, "short_description")).toBe("");
  });

  it("returns empty string when custom_attributes is undefined", () => {
    expect(getAttr({}, "description")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// mapMagentoToRow
// ---------------------------------------------------------------------------
describe("mapMagentoToRow()", () => {
  const magentoProduct = {
    sku: "SKU-001",
    name: "Auto Shampoo",
    price: 29.99,
    custom_attributes: [
      { attribute_code: "description", value: "Premium car wash shampoo" },
      { attribute_code: "short_description", value: "Car shampoo" },
      { attribute_code: "meta_keyword", value: "shampoo,wash,exterior" }
    ]
  };

  it("maps Magento product fields to row shape correctly", () => {
    const row = mapMagentoToRow(magentoProduct);
    expect(row.sku).toBe("SKU-001");
    expect(row.name).toBe("Auto Shampoo");
    expect(row.price).toBe(29.99);
    expect(row.description).toBe("Premium car wash shampoo");
    expect(row.short_description).toBe("Car shampoo");
    expect(row.meta_keyword).toBe("shampoo,wash,exterior");
    expect(row.category).toBe("");
  });

  it("has no undefined fields", () => {
    const row = mapMagentoToRow(magentoProduct);
    Object.values(row).forEach(v => expect(v).not.toBeUndefined());
  });

  it("returns empty strings for missing custom_attributes", () => {
    const row = mapMagentoToRow({ sku: "X", name: "Product", price: 0 });
    expect(row.description).toBe("");
    expect(row.short_description).toBe("");
    expect(row.meta_keyword).toBe("");
  });
});

// ---------------------------------------------------------------------------
// readProductsFromMagento
// ---------------------------------------------------------------------------
describe("readProductsFromMagento()", () => {
  const fakeItems = [
    { sku: "A1", name: "Wax", price: 15, custom_attributes: [] }
  ];

  beforeEach(() => {
    process.env.MAGENTO_BASE_URL = "https://shop.example.com";
    process.env.MAGENTO_TOKEN = "test-token";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns items from the Magento API response", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: fakeItems })
    });

    const result = await readProductsFromMagento();
    expect(result).toEqual(fakeItems);
  });

  it("calls the correct endpoint with auth header", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] })
    });

    await readProductsFromMagento();

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain("/rest/V1/products");
    expect(url).toContain("searchCriteria");
    expect(options.headers.Authorization).toBe("Bearer test-token");
  });

  it("throws when the API returns a non-ok status", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    await expect(readProductsFromMagento()).rejects.toThrow("Magento API error: 401");
  });

  it("returns empty array when items key is missing", async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await readProductsFromMagento();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// importProducts
// ---------------------------------------------------------------------------
describe("importProducts()", () => {
  const fakeItems = [
    {
      sku: "P1",
      name: "Iron Remover",
      price: 49.99,
      custom_attributes: [
        { attribute_code: "description", value: "Removes iron particles" }
      ]
    }
  ];

  beforeEach(() => {
    process.env.MAGENTO_BASE_URL = "https://shop.example.com";
    process.env.MAGENTO_TOKEN = "test-token";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: fakeItems })
    });
    fs.writeFileSync.mockClear();
  });

  it("writes products to JSON file", async () => {
    await importProducts();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe("Iron Remover");
  });

  it("products have empty tags after import (tagging is not done here)", async () => {
    await importProducts();
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    written.forEach(p => {
      expect(p.tags).toEqual([]);
    });
  });

  it("products have all expected fields", async () => {
    await importProducts();
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    const p = written[0];
    expect(p).toHaveProperty("id");
    expect(p).toHaveProperty("name");
    expect(p).toHaveProperty("description");
    expect(p).toHaveProperty("price");
    expect(p).toHaveProperty("tags");
    expect(p).toHaveProperty("searchText");
  });
});
