const { __test } = require("../services/chatService");
const { isOutOfDomain } = __test;
const { handleChat } = require("../services/chatService");
const { resetAllSessions } = require("../services/sessionLifecycle");

describe("domain guardrail — isOutOfDomain keyword helper", () => {
  beforeEach(() => {
    resetAllSessions();
  });

  test("OUT-OF-DOMAIN: 'vreau sa curat geamurile din casa' → true", () => {
    expect(isOutOfDomain("vreau sa curat geamurile din casa")).toBe(true);
  });

  test("OUT-OF-DOMAIN: 'cum curat bucataria' → true", () => {
    expect(isOutOfDomain("cum curat bucataria")).toBe(true);
  });

  test("OUT-OF-DOMAIN: 'produs pentru baie' → true", () => {
    expect(isOutOfDomain("produs pentru baie")).toBe(true);
  });

  test("OUT-OF-DOMAIN: 'curat mobila din birou' → true", () => {
    expect(isOutOfDomain("curat mobila din birou")).toBe(true);
  });

  test("IN-DOMAIN: 'vreau sa curat geamurile din masina' → false (auto marker)", () => {
    expect(isOutOfDomain("vreau sa curat geamurile din masina")).toBe(false);
  });

  test("IN-DOMAIN: 'vreau sa curat geamurile' → false (no non-auto marker)", () => {
    expect(isOutOfDomain("vreau sa curat geamurile")).toBe(false);
  });

  test("IN-DOMAIN: 'polish auto' → false", () => {
    expect(isOutOfDomain("polish auto")).toBe(false);
  });

  test("IN-DOMAIN: 'caroserie deteriorata' → false", () => {
    expect(isOutOfDomain("caroserie deteriorata")).toBe(false);
  });

  test("integration: 'vreau sa curat geamurile din casa' returns domain-decline reply", async () => {
    const sessionId = `domain-guard-${Date.now()}`;
    const products = [
      { id: "g1", name: "Koch Glass Cleaner", tags: ["glass"], description: "auto glass cleaner" }
    ];
    const result = await handleChat("vreau sa curat geamurile din casa", "C1", products, sessionId);
    expect(result.domainDecline).toBe(true);
    expect(result.reply).toMatch(/detailing auto/i);
  });

  test("integration: 'vreau sa curat geamurile din masina' routes normally (no decline)", async () => {
    const sessionId = `domain-auto-${Date.now()}`;
    const products = [
      { id: "g1", name: "Koch Glass Cleaner", tags: ["glass"], description: "auto glass cleaner" }
    ];
    const result = await handleChat("vreau sa curat geamurile din masina", "C1", products, sessionId);
    expect(result.domainDecline).toBeUndefined();
  });
});
