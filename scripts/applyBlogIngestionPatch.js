#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const KNOWLEDGE_PATH = path.join(ROOT, "data/knowledge.json");
const KNOWLEDGE_FLOW_PATH = path.join(ROOT, "data/knowledge_flow.json");
const PRODUCTS_PATH = path.join(ROOT, "data/products.json");

const CLAY_DUPLICATE_IDS = new Set([
  "clay_bar_purpose",
  "clay_bar_definition",
  "clay_contaminants",
  "clay_how_it_works",
  "clay_bag_test",
  "clay_types",
  "clay_alternatives",
  "clay_steps",
  "clay_frequency",
  "clay_limitations",
  "after_clay_steps",
  "clay_common_mistakes",
  "clay_safety",
  "clay_lubricant",
  "clay_on_new_car"
]);

const NEW_KNOWLEDGE = [
  {
    id: "glass_cleaning",
    title: "Cum cureti geamurile auto",
    content:
      "Pulverizeaza moderat solutia pe geam sau pe laveta dedicata. Sterge uniform cu microfibra curata, apoi finiseaza cu partea uscata pentru claritate. Lucreaza la umbra si evita uscarea produsului pe suprafata.",
    tags: ["geam", "curatare", "interior", "exterior"],
    searchText:
      "cum curat geamurile auto glass cleaner laveta microfibra fara urme",
    source: "manual",
    intent: "informational"
  },
  {
    id: "dressing_water_based_definition",
    title: "Ce este un dressing pe baza de apa",
    content:
      "Dressingul pe baza de apa ofera finisaj natural sau satinat, este sigur pentru interior, atrage mai putin praf si are durabilitate medie.",
    tags: ["dressing", "apa", "interior"],
    searchText: "dressing anvelope pe baza de apa finisaj natural interior",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_solvent_based_definition",
    title: "Ce este un dressing pe baza de solvent",
    content:
      "Dressingul pe baza de solvent ofera wet look, durabilitate mare, rezistenta la apa si penetrare in cauciuc. Nu se foloseste in interior sau in spatii neventilate.",
    tags: ["dressing", "solvent", "exterior", "siguranta"],
    searchText: "dressing anvelope pe baza de solvent wet look exterior",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_water_vs_solvent_table",
    title: "Care este diferenta reala intre dressing apa si solvent",
    content:
      "Apa: aspect natural, praf redus, sigur interior, durabilitate medie. Solvent: luciu intens, durabilitate mare, rezistenta la apa, doar exterior. Alegerea depinde de suprafata, finisaj dorit si expunere.",
    tags: ["dressing", "comparatie"],
    searchText:
      "diferenta dressing anvelope apa vs solvent aspect durabilitate cel mai bun dressing anvelope auto",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_selection_strategy",
    title: "Care este strategia profesionala pentru dressing",
    content:
      "Foloseste dressing pe baza de apa pentru trim si plastic interior. Pentru anvelope exterior foloseste dressing pe baza de solvent. Nu folosi acelasi produs peste tot.",
    tags: ["dressing", "strategie", "profesional"],
    searchText: "strategie dressing interior apa anvelope solvent dressing interior natural fara luciu",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_tire_mistakes",
    title: "Care sunt greselile frecvente la dressing anvelope",
    content:
      "Greseli comune: solvent in interior, aplicare pe murdarie, exces de produs si lipsa pregatirii suprafetei inainte de dressing.",
    tags: ["dressing", "greseli", "anvelope"],
    searchText: "greseli dressing anvelope solvent interior exces dressing solvent periculos",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_faq_water_vs_solvent",
    title: "FAQ: care este mai bun dressing apa sau solvent",
    content:
      "Niciunul nu este universal mai bun. Alegerea depinde de suprafata si finisajul dorit: apa pentru interior natural, solvent pentru anvelope si wet look exterior.",
    tags: ["dressing", "faq"],
    searchText: "care e mai bun dressing apa sau solvent anvelope",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_faq_solvent_danger",
    title: "FAQ: dressingul solvent este periculos",
    content:
      "Folosit corect, ventilat si pe exterior, dressingul solvent este sigur. Evita-l in habitaclu sau in spatii inchise neventilate.",
    tags: ["dressing", "faq", "siguranta"],
    searchText: "dressing solvent periculos anvelope interior",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_faq_water_on_tires",
    title: "FAQ: pot folosi dressing apa pe anvelope",
    content:
      "Da, dressingul pe baza de apa poate fi folosit pe anvelope, dar durabilitatea este mai mica decat la un dressing pe baza de solvent.",
    tags: ["dressing", "faq", "anvelope"],
    searchText: "pot folosi dressing apa pe anvelope durabilitate dressing anvelope wet look",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_faq_solvent_durability",
    title: "FAQ: de ce rezista mai mult dressingul solvent",
    content:
      "Solventul adera mai bine la cauciuc si ofera rezistenta superioara la apa si spalari, de aceea tine mai mult pe anvelope expuse.",
    tags: ["dressing", "faq"],
    searchText: "de ce rezista mai mult dressing solvent anvelope",
    source: "blog",
    intent: "informational"
  },
  {
    id: "dressing_anvelope",
    title: "Cum alegi dressing pentru anvelope",
    content:
      "Dupa curatare, pentru anvelope exterior alege dressing pe baza de solvent (ex. Tyre Dressing). Pentru trim interior foloseste dressing pe baza de apa (ex. Keno Dressing). Nu folosi solvent in habitaclu.",
    tags: ["dressing", "anvelope", "flow"],
    searchText: "ce dressing pun pe anvelope dupa curatare wet look",
    source: "blog",
    intent: "informational"
  },
  {
    id: "modern_leather_wear_bmw",
    title: "De ce pielea moderna BMW se uzeaza mai repede",
    content:
      "Pielea moderna de pe BMW (G20, G30, G05, G06, G07, i4, iX) si unele Mercedes se uzeaza la mii de km, spre deosebire de pielea veche care rezista peste 100.000 km.",
    tags: ["piele", "bmw", "uzura"],
    searchText: "uzura piele bmw moderna sensibila cotiera piele bmw moderna sensibila intretinere piele auto bmw",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_high_wear_zones",
    title: "Care sunt zonele de piele care se uzeaza primele",
    content:
      "Zonele cu uzura ridicata sunt cotiera centrala, manerele usilor si aripa scaunului soferului.",
    tags: ["piele", "uzura", "zone"],
    searchText: "uzura cotiera bmw manere usi scaun sofer",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_clean_quality_check",
    title: "Cum verifici ca pielea este curata",
    content:
      "Pielea curata arata mat sau satinata, fara grasime. Verifica cusaturile, cutele si canturile unde ramane murdarie ascunsa.",
    tags: ["piele", "curatare", "verificare"],
    searchText: "cum stiu ca pielea e curata cusaturi cute cu ce se curata pielea auto",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_mistake_hot_surface",
    title: "Greseala: curatare piele in soare sau pe suprafata fierbinte",
    content:
      "Curatarea pe suprafata fierbinte usuca prematur produsul si fixeaza murdaria in material.",
    tags: ["piele", "greseli", "siguranta"],
    searchText: "curatare piele soare suprafata fierbinte gresit",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_mistake_aggressive_tools",
    title: "Greseala: accesorii agresive pe piele",
    content:
      "Magic Sponge, perii dure sau accesorii abrazive pe piele cu strat protector accelereaza uzura si deteriorarea finisajului.",
    tags: ["piele", "greseli", "siguranta"],
    searchText: "magic sponge piele auto periculos scrub agresiv",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_mistake_excess_shine",
    title: "Greseala: luciu excesiv pe piele",
    content:
      "Luciul excesiv indica adesea siliconi sau supraincarcare. Pielea OEM moderna trebuie sa ramana mata, nu lucioasa.",
    tags: ["piele", "greseli"],
    searchText: "pielea auto devine lucioasa siliconi gresit pielea nu trebuie lucioasa",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_protection_vs_hydration",
    title: "Protejie vs hidratare pe pielea moderna",
    content:
      "Pe pielea OEM moderna, protectia (ex. L1 Leather Guard) este mai importanta decat hidratarea clasica. Finisajul corect este mat, nu lucios.",
    tags: ["piele", "protectie", "hidratare"],
    searchText: "protejez sau hidratez pielea auto moderna",
    source: "blog",
    intent: "informational",
    variantOf: "protectie_piele_auto"
  },
  {
    id: "leather_maintenance_frequency",
    title: "Cat de des intretii pielea auto",
    content:
      "Mentenanta usoara lunar cu Leather QD. Curatare completa la fiecare 3-6 luni, in functie de utilizare.",
    tags: ["piele", "intretinere"],
    searchText:
      "cat de des curat pielea auto intretinere lunara intretinere piele lunara",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_workflow_complete",
    title: "Workflow complet curatare si protectie piele",
    content:
      "Aspirare, curatare cu Leather Cleaner si Scrub Bar, stergere si clatire, ventilare, apoi protectie (L1) sau mentenanta (Leather QD) si timp de curing.",
    tags: ["piele", "workflow", "procedura"],
    searchText: "cu ce se curata pielea auto workflow complet",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_faq_wet_wipes",
    title: "FAQ: servetele umede pe piele auto",
    content:
      "Servetele umede nu sunt intretinere sigura pentru piele. Lasă reziduuri, usuca materialul si accelereaza uzura.",
    tags: ["piele", "faq", "greseli"],
    searchText: "servetele umede piele auto periculos alternativa servetele umede piele",
    source: "blog",
    intent: "informational"
  },
  {
    id: "leather_faq_slippery_after_protect",
    title: "FAQ: piele alunecoasa dupa protectie",
    content:
      "Alunecarea apare de obicei din aplicare neuniforma sau exces de produs. Sterge excesul si aplica un strat subtiu uniform.",
    tags: ["piele", "faq"],
    searchText: "piele alunecoasa dupa protectie gresit aplicata",
    source: "blog",
    intent: "informational"
  },
  {
    id: "upholstery_no_universal_product",
    title: "Nu exista o singura solutie pentru toate materialele din tapiterie",
    content:
      "Textilul, Alcantara si pielea necesita produse si tehnici diferite. Nu exista un singur produs universal pentru toate suprafetele.",
    tags: ["tapiterie", "textile", "piele", "alcantara"],
    searchText:
      "aceeasi solutie textil si piele tapiterie auto cea mai buna solutie de curatat tapiteria auto curatare tapiterie auto",
    source: "blog",
    intent: "informational"
  },
  {
    id: "apc_dwell_time_importance",
    title: "APC trebuie lasat 3-5 minute inainte de clatire",
    content:
      "Greseala frecventa este clatirea imediata. Lasa APC-ul sa actioneze 3-5 minute inainte de agitatie si stergere sau extractie.",
    tags: ["apc", "textile", "greseli"],
    searchText:
      "cat timp las apc sa actioneze textile 3 5 minute cat timp las apc sa actioneze",
    source: "blog",
    intent: "informational"
  },
  {
    id: "textile_prep_before_clean",
    title: "Pregatirea textilelor inainte de curatare",
    content:
      "Secventa recomandata: aspirare, aer comprimat, periere alama, re-aspirare, apoi degresare cu solutia potrivita.",
    tags: ["textile", "pregatire", "procedura"],
    searchText: "pregatire mocheta inainte curatare aspirare aer comprimat",
    source: "blog",
    intent: "informational"
  },
  {
    id: "extractor_misuse_interior",
    title: "Greseli comune cu aspiratorul injectie-extractie",
    content:
      "Prea multa apa, presiune mare si lipsa extractiei complete duc la tapiterie tare, mirosuri si reziduuri in material.",
    tags: ["extractor", "greseli", "textile"],
    searchText:
      "greseli extractor injectie extractie prea multa apa pot folosi extractor pe plafon",
    source: "blog",
    intent: "informational"
  },
  {
    id: "difficult_interior_stains",
    title: "Pete grele in interiorul auto",
    content:
      "Motorina, benzina, pigmentare de cauciuc pe piele deschisa si unele depigmentari pot fi ireversibile. Necesita produse dedicate si uneori atelier.",
    tags: ["pete", "textile", "piele", "limitari"],
    searchText: "pete motorina benzina tapiterie auto greu de scos pete tapiterie auto",
    source: "blog",
    intent: "informational"
  },
  {
    id: "pol_star_not_universal",
    title: "Pol Star nu inlocuieste produsele dedicate per material",
    content:
      "Pol Star nu este un best all-rounder pentru textil, piele si Alcantara. Pentru rezultate sigure foloseste produse dedicate fiecarui material.",
    tags: ["pol star", "greseli", "produse"],
    searchText: "pol star universal textil piele alcantara overrated textile sensibile nu pol star universal",
    source: "blog",
    intent: "informational"
  },
  {
    id: "diy_vs_professional_upholstery",
    title: "Cand poti curata tapiteria acasa si cand ai nevoie de atelier",
    content:
      "DIY pentru intretinere usoara. Atelier pentru marker, mirosuri persistente si extractie profunda.",
    tags: ["tapiterie", "diy", "profesional"],
    searchText: "pot curata tapiteria acasa sau atelier detailing cum miroase tapiteria curatata",
    source: "blog",
    intent: "informational"
  },
  {
    id: "interior_maintenance_minimal_setup",
    title: "Setup minim pentru intretinerea interiorului",
    content:
      "Pentru intretinere acasa: Interior QD, Leather QD, Scrub Bar, microfibre dedicate si solutie pentru geam.",
    tags: ["intretinere", "interior", "produse"],
    searchText: "setup minim intretinere interior auto acasa",
    source: "blog",
    intent: "informational"
  },
  {
    id: "upholstery_faq_same_product",
    title: "FAQ: pot folosi aceeasi solutie pe textil si piele",
    content:
      "Nu este recomandat. Pielea sensibila nu tolereaza APC agresiv folosit pentru textile murdare.",
    tags: ["tapiterie", "faq"],
    searchText: "pot folosi aceeasi solutie pe textil si piele",
    source: "blog",
    intent: "informational"
  },
  {
    id: "upholstery_faq_stiff_after_clean",
    title: "FAQ: de ce ramane tapiteria tare dupa curatare",
    content:
      "Rigiditatea apare din reziduuri si apa ramasa in material. Lipseste extractia sau stergerea completa dupa curatare.",
    tags: ["tapiterie", "faq", "textile"],
    searchText: "tapiteria ramane tare dupa curatare rigiditate",
    source: "blog",
    intent: "informational"
  },
  {
    id: "headliner_delamination_causes",
    title: "De ce se dezlipieste plafonul auto",
    content:
      "Dezlipirea apare din metoda gresita de curatare (prea multa apa, extractor, APC agresiv), nu doar din varsta materialului.",
    tags: ["plafon", "headliner", "siguranta"],
    searchText: "de ce se dezlipieste plafonul auto cauze plafon auto dezlipit",
    source: "blog",
    intent: "informational"
  },
  {
    id: "headliner_pressure_test",
    title: "Test de presiune inainte de curatarea plafonului",
    content:
      "Apasa usor cu degetul: daca materialul revine imediat, poti continua cu metoda low-moisture. Daca ramane apasat, opreste curatarea umeda.",
    tags: ["plafon", "siguranta", "test"],
    searchText:
      "test presiune plafon auto apasare deget test plafon auto apasare curatare plafon fara dezlipire",
    source: "blog",
    intent: "informational"
  },
  {
    id: "headliner_sensitive_vehicles",
    title: "Ce vehicule au plafon sensibil",
    content:
      "Atentie la Porsche/VAG de circa 10 ani, plafon panoramic si la vehicule cu infiltratii de apa sau mucegai.",
    tags: ["plafon", "siguranta", "limitari"],
    searchText: "plafon auto sensibil porsche vag panoramic plafon alcantara curatare sigura",
    source: "blog",
    intent: "informational"
  },
  {
    id: "headliner_avoid_extractor",
    title: "De ce injector-extractorul este periculos pe plafon",
    content:
      "Saturarea cu apa distruge adezivul spumei de suport si provoaca dezlipirea plafonului.",
    tags: ["plafon", "extractor", "greseli", "siguranta"],
    searchText: "pot folosi extractor pe plafon auto periculos",
    source: "blog",
    intent: "informational"
  },
  {
    id: "headliner_bonnet_mitt_method",
    title: "Metoda Bonnet cu scrub mitt si Dodger pentru plafon",
    content:
      "Aplica Bonnet pe scrub mitt, nu direct pe plafon. Lucreaza zone de 40x40 cm si sterge imediat cu laveta tehnica Dodger.",
    tags: ["plafon", "procedura", "bonnet"],
    searchText:
      "curatare plafon bonnet scrub mitt dodger cum curat plafonul auto curatare plafon bonnet mitt",
    source: "blog",
    intent: "informational"
  },
  {
    id: "headliner_moisture_control",
    title: "Controlul umiditatii la curatarea plafonului",
    content:
      "Suprafata trebuie sa ramana usor umeda, nu ud. Clateste mitt-ul in apa rece max 35 grade si foloseste aer comprimat dupa stergere.",
    tags: ["plafon", "umiditate", "tehnica"],
    searchText: "cat de uda suprafata plafon auto curatare",
    source: "blog",
    intent: "informational"
  },
  {
    id: "headliner_finishing_fiber_direction",
    title: "Finisarea plafonului dupa curatare",
    content:
      "Lucreaza fibra intr-un singur sens, fara presiune, pentru a pastra textura si adezivul intact.",
    tags: ["plafon", "finisare"],
    searchText: "finisare plafon auto directie fibra fara presiune",
    source: "blog",
    intent: "informational"
  },
  {
    id: "headliner_common_mistakes",
    title: "Greseli frecvente la curatarea plafonului",
    content:
      "Evita apa in excess, APC agresiv, perii dure si pulverizarea directa abundenta pe plafon.",
    tags: ["plafon", "greseli", "siguranta"],
    searchText: "greseli curatare plafon dezlipire apa apc",
    source: "blog",
    intent: "informational"
  }
];

