"use strict";

function stableDecisionFingerprint(row) {
  return JSON.stringify({
    action: row?.decision?.action ?? null,
    flowId: row?.decision?.flowId ?? null,
    missingSlot: row?.decision?.missingSlot ?? null,
    reasonCode: row?.decision?.reasonCode ?? null
  });
}

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

    const byTurn = new Map();
    rows.forEach((row) => {
      const key = `${row.corpusFile}:${row.turnIdx}`;
      if (!byTurn.has(key)) byTurn.set(key, []);
      byTurn.get(key).push(row);
    });

    let stableCount = 0;
    let total = 0;
    byTurn.forEach((group, key) => {
      total += 1;
      const fingerprints = new Set(group.map(stableDecisionFingerprint));
      const stable = fingerprints.size === 1;
      if (stable) stableCount += 1;
      const [corpusFile, turnIdxRaw] = key.split(":");
      perTurn.push({
        architecture: arch,
        corpusFile,
        turnIdx: Number(turnIdxRaw),
        value: stable ? 1 : 0
      });
    });

    perArchitecture[arch] = total > 0 ? round2((stableCount / total) * 100) : "N/A";
  });

  return { perArchitecture, perTurn };
}

module.exports = { compute };
