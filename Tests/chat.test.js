const request = require("supertest");

// Mock LLM (we control responses, not logic)
jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

const { askLLM } = require("../services/llm");
const { detectLanguage } = require("../services/chatService");
const app = require("../server");

const postChat = (message, sessionId = "test-session", clientId = "C1") =>
  request(app).post("/chat").send({ message, sessionId, clientId });

const postSettings = (settings) =>
  request(app).post("/settings").send(settings);

beforeEach(() => {
  jest.clearAllMocks();
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
      expect(res.body.reply.toLowerCase()).toMatch(/recomand|ceramic|protect/i);
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
      const reply = "Iti recomand un sampon auto pH neutru pentru intretinere.";

      askLLM.mockResolvedValue(reply);

      const res = await postChat(
        "Imi recomanzi un sampon auto pH neutru?"
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.reply).toBe(reply);
      expect(res.body.reply).not.toMatch(/the|recommended|for your/i);
    });

    it("injects Romanian instruction into LLM prompt", async () => {
      askLLM.mockResolvedValue("ok");

      await postChat("vreau curatare interior masina");

      const prompt = askLLM.mock.calls[0][0];
      expect(prompt).toMatch(/Raspunde STRICT in limba romana/i);
    });

    it("reuses session language on later turns", async () => {
      const sessionId = `lang-${Date.now()}`;

      askLLM.mockResolvedValue("ok");

      await postChat("vreau ceva pentru interior", sessionId);
      await postChat("how do I use it", sessionId);

      const secondPrompt = askLLM.mock.calls[1][0];
      expect(secondPrompt).toMatch(/Raspunde STRICT in limba romana/i);
    });
  });

  describe("POST /chat — Session continuity", () => {
    it("maintains context across turns", async () => {
      const sessionId = "session-" + Date.now();

      askLLM
        .mockResolvedValueOnce("Pentru ce material este suprafata?")
        .mockResolvedValueOnce(
          "Pentru piele recomand un cleaner dedicat care nu usuca materialul."
        );

      await postChat("vreau ceva pentru curatare interior", sessionId);

      const secondRes = await postChat("piele", sessionId);
      expect(secondRes.statusCode).toBe(200);
      expect(secondRes.body.reply.toLowerCase()).toMatch(/piele|cleaner/);
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
      askLLM.mockResolvedValue("Cu ce te pot ajuta?");

      const res = await postChat("");

      expect(res.statusCode).toBe(200);
      expect(res.body.reply).toBeTruthy();
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
      const res = await request(app).get("/settings");

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("max_products");
      expect(res.body).toHaveProperty("cta");
    });

    it("POST /settings persists changes", async () => {
      await postSettings({ max_products: 1, cta: "Cumpara acum" });

      const res = await request(app).get("/settings");

      expect(res.body.max_products).toBe(1);
      expect(res.body.cta).toBe("Cumpara acum");
    });

    it("settings affect chat behavior (fallback)", async () => {
      askLLM.mockResolvedValue("");

      await postSettings({
        fallback_message: "Nu am gasit produse."
      });

      const res = await postChat("ceva inexistent total");

      expect(res.body.reply).toMatch(/Nu am gasit produse/i);
    });
  });
});