"use strict";

const { askLLM } = require("./llm");

const LLM_ALLOWLIST = ["textile", "alcantara", "leather", "vinyl", "suede"];

const CANONICAL_TO_CTO = {
  textile: "textile",
  alcantara: "alcantara",
  leather: "piele",
  vinyl: "plastic",
  suede: "piele"
};

function normalizeGateText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function userSignalsSurfaceMaterialUncertainty(message) {
  const g = normalizeGateText(message);
  if (!g) return false;
  const compact = g.replace(/\s+/g, "");
  return (
    g.includes("nu stiu") ||
    compact.includes("habarnam") ||
    g.includes("habar n-am") ||
    g.includes("habar nam") ||
    g.includes("nu sunt sigur") ||
    g.includes("nu sunt sigura") ||
    g.includes("idk") ||
    g.includes("no idea") ||
    g.includes("not sure") ||
    g.includes("nu stiu sigur")
  );
}

function stripJsonFence(raw) {
  let s = String(raw || "").trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/im.exec(s);
  if (fence) {
    s = fence[1].trim();
  }
  return s;
}

function parseLlmMaterialArray(rawContent) {
  const stripped = stripJsonFence(rawContent);
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const out = [];
  const seen = new Set();
  for (const item of parsed) {
    const key = String(item || "")
      .toLowerCase()
      .trim();
    if (!LLM_ALLOWLIST.includes(key)) {
      return null;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= 3) break;
  }
  return out.length > 0 ? out : null;
}

function displayLabelForCanonical(canonical, loc) {
  const c = String(canonical || "").toLowerCase();
  if (loc === "en") {
    const en = {
      textile: "textile",
      alcantara: "Alcantara",
      leather: "leather",
      vinyl: "vinyl",
      suede: "suede / nubuck"
    };
    return en[c] || c;
  }
  const ro = {
    textile: "textil",
    alcantara: "alcantara",
    leather: "piele",
    vinyl: "piele ecologica (vinil)",
    suede: "piele velurata (suede)"
  };
  return ro[c] || c;
}

function canonicalToCtoSurface(canonical) {
  return CANONICAL_TO_CTO[String(canonical || "").toLowerCase()] || null;
}

function buildCarLineFromParsed(parsed, fallbackRaw) {
  const make = parsed?.vehicleMake ? String(parsed.vehicleMake).trim() : "";
  const model = parsed?.vehicleModel ? String(parsed.vehicleModel).trim() : "";
  const year = parsed?.vehicleYear ? String(parsed.vehicleYear).trim().slice(0, 4) : "";
  const joined = [make, model, year].filter(Boolean).join(" ").trim();
  if (joined) {
    return joined;
  }
  return String(fallbackRaw || "").trim().slice(0, 120) || "unknown vehicle";
}

function matchPickFromLlmSuggestions(userMessage, canonicalList, responseLocale) {
  const list = Array.isArray(canonicalList) ? canonicalList : [];
  if (list.length === 0) return null;
  const trimmed = String(userMessage || "").trim();
  const n = parseInt(trimmed, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= list.length) {
    return list[n - 1];
  }
  const gate = normalizeGateText(userMessage);
  for (const c of list) {
    const lc = String(c || "").toLowerCase();
    const labelRo = normalizeGateText(displayLabelForCanonical(c, "ro"));
    const labelEn = normalizeGateText(displayLabelForCanonical(c, "en"));
    if (gate.includes(lc) || gate.includes(labelRo) || gate.includes(labelEn)) {
      return c;
    }
  }
  if (gate.includes("textil") && list.includes("textile")) return "textile";
  if ((gate.includes("piele") || gate.includes("leather")) && list.includes("leather")) return "leather";
  if (gate.includes("alcantara") && list.includes("alcantara")) return "alcantara";
  if ((gate.includes("vinil") || gate.includes("vinyl") || gate.includes("ecologic")) && list.includes("vinyl")) {
    return "vinyl";
  }
  if (gate.includes("suede") || gate.includes("velur")) {
    if (list.includes("suede")) return "suede";
  }
  const loc = String(responseLocale || "ro").toLowerCase().startsWith("en") ? "en" : "ro";
  for (const c of list) {
    const cto = canonicalToCtoSurface(c);
    if (cto && gate.includes(normalizeGateText(cto))) {
      return c;
    }
    if (loc === "ro" && c === "leather" && gate.includes("piele")) return "leather";
  }
  return null;
}

function buildSuggestionsUserMessage(carLine, canonicalList, responseLocale) {
  const loc = String(responseLocale || "ro").toLowerCase().startsWith("en") ? "en" : "ro";
  const labels = canonicalList.map((c, i) => `${i + 1}) ${displayLabelForCanonical(c, loc)}`);
  const head =
    loc === "en"
      ? `For ${carLine}, common seat upholstery options might be:`
      : `Pentru ${carLine}, scaunele pot fi frecvent:`;
  const tail =
    loc === "en"
      ? "Which case matches yours? (Reply with a number or material name.)"
      : "Care este cazul tau? (Raspunde cu numar sau nume material.)";
  return `${head}\n${labels.join("\n")}\n\n${tail}`;
}

function buildSuggestionUiChips(canonicalList) {
  const chips = (Array.isArray(canonicalList) ? canonicalList : []).map((c) => {
    const cto = canonicalToCtoSurface(c);
    return {
      label: displayLabelForCanonical(c, "ro"),
      value: cto || c
    };
  });
  return {
    type: "chips",
    chipSetId: "surface_llm_advisory_v1",
    chips,
    slotTarget: "surface"
  };
}

/**
 * Advisory only: suggests up to 3 materials; never writes slots.
 */
async function suggestSeatMaterialsAdvisory(carString, opts = {}) {
  const car = String(carString || "").trim();
  if (!car) {
    throw new Error("EMPTY_CAR_STRING");
  }
  const prompt = [
    `For a car: ${car}`,
    "List possible interior seat materials only.",
    'Return JSON array of at most 3 items from: ["textile","alcantara","leather","vinyl","suede"].',
    "No extra text."
  ].join("\n");

  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 2500;
  const raw = await askLLM(prompt, { stage: "surface_assist_llm_advisory", timeoutMs });
  const list = parseLlmMaterialArray(raw);
  if (!list) {
    throw new Error("LLM_PARSE_OR_ALLOWLIST_FAILED");
  }
  return list;
}

module.exports = {
  LLM_ALLOWLIST,
  userSignalsSurfaceMaterialUncertainty,
  parseLlmMaterialArray,
  canonicalToCtoSurface,
  displayLabelForCanonical,
  buildCarLineFromParsed,
  matchPickFromLlmSuggestions,
  buildSuggestionsUserMessage,
  buildSuggestionUiChips,
  suggestSeatMaterialsAdvisory
};
