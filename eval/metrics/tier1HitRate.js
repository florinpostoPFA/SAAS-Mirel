"use strict";

const tier1Brands = require("./tier1Brands");

function round2(value) {
  return Math.round(value * 100) / 100;
}

function compute(resultsByArchitecture, corpus) {
  const perArchitecture = {};
  const perTurn = [];
  const tier1 = new Set(tier1Brands.map((b) => String(b).toLowerCase()));

  Object.entries(resultsByArchitecture || {}).forEach(([arch, rows]) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      perArchitecture[arch] = "N/A";
      return;
    }

    const recommendRows = rows.filter(
      (row) => row?.decision?.action === "recommend" && Array.isArray(row?.output?.products)
    );

    if (recommendRows.length === 0) {
      perArchitecture[arch] = 0;
      return;
    }

    let hits = 0;
    recommendRows.forEach((row) => {
      const hasTier1 = row.output.products.some((product) =>
        tier1.has(String(product?.brand || "").toLowerCase())
      );
      if (hasTier1) hits += 1;
      perTurn.push({
        architecture: arch,
        corpusFile: row.corpusFile,
        turnIdx: row.turnIdx,
        value: hasTier1 ? 1 : 0
      });
    });

    perArchitecture[arch] = round2((hits / recommendRows.length) * 100);
  });

  return { perArchitecture, perTurn };
}

module.exports = { compute };
