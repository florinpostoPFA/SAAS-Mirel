/**
 * Rule-based tag keywords + surface-slot vocabulary alignment (PR #11 / tagVocabulary.json).
 * Surface slots must be a superset of Tests/tagVocabulary.json surface axis values they cover.
 */

const SURFACE_SLOT_TO_VOCAB = Object.freeze({
  leather: ["leather_natural", "leather_synthetic", "alcantara"],
  textile: ["textile", "carpet", "headliner"],
  plastic: ["plastic_interior", "plastic_exterior"],
  rubber: ["rubber"],
  glass: ["glass"],
  metal: ["metal", "chrome"],
  paint: ["paint"],
  wheels: ["wheels"],
  tires: ["tires"]
});

const dictionary = {
  interior: [
    "interior",
    "cockpit",
    "bord",
    "cotiera",
    "scaun",
    "tapiterie",
    "volan",
    "plafon",
    "usi interior"
  ],

  exterior: ["exterior", "caroserie"],

  leather: [
    "leather",
    "piele",
    "leather_natural",
    "leather_synthetic",
    "alcantara"
  ],

  textile: [
    "textil",
    "textile",
    "fabric",
    "tapiterie textila",
    "carpet",
    "headliner",
    "mocheta"
  ],

  alcantara: ["alcantara"],

  plastic: ["plastic", "plastic_interior", "plastic_exterior", "trim", "bord"],

  rubber: ["rubber", "cauciuc", "garnituri", "weatherstrip", "seal"],

  glass: ["glass", "geam", "geamuri", "sticla", "parbriz", "luneta"],

  metal: ["metal", "chrome", "crom", "felg", "badge"],

  paint: ["vopsea", "paint", "lac", "caroserie vopsea", "clearcoat"],

  wheels: ["wheels", "wheel", "jante", "janta", "rim", "rims", "roti"],

  tires: ["tires", "tire", "anvelopa", "anvelope", "cauciuc", "tyre", "tyres"],

  cleaning: [
    "clean",
    "cleaner",
    "curata",
    "murdar",
    "pata",
    "praf",
    "lipicios",
    "mizerie"
  ],

  ceramic_coating: ["ceramic", "ceramica", "coating", "ceramic coating"],

  wax: ["ceara", "wax", "carnauba"],

  sealant: ["sealant", "sigilant"],

  polish: ["polish", "polishat", "polishare"],

  protection: ["protect", "seal", "protectie", "protectant"],

  restoration: ["restaurare", "revitalizare"],

  shine: ["luciu", "shine", "gloss"],

  grease: ["grasime", "ulei"],

  smell: ["miros", "odor"]
};

function expandTagForProductMatch(tag) {
  const t = String(tag || "")
    .toLowerCase()
    .trim();
  if (!t) return [];

  const out = new Set([t]);
  const slotVocab = SURFACE_SLOT_TO_VOCAB[t];
  if (slotVocab) {
    slotVocab.forEach((v) => out.add(v));
  }

  for (const [slot, vocabs] of Object.entries(SURFACE_SLOT_TO_VOCAB)) {
    if (vocabs.includes(t)) {
      out.add(slot);
      vocabs.forEach((v) => out.add(v));
    }
  }

  if (t === "leather" || t === "piele") {
    out.add("leather");
    SURFACE_SLOT_TO_VOCAB.leather.forEach((v) => out.add(v));
  }
  if (t === "tire" || t === "anvelopa" || t === "anvelope") {
    out.add("tires");
    SURFACE_SLOT_TO_VOCAB.tires.forEach((v) => out.add(v));
  }
  if (t === "plastic") {
    SURFACE_SLOT_TO_VOCAB.plastic.forEach((v) => out.add(v));
  }

  return [...out];
}

function productTagsSatisfyTag(productTags, requiredTag) {
  const expanded = expandTagForProductMatch(requiredTag);
  const normalized = (Array.isArray(productTags) ? productTags : []).map((tag) =>
    String(tag).toLowerCase()
  );
  return expanded.some((t) => normalized.includes(t));
}

/** Tags emitted when a dictionary slot matches in tagService (surface slots expand to vocab). */
function getEmittedTagsForSlot(slotKey) {
  const key = String(slotKey || "").toLowerCase().trim();
  if (!key) return [];
  const out = new Set([key]);
  const vocab = SURFACE_SLOT_TO_VOCAB[key];
  if (vocab) {
    vocab.forEach((v) => out.add(v));
  }
  return [...out];
}

Object.assign(dictionary, {
  SURFACE_SLOT_TO_VOCAB,
  expandTagForProductMatch,
  productTagsSatisfyTag,
  getEmittedTagsForSlot
});

module.exports = dictionary;
