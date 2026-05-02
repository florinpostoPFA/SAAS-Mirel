/**
 * Unified in-memory session: one Map, one object per sessionId, explicit schema + migration.
 * Handler code (chatService) mutates flat fields on the session object; meta/schemaVersion
 * are maintained here on load/persist. See docs/SESSION_SCOPES.md
 */

const { getNowMs } = require("./runtimeContext");

const CANONICAL_SCHEMA_VERSION = 2;
const sessions = new Map();

/** @param {(evt: { type: string, sessionId: string, before: object|null, after: object }) => void | null} fn */
function setSessionMutationHook(fn) {
  global.__GOLDEN_SESSION_HOOK__ = typeof fn === "function" ? fn : null;
}

function touchMeta(session) {
  if (!session.meta || typeof session.meta !== "object") return;
  const t = getNowMs();
  session.meta.updatedAtMs = t;
}

/**
 * Default unified session (flat fields = source of truth for chatService;
 * nested meta + schemaVersion for lifecycle and tests).
 */
function createDefaultUnifiedSession(sessionId) {
  const now = getNowMs();
  const id = String(sessionId || "default");
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    meta: {
      sessionId: id,
      clientId: null,
      createdAtMs: now,
      updatedAtMs: now
    },
    state: "IDLE",
    tags: [],
    slots: {},
    slotMeta: { context: "unknown", surface: "unknown", object: "unknown" },
    activeProducts: [],
    lastResponse: null,
    pendingQuestion: null,
    messageCount: 0,
    questionCount: 0,
    conversationHistory: [],
    lastActivity: now,
    createdAt: now,
    lastResponseType: null,
    routingTurnIndex: 0,
    conversationContextMvp: null
  };
}

/**
 * Upgrade legacy shapes (pre-schemaVersion or partial seeds) in place.
 */
function migrateSessionInPlace(session, sessionId) {
  const sid = String(sessionId || session.meta?.sessionId || session.id || "default");
  const now = getNowMs();

  if (!session.meta || typeof session.meta !== "object") {
    session.meta = {
      sessionId: sid,
      clientId: session.metaClientId ?? null,
      createdAtMs: session.createdAt ?? now,
      updatedAtMs: session.lastActivity ?? session.createdAt ?? now
    };
  } else {
    if (!session.meta.sessionId) session.meta.sessionId = sid;
    if (session.meta.createdAtMs == null) {
      session.meta.createdAtMs = session.createdAt ?? now;
    }
    if (session.meta.updatedAtMs == null) {
      session.meta.updatedAtMs = session.lastActivity ?? now;
    }
  }

  session.schemaVersion = CANONICAL_SCHEMA_VERSION;

  if (session.state == null) session.state = "IDLE";
  if (!Array.isArray(session.tags)) session.tags = [];
  if (!session.slots || typeof session.slots !== "object") session.slots = {};
  if (!session.slotMeta || typeof session.slotMeta !== "object") {
    session.slotMeta = { context: "unknown", surface: "unknown", object: "unknown" };
  }
  if (!Array.isArray(session.activeProducts)) session.activeProducts = [];
  if (session.pendingQuestion === undefined) session.pendingQuestion = null;
  session.messageCount = Number(session.messageCount) || 0;
  session.questionCount = Number(session.questionCount) || 0;
  if (!Array.isArray(session.conversationHistory)) session.conversationHistory = [];
  if (session.lastActivity == null) session.lastActivity = session.meta.updatedAtMs ?? now;
  if (session.createdAt == null) session.createdAt = session.meta.createdAtMs ?? now;
  if (session.lastResponseType === undefined) session.lastResponseType = null;
  if (session.routingTurnIndex == null) session.routingTurnIndex = 0;
  if (session.conversationContextMvp === undefined) session.conversationContextMvp = null;

  return session;
}

/**
 * Load or create session (does not bump lastActivity — use touchActivity for that).
 * @param {string} sessionId
 */
function loadSession(sessionId) {
  const id =
    sessionId == null || sessionId === "" ? "default" : String(sessionId);
  if (!sessions.has(id)) {
    sessions.set(id, createDefaultUnifiedSession(id));
  }
  const s = sessions.get(id);
  migrateSessionInPlace(s, id);
  return s;
}

/**
 * @param {string} sessionId
 * @param {object} sessionData full session object (same reference as loadSession is typical)
 */
