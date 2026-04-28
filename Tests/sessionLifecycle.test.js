const L = require("../services/sessionLifecycle");
const sessionStore = require("../services/sessionStore");
const sessionService = require("../services/sessionService");

describe("sessionLifecycle (unified session)", () => {
  beforeEach(() => {
    L.resetAllSessions();
  });

  it("migrates legacy flat blob to schemaVersion 2 + meta", () => {
    const legacy = {
      state: "IDLE",
      slots: { context: "exterior" },
      messageCount: 3,
      createdAt: 1000,
      lastActivity: 2000
    };
    L.migrateSessionInPlace(legacy, "s1");
    expect(legacy.schemaVersion).toBe(L.CANONICAL_SCHEMA_VERSION);
    expect(legacy.meta.sessionId).toBe("s1");
    expect(legacy.meta.createdAtMs).toBe(1000);
    expect(legacy.slots.context).toBe("exterior");
  });

  it("store and service see the same session object", () => {
    const a = sessionStore.getSession("shared");
    a.slots = { context: "interior" };
    sessionStore.saveSession("shared", a);
    const b = sessionService.getSession("shared");
    expect(b.slots.context).toBe("interior");
    expect(b).toBe(a);
  });

  it("deriveSessionNamespaces does not overwrite other namespaces when mutating slots", () => {
    const s = L.loadSession("ns1");
    s.slots = { context: "exterior", object: "jante" };
    s.messageCount = 5;
    const n1 = L.deriveSessionNamespaces(s);
    s.slots = { context: null, object: null, surface: null };
    expect(n1.slots.values.context).toBe("exterior");
    expect(s.messageCount).toBe(5);
    const n2 = L.deriveSessionNamespaces(s);
    expect(n2.telemetry.messageCount).toBe(5);
    expect(n2.slots.values.context).toBeNull();
  });

  it("one persist replaces Map entry without splitting stores", () => {
    const s = sessionStore.getSession("p1");
    s.slots = { object: "mocheta" };
    sessionStore.saveSession("p1", s);
    expect(L.peekSessionSnapshot("p1").slots.object).toBe("mocheta");
    sessionService.updateSessionWithProducts("p1", [{ id: 1, name: "X", tags: [] }], "recommendation");
    const snap = L.peekSessionSnapshot("p1");
    expect(snap.activeProducts.length).toBe(1);
    expect(snap.slots.object).toBe("mocheta");
  });
});