const NEW_KNOWLEDGE_FLOW = [
  {
    id: "glass_cleaning",
    title: "Cum cureti geamurile auto",
    content:
      "Pulverizeaza moderat solutia pe geam sau pe laveta dedicata. Sterge uniform cu microfibra curata, apoi finiseaza cu partea uscata pentru claritate."
  },
  {
    id: "dressing_anvelope",
    title: "Aplicare dressing anvelope",
    content:
      "Aplica dressing pe anvelope curate si uscate. Exterior: prefera solvent pentru durabilitate; trim interior: dressing pe baza de apa; evita solvent in habitaclu."
  },
  {
    id: "dressing_water_vs_solvent_choice",
    title: "Alegere dressing apa vs solvent",
    content:
      "Alege dupa suprafata: apa pentru finisaj natural interior; solvent pentru anvelope si plastic exterior si wet look."
  },
  {
    id: "leather_modern_protection_first",
    title: "Protectie pe pielea OEM moderna",
    content:
      "Dupa curatare, aplica protectie mata (ex. L1) in strat subtire uniform. Hidratarea clasica este secundara pe pielea moderna."
  },
  {
    id: "textile_apc_dwell_time",
    title: "Timp de actiune APC pe textile",
    content:
      "Pulverizeaza APC uniform, lasa 3-5 minute sa actioneze, apoi agita si sterge sau extrage; nu clati imediat."
  },
  {
    id: "alcantara_mitt_clean",
    title: "Curatare Alcantara cu scrub mitt",
    content:
      "Foloseste spuma fina si scrub mitt cu presiune redusa. Evita perii dure, dressing si hidratare de piele pe Alcantara."
  },
  {
    id: "headliner_pressure_test",
    title: "Test integritate plafon",
    content:
      "Apasa usor cu degetul: daca materialul nu revine, opreste curatarea umeda."
  },
  {
    id: "headliner_low_moisture_clean",
    title: "Curatare plafon low-moisture",
    content:
      "Aplica solutie low-moisture pe scrub mitt, lucreaza zone 40x40 cm, sterge imediat cu laveta tehnica."
  },
  {
    id: "headliner_no_extractor",
    title: "Fara extractor pe plafon",
    content:
      "Nu folosi injector-extractor pe plafon; risc de dezlipire al adezivului."
  }
];

