/**
 * P1.9 — Deterministic response shells for Safety / Flow / Selection (copy-only wrappers).
 * Centralizes structure; core facts still come from existing builders.
 */

function normalizeLoc(locale) {
  const s = String(locale || "ro").toLowerCase();
  return s === "en" ? "en" : "ro";
}

/**
 * @param {string} answerCore — headline + body from safety analysis (RO)
 */
function formatSafetyReplyRo(answerCore) {
  const core = String(answerCore || "").trim();
  return [
    "— Siguranță —",
    core,
    "",
    "Condiții: respectă diluția și instrucțiunile producătorului; test discret; timp scurt de acțiune; clătire completă.",
    "Pas următor: spune suprafața și produsul chimic dacă vrei pași mai precisi."
  ].join("\n");
}

/**
 * @param {{ title?: string, body: string, locale?: string }} opts
 */
function formatFlowReply(opts = {}) {
  const loc = normalizeLoc(opts.locale);
  const title = String(opts.title || "").trim();
  const body = String(opts.body || "").trim();
  const header =
    loc === "en"
      ? "— Guided steps —"
      : "— Flux recomandat —";
  const footer =
    loc === "en"
      ? "Tip: follow product labels; if anything stings or dulls the finish, rinse immediately."
      : "Sfat: urmează eticheta produsului; dacă observi efecte nedorite, clătește imediat.";
  const lines = [header];
  if (title) {
    lines.push(loc === "en" ? `Topic: ${title}` : `Subiect: ${title}`);
    lines.push("");
  }
  lines.push(body);
  lines.push("");
  lines.push(footer);
  return lines.join("\n");
}

/**
 * @param {{ body: string, narrowingQuestion?: string, locale?: string }} opts
 */
function formatSelectionReply(opts = {}) {
  const loc = normalizeLoc(opts.locale);
  const body = String(opts.body || "").trim();
  const nq =
    opts.narrowingQuestion != null && String(opts.narrowingQuestion).trim() !== ""
      ? String(opts.narrowingQuestion).trim()
      : loc === "en"
        ? "One detail: which finish or soil level should we optimize for (light / heavy)?"
        : "Un detaliu: ce tip de murdărie sau finisaj vrei să prioritizăm (ușoară / grea)?";
  const lines = [
    loc === "en" ? "— Product picks —" : "— Recomandări produse —",
    body,
    "",
    loc === "en" ? "Narrowing:" : "Clarificare:",
    nq
  ];
  return lines.join("\n");
}

module.exports = {
  formatSafetyReplyRo,
  formatFlowReply,
  formatSelectionReply
};