function persistSession(sessionId, sessionData) {
  const hook = global.__GOLDEN_SESSION_HOOK__;
  const id = String(sessionId || "default");
  const before =
    hook && sessions.has(id) ? JSON.parse(JSON.stringify(sessions.get(id))) : null;

  migrateSessionInPlace(sessionData, id);
  touchMeta(sessionData);
  sessions.set(id, sessionData);

  if (hook) {
    hook({
      type: "sessionStore.save",
      sessionId: id,
      before,
      after: JSON.parse(JSON.stringify(sessionData))
    });
  }
}

function resetAllSessions() {
  sessions.clear();
}

/**
 * @param {string} sessionId
 * @param {object} partial flat partial session fields (merged onto defaults)
 */
function seedSession(sessionId, partial) {
  const id = String(sessionId || "default");
  const base = createDefaultUnifiedSession(id);
  const merged = { ...base, ...(partial || {}) };
  migrateSessionInPlace(merged, id);
  sessions.set(id, merged);
  return merged;
}

/**
 * Read-only view of namespaced slices (for tests / introspection).
 * Root flat fields remain authoritative; this is derived.
 */
function deriveSessionNamespaces(session) {
  if (!session || typeof session !== "object") return null;
  return {
    meta: session.meta ? { ...session.meta } : null,
    slots: {
      values: session.slots ? { ...session.slots } : {},
      meta: session.slotMeta ? { ...session.slotMeta } : {}
    },
    conversation: {
      lastUserMessage: session.lastUserMessage ?? null,
      lastAssistantMessage: session.lastAssistantMessage ?? null,
      lastResponseType: session.lastResponseType ?? null,
      responseLocale: session.responseLocale ?? null,
      language: session.language ?? null
    },
    flow: {
      lastFlow: session.lastFlow ?? null,
      glassFlowContextLocked: session.glassFlowContextLocked ?? false,
      intentFlags: session.intentFlags ? { ...session.intentFlags } : {},
      domain: session.domain ?? null,
      problemType: session.problemType ?? null
    },
    selection: {
      state: session.state ?? null,
      pendingQuestion: session.pendingQuestion ?? null,
      pendingClarification: session.pendingClarification ?? null,
      pendingSlots: session.pendingSlots ?? null,
      pendingSelection: session.pendingSelection ?? false,
      pendingSelectionMissingSlot: session.pendingSelectionMissingSlot ?? null,
      originalIntent: session.originalIntent ?? null,
      lastIntent: session.lastIntent ?? null,
      objective: session.objective ?? null,
      tags: Array.isArray(session.tags) ? [...session.tags] : []
    },
    telemetry: {
      messageCount: session.messageCount ?? 0,
      questionCount: session.questionCount ?? 0,
      lastActivity: session.lastActivity ?? null,
      createdAt: session.createdAt ?? null,
      conversationHistory: Array.isArray(session.conversationHistory)
        ? session.conversationHistory.map((e) => (e && typeof e === "object" ? { ...e } : e))
        : []
    },
    products: {
      activeProducts: Array.isArray(session.activeProducts)
        ? session.activeProducts.map((p) => (p && typeof p === "object" ? { ...p } : p))
        : [],
      lastResultsIds: Array.isArray(session.lastResultsIds) ? [...session.lastResultsIds] : [],
      lastQuery: session.lastQuery ?? null
    }
  };
}

function peekSessionSnapshot(sessionId) {
  const id = String(sessionId || "default");
  if (!sessions.has(id)) return null;
  return JSON.parse(JSON.stringify(sessions.get(id)));
}

function cleanupOldSessions() {
  const cutoffTime = getNowMs() - 24 * 60 * 60 * 1000;
  let cleanedCount = 0;
  for (const [sessionId, session] of sessions.entries()) {
    const la = session.lastActivity ?? session.meta?.updatedAtMs ?? 0;
    if (la < cutoffTime) {
      sessions.delete(sessionId);
      cleanedCount++;
    }
  }
  return cleanedCount;
}

function getActiveSessionIds() {
  return Array.from(sessions.keys());
}

module.exports = {
  CANONICAL_SCHEMA_VERSION,
  loadSession,
  persistSession,
  setSessionMutationHook,
  resetAllSessions,
  seedSession,
  deriveSessionNamespaces,
  peekSessionSnapshot,
  cleanupOldSessions,
  getActiveSessionIds,
  migrateSessionInPlace,
  createDefaultUnifiedSession
};
