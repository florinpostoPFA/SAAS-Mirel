function autoTagProduct(product) {
  const text = `${product.name || ""} ${product.description || ""}`.toLowerCase();

  const mapping = {
    interior: ["interior", "cockpit", "bord", "cotiera", "scaun"],
    exterior: ["exterior", "caroserie", "vopsea"],
    leather: ["leather", "piele"],
    textile: ["textil", "fabric"],
    alcantara: ["alcantara"],
    plastic: ["plastic", "trim"],
    glass: ["glass", "geam"],
    tire: ["tire", "anvelopa"],
    cleaning: ["clean", "cleaner", "curata", "murdar", "pata"],
    protection: ["protect", "seal", "dressing"],
    shine: ["luciu", "shine"]
  };

  const tags = new Set();

  Object.entries(mapping).forEach(([tag, keywords]) => {
    if (keywords.some(keyword => text.includes(keyword))) {
      tags.add(tag);
    }
  });

  return Array.from(tags);
}

module.exports = { autoTagProduct };