const SYNC_FLOW_FROM_KNOWLEDGE = [
  "insect_remover_utilizare",
  "arsuri_insecte_corectie",
  "curatare_jante_indicator_rosu",
  "solutie_jante_acida",
  "tire_rubber_cleaner_utilizare"
];

const PRODUCT_LANGUAGE = {
  "00.0913.15.0005781": [
    "dressing apa vs solvent diferenta",
    "dressing interior natural fara luciu",
    "dressing trim interior nu pe anvelope wet look"
  ],
  "00.0587.15.0004316": [
    "dressing anvelope wet look durabil",
    "dressing solvent anvelope exterior",
    "nu folosi in interior habitaclu"
  ],
  L1AB: [
    "protectie piele bmw modern",
    "pielea nu trebuie lucioasa",
    "protectie mat piele oem"
  ],
  "ADBL-Leather": [
    "intretinere piele lunara",
    "alternativa servetele umede piele",
    "mentenanta usoara piele dupa curatare"
  ],
  "ADB-LC": [
    "curatare piele bmw fara luciu",
    "piele curata mat satin verificare cusaturi"
  ],
  "00.0453.20.0003228": [
    "solutie textile foarte murdare",
    "curatare alcantara kenotek",
    "textile grele nu acelasi produs ca piele"
  ],
  "ADB-TYP": [
    "apc profesional textile si plastice",
    "cat timp las apc sa actioneze",
    "nu clati imediat lasa 3 minute"
  ],
  "ADB-B": [
    "textile sensibile nu pol star universal",
    "curatare plafon fara dezlipire",
    "test presiune plafon auto",
    "nu pulveriza direct pe plafon bonnet pe manusa"
  ],
  ADB000124: [
    "laveta tehnica stergere plafon dupa curatare",
    "sterge imediat dupa mitt plafon"
  ],
  ADB000615: [
    "manusa curatare plafon low moisture",
    "bonnet pe manusa nu direct pe plafon"
  ]
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function patchKnowledge(knowledge) {
  const seenClay = new Set();
  let removedClay = 0;
  let renamedTowel = false;
  let renamedTechnique = false;

  const patched = [];

  for (const entry of knowledge) {
    const id = entry.id;

    if (CLAY_DUPLICATE_IDS.has(id)) {
      if (seenClay.has(id)) {
        removedClay += 1;
        continue;
      }
      seenClay.add(id);
    }

    if (id === "car_drying_faq") {
      if (!renamedTowel) {
        patched.push({ ...entry, id: "car_drying_towel_faq" });
        renamedTowel = true;
        continue;
      }
      if (!renamedTechnique) {
        patched.push({ ...entry, id: "car_drying_technique_faq" });
        renamedTechnique = true;
        continue;
      }
    }

    if (id === "alcantara_cleaning_method") {
      patched.push({
        ...entry,
        content:
          "Pentru Alcantara foloseste scrub mitt sau agitatie foarte blanda cu spuma fina. Materialul este sensibil; evita perii dure si scrub bar agresiv.",
        searchText:
          "cum curat alcantara auto fara sa o stric scrub mitt curatare alcantara auto"
      });
      continue;
    }

    if (id === "scrub_bar_usage_areas") {
      patched.push({
        ...entry,
        content:
          "Scrub Bar poate fi utilizat pe textile, piele, plastic si cauciuc pentru zone mari si murdare persistenta. Nu pe plafon/headliner decat dupa test de presiune si cu metoda low-moisture.",
        searchText:
          "unde folosesc scrub bar interior masina textile piele plastic plafon headliner atentie"
      });
      continue;
    }

    patched.push(entry);
  }

  const existingIds = new Set(patched.map((e) => e.id));
  let added = 0;
  for (const entry of NEW_KNOWLEDGE) {
    if (existingIds.has(entry.id)) continue;
    patched.push(entry);
    existingIds.add(entry.id);
    added += 1;
  }

  return { knowledge: patched, removedClay, added, renamedTowel, renamedTechnique };
}

function patchKnowledgeFlow(knowledgeFlow, knowledgeById) {
  const byId = new Map(knowledgeFlow.map((e) => [e.id, e]));
  let added = 0;
  let synced = 0;

  for (const entry of NEW_KNOWLEDGE_FLOW) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry);
      added += 1;
    }
  }

  for (const id of SYNC_FLOW_FROM_KNOWLEDGE) {
    const source = knowledgeById.get(id);
    if (!source) continue;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        title: source.title,
        content: source.content
      });
      synced += 1;
    }
  }

  return {
    knowledgeFlow: Array.from(byId.values()),
    added,
    synced
  };
}

