const request = require("supertest");

process.env.API_KEY = "test-api-key";

const API_KEY = process.env.API_KEY;

// Mock LLM (we control responses, not logic)
jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/interactionLog", () => ({
  appendInteractionLine: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { appendInteractionLine } = require("../services/interactionLog");
const { detectLanguage } = require("../services/chatService");
const settingsService = require("../services/settingsService");
const app = require("../server");

let defaultSessionId;

const postChat = (message, sessionId, clientId = "C1") =>
  request(app)
    .post("/chat")
    .set("x-api-key", API_KEY)
    .send({ message, sessionId: sessionId ?? defaultSessionId, clientId });

const postSettings = (settings) =>
  request(app)
    .post("/settings")
    .set("x-api-key", API_KEY)
    .send(settings);

const lastInteraction = () => {
  const calls = appendInteractionLine.mock.calls;
  if (!calls.length) return null;
  return calls[calls.length - 1][0];
};

beforeEach(() => {
  jest.clearAllMocks();
  defaultSessionId = `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
});

describe("AI eCommerce Assistant API", () => {
  describe("POST /chat — Guidance flow", () => {
    it("returns explanation for informational question (no fallback, no products)", async () => {
      askLLM.mockResolvedValue(
        "Diferenta dintre spuma alcalina si cea pH neutru tine de puterea de curatare si siguranta pentru protectii."
      );

      const res = await postChat(
        "Care este diferenta intre spuma alcalina si spuma pH neutru?"
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.reply).toBeTruthy();
      expect(res.body.reply.toLowerCase()).toMatch(/diferenta|ph|spuma/);
      expect(res.body.reply).not.toMatch(/nu am găsit|ce categorie/i);
      expect(res.body.products).toBeUndefined();
    });

    it("calls LLM exactly once (no search flow triggered)", async () => {
      askLLM.mockResolvedValue("Waxul se aplica la 2-3 luni.");

      await postChat("la cat timp se aplica waxul?");

      expect(askLLM).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /chat — Recommendation flow", () => {
    it("returns product-oriented response for purchase intent", async () => {
      askLLM.mockResolvedValue(
        "Recomand un coating ceramic pentru protectie si luciu de lunga durata."
      );

      const res = await postChat(
        "Recomanda un coating ceramic pentru masina"
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.reply).toBeTruthy();
      expect(res.body.reply.toLowerCase()).toMatch(/interior|exterior/);
      const entry = lastInteraction();
      expect(entry?.intent?.queryType).toBe("selection");
      expect(entry?.decision?.action).toBe("clarification");
      expect(entry?.decision?.missingSlot).toBe("context");
    });

    it("reply is meaningful (not generic fallback)", async () => {
      askLLM.mockResolvedValue(
        "Pentru zgarieturi fine poti folosi un polish mediu."
      );

      const res = await postChat(
        "am zgarieturi pe masina, ce folosesc?"
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.reply.length).toBeGreaterThan(20);
    });
  });

  describe("POST /chat — Language detection", () => {
    it("detects Romanian reliably from common Romanian words", () => {
      expect(detectLanguage("vreau ceva pentru interior")).toBe("ro");
      expect(detectLanguage("cat timp rezista?")).toBe("ro");
      expect(detectLanguage("recommend interior cleaner")).toBe("en");
    });

    it("keeps Romanian language for Romanian input", async () => {
      askLLM.mockResolvedValue(
        "Iti recomand un sampon auto pH neutru pentru intretinere."
      );

      const res = await postChat(
        "Imi recomanzi un sampon auto pH neutru?"
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.reply).toBeTruthy();
      expect(res.body.reply).not.toMatch(/the|recommended|for your/i);
      const entry = lastInteraction();
      // Clear recommendation + product noun can route to flow (Phase A product heuristics).
      expect(["clarification", "knowledge", "flow"]).toContain(
        entry?.decision?.action
      );
      if (entry?.decision?.action === "clarification") {
        expect(res.body.reply.toLowerCase()).toMatch(/interior|exterior/);
      }
    });

    it("injects Romanian instruction into LLM prompt", async () => {
      askLLM.mockResolvedValue("ok");

      await postChat(
        "Care este diferenta intre polish si wax pentru protectia vopselei?"
      );

      const prompt = askLLM.mock.calls[0][0];
      expect(prompt).toMatch(/rom[aâ]n[aă]|Romanian/i);
    });

    it("reuses session language on later turns", async () => {
      const sessionId = `lang-${Date.now()}`;

      askLLM.mockResolvedValue("ok");

      await postChat(
        "Care este diferenta intre spuma alcalina si spuma pH neutru?",
        sessionId
      );
      await postChat(
        "Explica pe scurt si pentru clay bar fata de sampon.",
        sessionId
      );

      const secondPrompt = askLLM.mock.calls[1][0];
      expect(secondPrompt).toMatch(/rom[aâ]n[aă]|Romanian/i);
    });
  });

  describe("POST /chat — Session continuity", () => {
    it("maintains context across turns", async () => {
      const sessionId = "session-" + Date.now();

      askLLM.mockResolvedValue(
        "Pentru piele recomand un cleaner dedicat care nu usuca materialul."
      );

      await postChat("cum curat o cotiera murdara?", sessionId);

      const secondRes = await postChat("piele", sessionId);
      expect(secondRes.statusCode).toBe(200);
      const text = String(secondRes.body.reply || "").toLowerCase();
      expect(text.length).toBeGreaterThan(10);

      const session = require("../services/sessionStore").getSession(sessionId);
      expect(session.slots?.surface).toBe("piele");
      expect(session.slots?.object).toBeTruthy();

      const entry = lastInteraction();
      expect(entry?.intent?.queryType).toBe("procedural");
      expect(entry?.slots?.surface).toBe("piele");
    });

    it("isolates different sessions", async () => {
      askLLM.mockResolvedValue("raspuns generic");

      const res1 = await postChat("vreau polish", "A");
      const res2 = await postChat("vreau ceara", "B");

      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
    });
  });

  describe("POST /chat — Error resilience", () => {
    it("returns safe fallback if LLM fails", async () => {
      askLLM.mockRejectedValue(new Error("timeout"));

      const res = await postChat("vreau polish");

      expect(res.statusCode).toBe(200);
      expect(res.body.reply).toBeTruthy();
    });

    it("handles empty input gracefully", async () => {
      const res = await postChat("");

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  describe("GET /products", () => {
    it("returns valid product list structure", async () => {
      const res = await request(app).get("/products");

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      if (res.body.length > 0) {
        const p = res.body[0];

        expect(p).toHaveProperty("id");
        expect(p).toHaveProperty("name");
        expect(p).toHaveProperty("price");
        expect(p).toHaveProperty("tags");

        expect(Array.isArray(p.tags)).toBe(true);
      }
    });
  });

  describe("Settings API", () => {
    it("GET /settings returns valid config", async () => {
      const res = await request(app)
        .get("/settings")
        .set("x-api-key", API_KEY);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("max_products");
      expect(res.body).toHaveProperty("cta");
    });

    it("POST /settings persists changes", async () => {
      await postSettings({ max_products: 1, cta: "Cumpara acum" });

      const res = await request(app)
        .get("/settings")
        .set("x-api-key", API_KEY);

      expect(res.body.max_products).toBe(1);
      expect(res.body.cta).toBe("Cumpara acum");
    });

    it("persists fallback_message for chat guidance (settings round-trip)", async () => {
      const prev = settingsService.getSettings();
      await postSettings({
        ...prev,
        fallback_message: "Nu am gasit produse."
      });

      const res = await request(app)
        .get("/settings")
        .set("x-api-key", API_KEY);

      expect(res.statusCode).toBe(200);
      expect(res.body.fallback_message).toMatch(/Nu am gasit produse/i);
      expect(settingsService.getSettings().fallback_message).toMatch(
        /Nu am gasit produse/i
      );
    });
  });
});
