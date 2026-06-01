"use strict";

const PHONE_STRICT = /^(\+?40|0)\s?7\d{2}\s?\d{3}\s?\d{3}$/;
const PHONE_LOOSE = /^\+?\d{9,12}$/;
const EMAIL = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

function stripPhoneSeparators(text) {
  return String(text || "").replace(/[\s-]/g, "");
}

/**
 * @param {string} text
 * @param {{ loose?: boolean }} [opts]
 * @returns {{ type: "phone", value: string } | null}
 */
const PHONE_STRICT_COMPACT = /^(\+?40|0)7\d{8}$/;

function parsePhone(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const compact = stripPhoneSeparators(raw);
  if (opts.loose) {
    if (!PHONE_LOOSE.test(compact)) return null;
  } else if (!PHONE_STRICT.test(raw) && !PHONE_STRICT_COMPACT.test(compact)) {
    return null;
  }
  return { type: "phone", value: normalizePhoneE164(compact) };
}

/**
 * @param {string} text
 * @returns {{ type: "email", value: string } | null}
 */
function parseEmail(text) {
  const raw = String(text || "").trim();
  if (!raw || !EMAIL.test(raw)) {
    return null;
  }
  return { type: "email", value: raw.toLowerCase() };
}

/**
 * @param {string} text
 * @param {{ loose?: boolean }} [opts]
 * @returns {{ type: "phone"|"email", value: string } | null}
 */
function parseContact(text, opts = {}) {
  return parseEmail(text) || parsePhone(text, opts);
}

function normalizePhoneE164(compact) {
  let digits = compact.replace(/\D/g, "");
  if (digits.startsWith("40") && digits.length === 11) {
    return `+${digits}`;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `+4${digits}`;
  }
  if (digits.length === 9 && digits.startsWith("7")) {
    return `+40${digits}`;
  }
  return compact.startsWith("+") ? compact : `+${digits}`;
}

module.exports = {
  parsePhone,
  parseEmail,
  parseContact,
  normalizePhoneE164,
  PHONE_STRICT,
  PHONE_LOOSE,
  EMAIL
};