function patchProducts(products) {
  let updatedProducts = 0;
  let addedPhrases = 0;

  for (const product of products) {
    const phrases = PRODUCT_LANGUAGE[product.id];
    if (!phrases) continue;

    product.applicability = product.applicability || {};
    const existing = product.applicability.customer_language || [];
    const set = new Set(existing);
    let changed = false;

    for (const phrase of phrases) {
      if (!set.has(phrase)) {
        existing.push(phrase);
        set.add(phrase);
        addedPhrases += 1;
        changed = true;
      }
    }

    if (changed) {
      product.applicability.customer_language = existing;
      updatedProducts += 1;
    }
  }

  return { updatedProducts, addedPhrases };
}

function main() {
  const knowledge = readJson(KNOWLEDGE_PATH);
  const {
    knowledge: patchedKnowledge,
    removedClay,
    added: addedKnowledge,
    renamedTowel,
    renamedTechnique
  } = patchKnowledge(knowledge);

  const knowledgeById = new Map(patchedKnowledge.map((e) => [e.id, e]));
  const knowledgeFlow = readJson(KNOWLEDGE_FLOW_PATH);
  const {
    knowledgeFlow: patchedFlow,
    added: addedFlow,
    synced: syncedFlow
  } = patchKnowledgeFlow(knowledgeFlow, knowledgeById);

  const products = readJson(PRODUCTS_PATH);
  const { updatedProducts, addedPhrases } = patchProducts(products);

  writeJson(KNOWLEDGE_PATH, patchedKnowledge);
  writeJson(KNOWLEDGE_FLOW_PATH, patchedFlow);
  writeJson(PRODUCTS_PATH, products);

  const ids = patchedKnowledge.map((e) => e.id);
  const unique = new Set(ids);

  console.log(
    JSON.stringify(
      {
        knowledge: {
          before: knowledge.length,
          after: patchedKnowledge.length,
          unique: unique.size,
          removedClayDuplicates: removedClay,
          addedEntries: addedKnowledge,
          splitCarDryingFaq: renamedTowel && renamedTechnique
        },
        knowledgeFlow: {
          before: knowledgeFlow.length,
          after: patchedFlow.length,
          addedEntries: addedFlow,
          syncedFromKnowledge: syncedFlow
        },
        products: {
          updatedSkus: updatedProducts,
          addedPhrases
        },
        idsUnique: ids.length === unique.size
      },
      null,
      2
    )
  );

  if (ids.length !== unique.size) {
    process.exit(1);
  }
}

main();
