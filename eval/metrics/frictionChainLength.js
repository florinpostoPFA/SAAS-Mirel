"use strict";

function compute(resultsByArchitecture, corpus) {
  const perArchitecture = {};
  const perTurn = [];

  Object.entries(resultsByArchitecture || {}).forEach(([arch, rows]) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      perArchitecture[arch] = "N/A";
      return;
    }

    const sessionRows = rows
      .filter((row) => row.corpusFile === "session_704783fb.jsonl")
      .sort((a, b) => Number(a.turnIdx) - Number(b.turnIdx));

    if (sessionRows.length === 0) {
      perArchitecture[arch] = 0;
      return;
    }

    let firstRecommendIndex = -1;
    for (let i = 0; i < sessionRows.length; i += 1) {
      if (sessionRows[i]?.decision?.action === "recommend") {
        firstRecommendIndex = i;
        break;
      }
    }

    const frictionLength =
      firstRecommendIndex >= 0 ? firstRecommendIndex + 1 : sessionRows.length;

    perArchitecture[arch] = frictionLength;
    perTurn.push({
      architecture: arch,
      corpusFile: "session_704783fb.jsonl",
      turnIdx: frictionLength - 1,
      value: frictionLength
    });
  });

  return { perArchitecture, perTurn };
}

module.exports = { compute };
