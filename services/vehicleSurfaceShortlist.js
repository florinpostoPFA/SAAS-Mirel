/**
 * Deterministic vehicle → interior upholstery shortlist (CTO surfaces only).
 * Never assumes a final surface; returns 2–3 candidates in stable order.
 */

const GENERIC_INTERIOR_SHORTLIST = ["textile", "piele", "plastic"];

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function has(hay, needle) {
  const h = norm(hay);
  const n = norm(needle);
  return n.length > 0 && h.includes(n);
}

/**
 * @param {{ vehicleMake?: string|null, vehicleModel?: string|null, vehicleYear?: string|null }} vehicle
 * @returns {string[]} 2–3 entries from CTO interior set: textile | piele | plastic | alcantara
 */
function resolveSurfaceShortlist(vehicle) {
  const make = norm(vehicle?.vehicleMake);
  const model = norm(vehicle?.vehicleModel);
  const year = norm(vehicle?.vehicleYear);

  const rules = [
    {
      surfaces: ["textile", "plastic", "piele"],
      ok: () => has(make, "dacia") && (has(model, "sandero") || has(model, "logan") || has(model, "spring"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () => has(make, "dacia") && has(model, "duster")
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () =>
        (has(make, "volkswagen") || has(make, "vw")) &&
        (has(model, "golf") || has(model, "passat") || has(model, "polo"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () => has(make, "skoda") && (has(model, "octavia") || has(model, "fabia") || has(model, "superb"))
    },
    {
      surfaces: ["piele", "alcantara", "textile"],
      ok: () =>
        has(make, "bmw") &&
        (has(model, "seria") ||
          has(model, "series") ||
          model.includes("320") ||
          model.includes("330") ||
          model.includes("520"))
    },
    {
      surfaces: ["piele", "alcantara", "textile"],
      ok: () =>
        has(make, "mercedes") &&
        (has(model, "c ") ||
          has(model, "cla") ||
          has(model, "e ") ||
          model.startsWith("c") ||
          model.includes("w205"))
    },
    {
      surfaces: ["piele", "alcantara", "textile"],
      ok: () => has(make, "audi") && (has(model, "a4") || has(model, "a3") || has(model, "a6") || has(model, "q5"))
    },
    {
      surfaces: ["textile", "piele", "plastic"],
      ok: () => has(make, "ford") && (has(model, "focus") || has(model, "fiesta") || has(model, "mondeo"))
    },
    {
      surfaces: ["textile", "plastic", "piele"],
      ok: () => has(make, "renault") && (has(model, "clio") || has(model, "megane") || has(model, "captur"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () => has(make, "toyota") && (has(model, "corolla") || has(model, "yaris") || has(model, "rav"))
    },
    {
      surfaces: ["textile", "alcantara", "piele"],
      ok: () => has(make, "tesla") && (has(model, "model") || has(model, "3") || has(model, "y"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () => has(make, "hyundai") && (has(model, "i30") || has(model, "tucson"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () => has(make, "kia") && (has(model, "ceed") || has(model, "sportage"))
    },
    {
      surfaces: ["textile", "piele", "plastic"],
      ok: () => has(make, "opel") && (has(model, "astra") || has(model, "corsa"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () => has(make, "mazda") && (has(model, "3") || has(model, "6") || has(model, "cx"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () =>
        has(make, "nissan") && (has(model, "qashqai") || has(model, "juke") || has(model, "micra"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () => has(make, "honda") && (has(model, "civic") || has(model, "jazz") || has(model, "cr v"))
    },
    {
      surfaces: ["textile", "piele", "alcantara"],
      ok: () =>
        year.length > 0 &&
        has(make, "volvo") &&
        (has(model, "xc") || has(model, "v40") || has(model, "s60"))
    }
  ];

  for (const rule of rules) {
    if (rule.ok()) {
      return rule.surfaces.slice(0, 3);
    }
  }

  return GENERIC_INTERIOR_SHORTLIST.slice(0, 3);
}

module.exports = {
  resolveSurfaceShortlist,
  GENERIC_INTERIOR_SHORTLIST
};
