"use strict";

const crypto = require("crypto");

const MAX_SESSION_ID_LEN = 128;

/**
 * Resolve chat session id from POST /chat body.
 * Accepts sessionId (camelCase) with precedence over session_id.
 *
 * @param {{ sessionId?: unknown, session_id?: unknown }} body
 * @returns {{ canonicalSessionId: string, prodWarnTestSession: boolean }}
 */
function normalizeChatSessionIdFromBody(body) {
  const raw = body?.sessionId ?? body?.session_id;
  const candidate = typeof raw === "string" ? raw.trim() : "";

  const isTestSession = candidate === "test-session";
  const invalid =
    candidate === "" ||
    isTestSession ||
    candidate.length > MAX_SESSION_ID_LEN ||
    /\s/.test(candidate);

  if (!invalid) {
    return { canonicalSessionId: candidate, prodWarnTestSession: false };
  }

  return {
    canonicalSessionId: crypto.randomUUID(),
    prodWarnTestSession: isTestSession
  };
}

module.exports = {
  normalizeChatSessionIdFromBody,
  MAX_SESSION_ID_LEN
};
