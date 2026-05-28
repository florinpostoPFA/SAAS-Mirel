"use strict";

function round2(value) {
  return Math.round(value * 100) / 100;
}

function inferLabelFromTurn(row) {
  if (!row || row?.decision?.action === "clarification") return null;
  const msg = String(row?.input?.message || "").toLowerCase();
  if (msg.includes("hidrofob")) return "shelf_protect_hydrophobic";
  if (msg.includes("ceramic")) return "shelf_ceramic_coating";
  if (msg.includes("ceara")) return "shelf_protect_wax";
  if (msg.includes("coating")) return "shelf_protect_wax_or_coating";
  if (msg.includes("polish") || msg.includes("lustru")) return "shelf_polish";
  if (msg.includes("intretin") || msg.includes("întrețin")) return "shelf_maintain";
  return null;
}

function compute(resultsByArchitecture, corpus) {
  const perArchitecture = {};
  const perTurn = [];

  const expectedByKey = new Map();
  const auditTurns = (((corpus || {}).turnsByFile || {})["auditFn10.jsonl"] || []).filter(
    (turn) => turn && turn.expectedDecisionLabel
  );
  auditTurns.forEach((turn) => {
    expectedByKey.set(`auditFn10.jsonl:${turn.turnIdx}`, turn.expectedDecisionLabel);
  });

  Object.entries(resultsByArchitecture || {}).forEach(([arch, rows]) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      perArchitecture[arch] = "N/A";
      return;
    }

    const auditRows = rows.filter((row) => row.corpusFile === "auditFn10.jsonl");
    if (auditRows.length === 0 || expectedByKey.size === 0) {
      perArchitecture[arch] = 0;
      return;
    }

    let matched = 0;
    let total = 0;
    auditRows.forEach((row) => {
      const expected = expectedByKey.get(`auditFn10.jsonl:${row.turnIdx}`);
      if (!expected) return;
      total += 1;
      const predicted = inferLabelFromTurn(row);
      const ok = predicted === expected;
      if (ok) matched += 1;
      perTurn.push({
        architecture: arch,
        corpusFile: row.corpusFile,
        turnIdx: row.turnIdx,
        value: ok ? 1 : 0
      });
    });

    perArchitecture[arch] = total > 0 ? round2((matched / total) * 100) : 0;
  });

  return { perArchitecture, perTurn };
}

module.exports = { compute };
