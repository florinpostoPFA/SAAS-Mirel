function redactSensitiveText(input) {
  const source = String(input || "");
  return source
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d\s\-().]{7,}\d/g, "[REDACTED_PHONE]");
}

function truncateText(input, maxLength = 120) {
  const source = String(input || "").trim();
  if (source.length <= maxLength) return source;
  return `${source.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sanitizePreview(input, maxLength = 120) {
  return truncateText(redactSensitiveText(input), maxLength);
}

module.exports = {
  redactSensitiveText,
  truncateText,
  sanitizePreview
};
