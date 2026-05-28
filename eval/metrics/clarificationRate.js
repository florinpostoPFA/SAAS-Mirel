"use strict";

function round2(value) {
  return Math.round(value * 100) / 100;
}

function compute(resultsByArchitecture, corpus) {
  const perArchitecture = {};
  const perTurn = [];

  Object.entries(resultsByArchitecture || {}).forEach(([arch, rows]) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      perArchitecture[arch] = "N/A";
      return;
    }

    let clarificationCount = 0;
    rows.forEach((row) => {
      const isClarification = row?.decision?.action === "clarification";
      if (isClarification) clarificationCount += 1;
      perTurn.push({
        architecture: arch,
        corpusFile: row.corpusFile,
        turnIdx: row.turnIdx,
        value: isClarification ? 1 : 0
      });
    });

    perArchitecture[arch] = round2((clarificationCount / rows.length) * 100);
  });

  return { perArchitecture, perTurn };
}

module.exports = { compute };
