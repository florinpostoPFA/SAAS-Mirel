const crypto = require("crypto");
const { normalizeChatSessionIdFromBody, MAX_SESSION_ID_LEN } = require("../services/chatSessionId");

describe("normalizeChatSessionIdFromBody", () => {
  const fixed = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";

  beforeEach(() => {
    jest.spyOn(crypto, "randomUUID").mockReturnValue(fixed);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("generates uuid when session keys are missing", () => {
    const { canonicalSessionId, prodWarnTestSession } = normalizeChatSessionIdFromBody({});
    expect(canonicalSessionId).toBe(fixed);
    expect(prodWarnTestSession).toBe(false);
  });

  it("accepts valid camelCase sessionId", () => {
    const { canonicalSessionId, prodWarnTestSession } = normalizeChatSessionIdFromBody({
      sessionId: "  my-stable-session  "
    });
    expect(canonicalSessionId).toBe("my-stable-session");
    expect(prodWarnTestSession).toBe(false);
  });

  it("accepts valid snake_case session_id when camelCase absent", () => {
    const { canonicalSessionId } = normalizeChatSessionIdFromBody({
      session_id: "from-snake"
    });
    expect(canonicalSessionId).toBe("from-snake");
  });

  it("prefers sessionId over session_id", () => {
    const { canonicalSessionId } = normalizeChatSessionIdFromBody({
      sessionId: "camel-wins",
      session_id: "snake-loses"
    });
    expect(canonicalSessionId).toBe("camel-wins");
  });

  it("rejects test-session and sets prodWarnTestSession", () => {
    const { canonicalSessionId, prodWarnTestSession } = normalizeChatSessionIdFromBody({
      sessionId: "test-session"
    });
    expect(canonicalSessionId).toBe(fixed);
    expect(prodWarnTestSession).toBe(true);
  });

  it("does not treat Test-Session as test-session (case-sensitive)", () => {
    const { canonicalSessionId, prodWarnTestSession } = normalizeChatSessionIdFromBody({
      sessionId: "Test-Session"
    });
    expect(canonicalSessionId).toBe("Test-Session");
    expect(prodWarnTestSession).toBe(false);
  });

  it("rejects whitespace inside id", () => {
    const { canonicalSessionId } = normalizeChatSessionIdFromBody({
      sessionId: "bad id"
    });
    expect(canonicalSessionId).toBe(fixed);
  });

  it("rejects length > MAX_SESSION_ID_LEN", () => {
    const long = "x".repeat(MAX_SESSION_ID_LEN + 1);
    const { canonicalSessionId } = normalizeChatSessionIdFromBody({ sessionId: long });
    expect(canonicalSessionId).toBe(fixed);
  });
});
