const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const {
  fetchCategoryTree,
  flattenCategoryTree,
  resolveCategoryPath
} = require("./lib/magentoCategories");

dotenv.config();

const JSON_PATH = path.join(__dirname, "..", "data", "products.json");
const BRAND_WHITELIST_PATH = path.join(__dirname, "..", "data", "brand-whitelist.json");

let brandWhitelistCache = null;
let categoryIdSourceWarningLogged = false;

function loadBrandWhitelist() {
  if (brandWhitelistCache) {
    return brandWhitelistCache;
  }
  brandWhitelistCache = JSON.parse(fs.readFileSync(BRAND_WHITELIST_PATH, "utf8"));
  return brandWhitelistCache;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Longest whitelist match against product name (case-insensitive, word boundaries).
 * @param {string} name
 * @param {string[]} whitelist
 * @returns {string|null}
 */
function resolveBrandFromName(name, whitelist) {
  const safeName = String(name || "");
  if (!safeName) {
    return null;
  }

  const sorted = [...whitelist].sort((a, b) => b.length - a.length);

  for (const brand of sorted) {
    const brandText = String(brand || "").trim();
    if (!brandText) {
      continue;
    }

    const pattern = new RegExp(
      `(?:^|[^A-Za-z0-9])${escapeRegExp(brandText)}(?:[^A-Za-z0-9]|$)`,
      "i"
    );

    if (pattern.test(safeName)) {
      return brandText;
    }
  }

  return null;
}

function getManufacturerId(product) {
  const raw = getAttr(product, "manufacturer");
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  return String(raw).trim();
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

function cleanText(text) {
  if (!text) return "";

  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[✔️❌•►]/g, "")
    .replace(/[^\x00-\x7FăâîșțĂÂÎȘȚ]/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {object} product Raw Magento product
 * @returns {number[]}
 */
function getProductCategoryIds(product) {
  const links = product?.extension_attributes?.category_links;
  if (Array.isArray(links) && links.length > 0) {
    return links
      .map((link) => Number(link.category_id))
      .filter((id) => !Number.isNaN(id));
  }

  const raw = getAttr(product, "category_ids");
  if (raw) {
    return String(raw)
      .split(",")
      .map((part) => Number(String(part).trim()))
      .filter((id) => !Number.isNaN(id));
  }

  return [];
}

function warnIfCategoryIdsMissing(magentoProducts) {
  if (categoryIdSourceWarningLogged || magentoProducts.length === 0) {
    return;
  }

  const sample = magentoProducts[0];
  const hasLinks = Array.isArray(sample?.extension_attributes?.category_links);
  const hasAttr = sample?.custom_attributes?.some(
    (attr) => attr.attribute_code === "category_ids"
  );

  if (!hasLinks && !hasAttr) {
    console.warn(
      "[importProducts] No category_links or category_ids found on Magento products; categoryPath will be empty."
    );
    categoryIdSourceWarningLogged = true;
  }
}

function toProduct(row) {
  const sku = pick(row, ["sku", "SKU", "id", "ID"]);
  const name = cleanText(pick(row, ["name", "Name", "title", "Title", "product_name"]));
  const description = cleanText(row.description || pick(row, ["Description"]));
  const short_description = cleanText(row.short_description || row.shortDescription || pick(row, ["Short Description"]));
  const categoryPath = cleanText(row.categoryPath || pick(row, ["categoryPath", "CategoryPath"]));
  const meta_keyword = cleanText(pick(row, ["meta_keyword", "meta_keywords", "Meta Keyword", "Meta Keywords", "keywords", "Keywords"]));
  const rawPrice = pick(row, ["price", "Price", "regular_price", "Regular Price"]);
  const numericPrice = parseFloat(String(rawPrice).replace(/[^0-9.,-]/g, "").replace(",", ".")) || 0;

  return {
    id: sku,
    name,
    description,
    short_description,
    price: numericPrice,
    categoryPath,
    meta_keyword,
    manufacturerId: row.manufacturerId ?? null,
    brand: row.brand ?? null,
    searchText: normalizeText(
      (name || "") + " " +
      (description || "") + " " +
      (categoryPath || "")
    ),
    tags: Array.isArray(row.tags) ? row.tags : []
  };
}

function getAttr(product, code) {
  return product.custom_attributes?.find(a => a.attribute_code === code)?.value || "";
}

/**
 * @param {object} product
 * @param {Map<number, string>} treeMap
 */
function mapMagentoToRow(product, treeMap = new Map()) {
  const whitelist = loadBrandWhitelist();
  const name = product.name;
  const categoryIds = getProductCategoryIds(product);

  return {
    sku: product.sku,
    name,
    price: product.price,
    description: getAttr(product, "description"),
    short_description: getAttr(product, "short_description"),
    meta_keyword: getAttr(product, "meta_keyword"),
    categoryPath: resolveCategoryPath(categoryIds, treeMap),
    manufacturerId: getManufacturerId(product),
    brand: resolveBrandFromName(name, whitelist)
  };
}

/**
 * @param {object[]} existingProducts
 * @param {object[]} freshProducts
 * @param {{ resetTags?: boolean }} options
 */
function mergeImportedProducts(existingProducts, freshProducts, options = {}) {
  const resetTags = Boolean(options.resetTags);

  if (resetTags) {
    const products = freshProducts.map((product) => ({
      ...product,
      tags: [],
      removedFromCatalog: false
    }));
    return {
      products,
      stats: {
        total: products.length,
        merged: 0,
        added: products.length,
        dropped: 0
      }
    };
  }

  const existingMap = new Map(existingProducts.map((product) => [product.id, product]));
  const magentoIds = new Set(freshProducts.map((product) => product.id));

  let merged = 0;
  let added = 0;
  const products = [];

  for (const fresh of freshProducts) {
    const existing = existingMap.get(fresh.id);
    if (existing) {
      merged += 1;
      const mergedProduct = {
        ...fresh,
        tags: Array.isArray(existing.tags) ? existing.tags : [],
        removedFromCatalog: false
      };
      if (Object.prototype.hasOwnProperty.call(existing, "aiTags")) {
        mergedProduct.aiTags = existing.aiTags;
      }
      products.push(mergedProduct);
    } else {
      added += 1;
      products.push({ ...fresh, tags: [], removedFromCatalog: false });
    }
  }

  let dropped = 0;
  for (const existing of existingProducts) {
    if (!magentoIds.has(existing.id)) {
      dropped += 1;
      products.push({ ...existing, removedFromCatalog: true });
    }
  }

  return {
    products,
    stats: {
      total: products.length,
      merged,
      added,
      dropped
    }
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  return {
    resetTags: argv.includes("--reset-tags")
  };
}

function readExistingProducts() {
  if (!fs.existsSync(JSON_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
}

async function readProductsFromMagento(fetchImpl = fetch) {
  const baseUrl = process.env.MAGENTO_BASE_URL;
  const token = process.env.MAGENTO_TOKEN;
  const pageSize = Number(process.env.PAGE_SIZE) || 50;

  let currentPage = 1;
  let allProducts = [];

  while (true) {
    const url = `${baseUrl}/rest/V1/products?searchCriteria[pageSize]=${pageSize}&searchCriteria[currentPage]=${currentPage}`;

    console.log(`Fetching page ${currentPage}...`);

    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Magento API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) break;

    allProducts.push(...data.items);

    if (data.items.length < pageSize) break;

    currentPage++;
  }

  console.log(`Total products fetched: ${allProducts.length}`);
  return allProducts;
}

async function importProducts(options = {}) {
  const resetTags = Boolean(options.resetTags);
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = process.env.MAGENTO_BASE_URL;
  const token = process.env.MAGENTO_TOKEN;

  const magentoProducts = await readProductsFromMagento(fetchImpl);
  warnIfCategoryIdsMissing(magentoProducts);

  const categoryTree = await fetchCategoryTree({ baseUrl, token, fetchImpl });
  const treeMap = flattenCategoryTree(categoryTree);

  const rows = magentoProducts.map((product) => mapMagentoToRow(product, treeMap));
  const freshProducts = rows.map((row) => toProduct({ ...row, tags: [] }));

  const existingProducts = resetTags ? [] : readExistingProducts();
  const { products, stats } = mergeImportedProducts(existingProducts, freshProducts, { resetTags });

  fs.writeFileSync(JSON_PATH, JSON.stringify(products, null, 2));

  console.log(
    `Import done: ${stats.total} total, ${stats.merged} merged (tags preserved), ${stats.added} added, ${stats.dropped} marked removedFromCatalog.`
  );

  return products;
}

if (require.main === module) {
  const cli = parseCliArgs();
  importProducts({ resetTags: cli.resetTags }).catch((err) => {
    console.error("Failed to import products:", err);
    process.exitCode = 1;
  });
}

module.exports = {
  importProducts,
  mapMagentoToRow,
  getAttr,
  getManufacturerId,
  getProductCategoryIds,
  resolveBrandFromName,
  loadBrandWhitelist,
  readProductsFromMagento,
  mergeImportedProducts,
  toProduct,
  cleanText,
  normalizeText,
  parseCliArgs
};
