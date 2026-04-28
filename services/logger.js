/**
 * Simple logger utility
 * Can be extended to use winston, pino, etc.
 */

const { getNowIso } = require("./runtimeContext");

const DEBUG_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.DEBUG || "").toLowerCase()
);

function truncateText(text, maxLength = 160) {
  if (!text || typeof text !== "string") return text;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function truncateWords(text, maxWords = 10) {
  if (!text || typeof text !== "string") return text;
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ") + "...";
}

function sanitizeForLog(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 5).map(sanitizeForLog);
  }
  if (value && typeof value === "object") {
    const out = { ...value };
    Object.keys(out).forEach((key) => {
      out[key] = sanitizeForLog(out[key]);
    });
    if (out.description !== undefined) out.description = truncateWords(out.description);
    if (out.short_description !== undefined) out.short_description = truncateWords(out.short_description);
    if (out.message !== undefined) out.message = truncateText(out.message);
    if (out.userMessage !== undefined) out.userMessage = truncateText(out.userMessage);
    if (out.reply !== undefined) out.reply = truncateText(out.reply);
    if (out.response !== undefined) out.response = truncateText(out.response);
    if (out.prompt !== undefined) out.prompt = truncateText(out.prompt);
    if (out.content !== undefined) out.content = truncateText(out.content);
    return out;
  }
  if (typeof value === "string") {
    return truncateText(value);
  }
  return value;
}

function emit(level, tag, payload = null) {
  const timestamp = getNowIso();
  const prefix = `[${timestamp}] [${level}] [${tag}]`;
  const safePayload = payload == null ? null : sanitizeForLog(payload);
  const line = safePayload == null
    ? prefix
    : `${prefix} ${JSON.stringify(safePayload)}`;

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  console.log(line);
}

function toPayload(message, data = null) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { message, ...data };
  }

  if (data !== null && data !== undefined) {
    return { message, data };
  }

  return message ? { message } : null;
}

function logInfo(tag, data) {
  emit("INFO", tag, data);
}

function logDebug(tag, data) {
  if (!DEBUG_ENABLED) return;
  emit("DEBUG", tag, data);
}

function info(source, message, data) {
  if (!DEBUG_ENABLED) return;
  emit("INFO", source, toPayload(message, data));
}

function debug(source, message, data) {
  if (!DEBUG_ENABLED) return;
  emit("DEBUG", source, toPayload(message, data));
}

function error(source, message, data) {
  emit("ERROR", source, toPayload(message, data));
}

function warn(source, message, data) {
  emit("WARN", source, toPayload(message, data));
}

module.exports = { info, debug, error, warn, logInfo, logDebug, sanitizeForLog, DEBUG_ENABLED };
