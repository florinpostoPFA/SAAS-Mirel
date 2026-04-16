const ROLE_TAGS = {
  snow_foam: ["snow_foam", "foam", "prewash", "cleaning", "exterior"],
  foam_sprayer: ["foam_sprayer", "sprayer", "accessory", "exterior"],
  car_shampoo: ["car_shampoo", "shampoo", "cleaning", "exterior"],
  wash_mitt: ["wash_mitt", "mitt", "accessory", "exterior"],
  bucket: ["bucket", "accessory", "exterior"],
  drying_towel: ["drying_towel", "towel", "drying", "exterior"]
};

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(tag => String(tag).toLowerCase().trim());
}

function scoreProduct(product, roleTags) {
  let score = 0;

  const productTags = normalizeTags(product.tags);

  // Tag match score
  const matches = productTags.filter(tag => roleTags.includes(tag));
  score += matches.length * 2;

  return score;
}

function mapProductsByRoles(productRoles, allProducts) {
  const roles = Array.isArray(productRoles) ? productRoles : [];
  const products = Array.isArray(allProducts) ? allProducts : [];
  const result = {};

  for (const role of roles) {
    const roleKey = String(role);
    const mappedTags = ROLE_TAGS[roleKey] || [];

    const matched = products.filter(product => {
      const productTags = normalizeTags(product.tags);
      return mappedTags.some(tag => productTags.includes(tag));
    });

    const candidates = matched.map(product => ({
      product,
      score: scoreProduct(product, mappedTags)
    }));

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aName = String(a.product?.name || "");
      const bName = String(b.product?.name || "");
      return aName.localeCompare(bName);
    });

    const selectedWithScores = candidates.slice(0, 2);
    const selectedProducts = selectedWithScores.map(item => item.product);

    result[roleKey] = selectedProducts;
  }

  return result;
}

module.exports = { mapProductsByRoles };
