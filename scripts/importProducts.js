const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const JSON_PATH = path.join(__dirname, "..", "data", "products.json");

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

function toProduct(row) {
  const sku = pick(row, ["sku", "SKU", "id", "ID"]);
  const name = cleanText(pick(row, ["name", "Name", "title", "Title", "product_name"]));
  const description = cleanText(row.description || pick(row, ["Description"]));
  const short_description = cleanText(row.short_description || row.shortDescription || pick(row, ["Short Description"]));
  const category = cleanText(pick(row, ["category", "Category", "categories", "Categories"]));
  const meta_keyword = cleanText(pick(row, ["meta_keyword", "meta_keywords", "Meta Keyword", "Meta Keywords", "keywords", "Keywords"]));
  const rawPrice = pick(row, ["price", "Price", "regular_price", "Regular Price"]);
  const numericPrice = parseFloat(String(rawPrice).replace(/[^0-9.,-]/g, "").replace(",", ".")) || 0;

  return {
    id: sku,
    name,
    description,
    short_description,
    price: numericPrice,
    category,
    meta_keyword,
    searchText: normalizeText(
      (name || "") + " " +
      (description || "") + " " +
      (category || "")
    ),
    tags: []
  };
}

function getAttr(product, code) {
  return product.custom_attributes?.find(a => a.attribute_code === code)?.value || "";
}

function mapMagentoToRow(product) {
  return {
    sku: product.sku,
    name: product.name,
    price: product.price,
    description: getAttr(product, "description"),
    short_description: getAttr(product, "short_description"),
    meta_keyword: getAttr(product, "meta_keyword"),
    category: ""
  };
}

async function readProductsFromMagento() {
  const baseUrl = process.env.MAGENTO_BASE_URL;
  const token = process.env.MAGENTO_TOKEN;
  const pageSize = Number(process.env.PAGE_SIZE) || 50;

  let currentPage = 1;
  let allProducts = [];

  while (true) {
    const url = `${baseUrl}/rest/V1/products?searchCriteria[pageSize]=${pageSize}&searchCriteria[currentPage]=${currentPage}`;

    console.log(`Fetching page ${currentPage}...`);

    const response = await fetch(url, {
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

async function importProducts() {
  const magentoProducts = await readProductsFromMagento();
  const rows = magentoProducts.map(mapMagentoToRow);
  const products = rows.map(toProduct);

  fs.writeFileSync(JSON_PATH, JSON.stringify(products, null, 2));
  console.log("Imported products:", products.length);

  return products;
}

if (require.main === module) {
  importProducts().catch((err) => {
    console.error("Failed to import products:", err);
    process.exitCode = 1;
  });
}

module.exports = {
  importProducts,
  mapMagentoToRow,
  getAttr,
  readProductsFromMagento,
  toProduct,
  cleanText,
  normalizeText
};



