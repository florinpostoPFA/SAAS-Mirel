const fs = require("fs");
const {
  flattenCategoryTree,
  resolveCategoryPath
} = require("../scripts/lib/magentoCategories");
const {
  mergeImportedProducts,
  mapMagentoToRow,
  toProduct,
  getProductCategoryIds
} = require("../scripts/importProducts");

describe("flattenCategoryTree", () => {
  const tree = {
    id: 1,
    name: "Root Catalog",
    is_active: false,
    children_data: [
      {
        id: 2,
        name: "A",
        is_active: true,
        children_data: [
          {
            id: 7,
            name: "B",
            is_active: true,
            children_data: [
              {
                id: 13,
                name: "C",
                is_active: true,
                children_data: []
              }
            ]
          }
        ]
      }
    ]
  };

  it("maps leaf paths and excludes synthetic root", () => {
    const map = flattenCategoryTree(tree);
    expect(map.size).toBe(3);
    expect(map.get(2)).toBe("A");
    expect(map.get(7)).toBe("A / B");
    expect(map.get(13)).toBe("A / B / C");
    expect(map.has(1)).toBe(false);
  });
});

describe("resolveCategoryPath", () => {
  const treeMap = new Map([
    [2, "A"],
    [7, "A / B"],
    [13, "A / B / C"]
  ]);

  it("returns deepest path with tiebreak alphabetical", () => {
    expect(resolveCategoryPath([2, 7, 13], treeMap)).toBe("A / B / C");
  });

  it("returns empty string when no ids match", () => {
    expect(resolveCategoryPath([], treeMap)).toBe("");
    expect(resolveCategoryPath([99], treeMap)).toBe("");
  });
});

describe("getProductCategoryIds", () => {
  it("reads extension_attributes.category_links first", () => {
    const ids = getProductCategoryIds({
      extension_attributes: {
        category_links: [{ category_id: "7" }, { category_id: "13" }]
      },
      custom_attributes: [{ attribute_code: "category_ids", value: "2" }]
    });
    expect(ids).toEqual([7, 13]);
  });

  it("falls back to custom_attributes category_ids", () => {
    const ids = getProductCategoryIds({
      custom_attributes: [{ attribute_code: "category_ids", value: "2,7,13" }]
    });
    expect(ids).toEqual([2, 7, 13]);
  });
});

describe("mapMagentoToRow categoryPath", () => {
  const treeMap = new Map([[42, "Parbriz & Geamuri"]]);

  it("resolves categoryPath from product category ids", () => {
    const row = mapMagentoToRow(
      {
        sku: "G1 0.1",
        name: "G1 glass",
        price: 10,
        extension_attributes: { category_links: [{ category_id: "42" }] },
        custom_attributes: []
      },
      treeMap
    );
    expect(row.categoryPath).toBe("Parbriz & Geamuri");
    expect(row).not.toHaveProperty("category");
  });
});

describe("mergeImportedProducts", () => {
  it("preserves tags and refreshes description from Magento row", () => {
    const existing = [
      {
        id: "P-1",
        name: "Old name",
        description: "Old description",
        short_description: "",
        price: 1,
        categoryPath: "",
        meta_keyword: "",
        manufacturerId: null,
        brand: null,
        searchText: "old",
        tags: ["leather_natural", "conditioning"]
      }
    ];

    const fresh = [
      {
        id: "P-1",
        name: "New name",
        description: "New description from Magento",
        short_description: "Short",
        price: 2,
        categoryPath: "A / B / C",
        meta_keyword: "kw",
        manufacturerId: "10",
        brand: "Koch Chemie",
        searchText: "new",
        tags: []
      }
    ];

    const { products, stats } = mergeImportedProducts(existing, fresh, { resetTags: false });
    expect(stats.merged).toBe(1);
    expect(products).toHaveLength(1);
    expect(products[0].description).toBe("New description from Magento");
    expect(products[0].categoryPath).toBe("A / B / C");
    expect(products[0].tags).toEqual(["leather_natural", "conditioning"]);
  });

  it("marks catalog-only products as removedFromCatalog", () => {
    const existing = [
      {
        id: "gone",
        name: "Discontinued",
        description: "",
        short_description: "",
        price: 0,
        categoryPath: "",
        meta_keyword: "",
        manufacturerId: null,
        brand: null,
        searchText: "",
        tags: ["wheel_cleaner"]
      }
    ];

    const { products, stats } = mergeImportedProducts(existing, [], { resetTags: false });
    expect(stats.dropped).toBe(1);
    expect(products[0].removedFromCatalog).toBe(true);
    expect(products[0].tags).toEqual(["wheel_cleaner"]);
  });
});

describe("importProducts merge integration", () => {
  const { importProducts } = require("../scripts/importProducts");

  beforeEach(() => {
    process.env.MAGENTO_BASE_URL = "https://shop.example.com";
    process.env.MAGENTO_TOKEN = "test-token";
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify([
        {
          id: "P-1",
          name: "Iron Remover",
          description: "Old",
          short_description: "",
          price: 49.99,
          categoryPath: "",
          meta_keyword: "",
          manufacturerId: null,
          brand: null,
          searchText: "iron",
          tags: ["iron_remover", "wheel_cleaner"]
        }
      ])
    );
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              sku: "P-1",
              name: "Iron Remover",
              price: 49.99,
              extension_attributes: { category_links: [{ category_id: "7" }] },
              custom_attributes: [
                { attribute_code: "description", value: "Fresh description" }
              ]
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 1,
          name: "Root Catalog",
          is_active: false,
          children_data: [
            { id: 7, name: "Wheels", is_active: true, children_data: [] }
          ]
        })
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes merged catalog with preserved tags", async () => {
    await importProducts({ resetTags: false });
    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written[0].description).toBe("Fresh description");
    expect(written[0].categoryPath).toBe("Wheels");
    expect(written[0].tags).toEqual(["iron_remover", "wheel_cleaner"]);
  });
});
