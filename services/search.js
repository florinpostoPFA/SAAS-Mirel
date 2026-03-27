const synonyms = {
  luciu: ["wax", "ceara", "shine"],
  zgarieturi: ["polish"],
  interior: ["cleaner"]
};

function searchProducts(query, products) {
  const q = query.toLowerCase();

  return products
    .map(p => {
      let score = 0;

      if (p.name.toLowerCase().includes(q)) score += 3;
      if (p.description.toLowerCase().includes(q)) score += 2;

      // synonyms
      Object.keys(synonyms).forEach(key => {
        if (q.includes(key)) {
          synonyms[key].forEach(s => {
            if (p.name.toLowerCase().includes(s)) score += 2;
          });
        }
      });

      return { ...p, score };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

module.exports = { searchProducts };
