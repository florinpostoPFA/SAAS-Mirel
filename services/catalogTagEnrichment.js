/**
 * Step 5b Phase 3 — Lever 2: deterministic catalog-signal enrichment after LLM tagging.
 * Uses name + description + short_description + meta_keyword (not broad keyword union).
 */

const PURPOSE_TAGS = new Set([
  "cleaning",
  "decontamination",
  "polish",
  "protection",
  "coating",
  "conditioning",
  "restoration",
  "neutralization"
]);

const PRODUCT_TYPE_TAGS = new Set([
  "shampoo",
  "snow_foam",
  "apc",
  "wheel_cleaner",
  "tire_cleaner",
  "tire_dressing",
  "trim_dressing",
  "leather_cleaner",
  "leather_conditioner",
  "glass_cleaner",
  "interior_cleaner",
  "iron_remover",
  "tar_remover",
  "bug_remover",
  "clay_bar",
  "polish_compound",
  "wax",
  "sealant",
  "ceramic_coating",
  "quick_detailer",
  "fabric_protectant",
  "rubber_protectant",
  "air_freshener"
]);

/**
 * @param {{ name?: string, description?: string, short_description?: string, meta_keyword?: string, searchText?: string }} product
 */
function collectEnrichmentText(product) {
  return [
    product?.name,
    product?.description,
    product?.short_description,
    product?.meta_keyword,
    product?.searchText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasTag(tags, name) {
  return tags.includes(name);
}

function setPurpose(tags, purpose) {
  const withoutPurpose = tags.filter((tag) => !PURPOSE_TAGS.has(tag));
  return [...withoutPurpose, purpose];
}

function setProductType(tags, productType) {
  const withoutType = tags.filter((tag) => !PRODUCT_TYPE_TAGS.has(tag));
  return [...withoutType, productType];
}

/**
 * @param {{ name?: string, description?: string, short_description?: string, meta_keyword?: string, searchText?: string }} product
 * @param {string[]} tags normalized tag list
 * @returns {string[]}
 */
function enrichTagsFromCatalogSignals(product, tags) {
  const text = collectEnrichmentText(product);
  let working = [...tags];
  const concentrateSignal = /\b(concentrat|concentrate|diluat|dilution|diluabil)\b/.test(text);

  const isGlassProduct =
    hasTag(working, "glass") ||
    hasTag(working, "glass_cleaner") ||
    /\b(sticla|geamuri|geam|glass cleaner)\b/.test(text);
  const interiorOnlyGlass = /\b(doar|numai)\s+interior\b|\binterior[- ]only\b/.test(text);

  if (isGlassProduct && !interiorOnlyGlass) {
    working = working.filter((tag) => tag !== "interior");
    if (!hasTag(working, "exterior")) {
      working.push("exterior");
    }
    if (hasTag(working, "glass_cleaner")) {
      working = working.filter(
        (tag) =>
          ![
            "leather_natural",
            "leather_synthetic",
            "plastic_interior",
            "textile",
            "alcantara"
          ].includes(tag)
      );
    }
  }

  const ironDeconSignal =
    /\b(iron|fallout|felgenblitz|reactive wheel|particule\s+metal|indicator\s+rosu)\b/.test(text) ||
    (/\bdecontaminare jante\b/.test(text) && !/\bcuratare jante\b/.test(text));

  const acidicWheelCleaner =
    hasTag(working, "wheels") &&
    /\b(acid|acidic)\b/.test(text) &&
    /\b(curatare jante|felgenreiniger|wheel cleaner|reiniger)\b/.test(text) &&
    !/\b(iron|fallout|reactive|felgenblitz)\b/.test(text);

  if (acidicWheelCleaner) {
    working = setPurpose(working, "cleaning");
    working = setProductType(working, "wheel_cleaner");
    if (!hasTag(working, "acidic")) working.push("acidic");
    if (!hasTag(working, "uncoated_only")) working.push("uncoated_only");
  } else if (ironDeconSignal && hasTag(working, "wheels")) {
    working = setPurpose(working, "decontamination");
    working = setProductType(working, "iron_remover");
  }

  if (/\b(gel\s+acid|wheel\s+warrior)\b/.test(text) && hasTag(working, "wheels")) {
    working = setPurpose(working, "decontamination");
    working = setProductType(working, "iron_remover");
    if (!hasTag(working, "acidic")) working.push("acidic");
    if (!hasTag(working, "uncoated_only")) working.push("uncoated_only");
  }

  if (/\bpol\s*star\b/.test(text)) {
    const polStarTags = [
      "interior",
      "textile",
      "alcantara",
      "leather_natural",
      "leather_synthetic",
      "cleaning",
      "interior_cleaner",
      "ph_neutral",
      "concentrate"
    ];
    const merged = new Set([...working, ...polStarTags]);
    working = [...merged];
  }

  const trimDressing = hasTag(working, "trim_dressing");
  const productName = String(product.name || "").toLowerCase();
  const cleaningInName = /\b(curatare|cleaner|cleaning|solutie curatare)\b/.test(productName);
  const protectionInName = /\bprotectie\b/.test(productName);
  const matteDressingSignal = /\b(dressing mat|semi-mat|semi mat|gummifix|top star)\b/.test(
    text
  );

  if (trimDressing && !cleaningInName && matteDressingSignal && !protectionInName) {
    working = setPurpose(working, "conditioning");
  } else if (trimDressing && !cleaningInName && protectionInName) {
    working = setPurpose(working, "protection");
  }

  const isLeatherCare =
    hasTag(working, "leather_conditioner") ||
    hasTag(working, "leather_cleaner") ||
    (/\bpiele\b/.test(text) && hasTag(working, "leather_natural"));
  if (isLeatherCare) {
    working = working.filter((tag) => tag !== "exterior");
    if (!hasTag(working, "interior")) {
      working.push("interior");
    }
  }

  if (concentrateSignal) {
    if (!hasTag(working, "concentrate")) working.push("concentrate");
    working = working.filter((tag) => tag !== "ready_to_use");
  }

  if (/\b(gata de folosire|ready to use|ready_to_use|nu trebuie diluat)\b/.test(text)) {
    if (!hasTag(working, "concentrate")) {
      if (!hasTag(working, "ready_to_use")) working.push("ready_to_use");
    }
  }

  if (/\b(coating safe|coating_safe|ceramic|sigur.*coating|lac ceramic)\b/.test(text)) {
    if (!hasTag(working, "coating_safe")) working.push("coating_safe");
  }

  if (hasTag(working, "wheels") && /\b(acid|acidic|gel acid)\b/.test(text)) {
    if (!hasTag(working, "uncoated_only")) working.push("uncoated_only");
    if (!hasTag(working, "ready_to_use") && !concentrateSignal) {
      working.push("ready_to_use");
    }
  }

  if (
    hasTag(working, "wheels") &&
    (hasTag(working, "iron_remover") || hasTag(working, "wheel_cleaner")) &&
    hasTag(working, "ph_neutral") &&
    !hasTag(working, "uncoated_only")
  ) {
    if (!hasTag(working, "coating_safe")) working.push("coating_safe");
  }

  if (isGlassProduct && /\b(gtechniq|coating|ceramic)\b/.test(text)) {
    if (!hasTag(working, "coating_safe")) working.push("coating_safe");
  }

  if (!concentrateSignal && !hasTag(working, "concentrate")) {
    const needsRtu =
      hasTag(working, "tire_dressing") ||
      hasTag(working, "trim_dressing") ||
      hasTag(working, "glass_cleaner") ||
      hasTag(working, "wheel_cleaner") ||
      hasTag(working, "leather_conditioner") ||
      hasTag(working, "interior_cleaner");
    if (needsRtu && !hasTag(working, "ready_to_use")) {
      working.push("ready_to_use");
    }
  }

  if (hasTag(working, "concentrate")) {
    working = working.filter((tag) => tag !== "ready_to_use");
  }

  return working;
}

module.exports = {
  collectEnrichmentText,
  enrichTagsFromCatalogSignals,
  PURPOSE_TAGS,
  PRODUCT_TYPE_TAGS
};
