jest.mock("../services/llm", () => ({
  askLLM: jest.fn()
}));

jest.mock("../services/flowExecutor", () => ({
  executeFlow: jest.fn()
}));

const { handleChat } = require("../services/chatService");

describe("Selection hard filtering and output", () => {
  it("applies hard filtering before ranking and renders role-structured output", async () => {
    const sessionId = `selection-${Date.now()}`;
    const products = [
      {
        id: "t1",
        name: "Cleaner Textil Interior",
        description: "Curata sigur textilele din interior si indeparteaza murdaria persistenta.",
        short_description: "Curata sigur textilele din interior.",
        tags: ["interior", "textile", "interior_cleaner", "cleaner"]
      },
      {
        id: "t2",
        name: "Perie pentru textile",
        description: "Ajuta la desprinderea murdariei din fibre fara agresivitate.",
        short_description: "Perie moale pentru textile.",
        tags: ["interior", "textile", "brush", "tool"]
      },
      {
        id: "t3",
        name: "Laveta Microfibra Premium",
        description: "Pentru stergere fara scame si fara zgarieturi.",
        short_description: "Laveta premium din microfibra.",
        tags: ["microfiber", "tool"]
      },
      {
        id: "bad1",
        name: "Polish Exterior",
        description: "Luciu pentru vopsea si finisaj exterior.",
        short_description: "Polish exterior.",
        tags: ["exterior", "paint", "polish"]
      }
    ];

    const result = await handleChat("ce produs recomanzi pentru cotiera textil murdara", "C1", products, sessionId);
    const reply = String(result.reply || result.message || "");
    const bulletCount = (reply.match(/^- /gm) || []).length;

    expect(result.type).toBe("recommendation");
    expect(reply).toMatch(/Soluție:/i);
    expect(reply).toMatch(/Accesoriu:/i);
    expect(reply).toContain("Cleaner Textil Interior");
    expect(reply).not.toContain("Polish Exterior");
    expect(bulletCount).toBeLessThanOrEqual(3);
    expect(Array.isArray(result.products)).toBe(true);
    expect(result.products.length).toBeLessThanOrEqual(3);
  });

  it("returns safe no-product reply instead of random fallback when hard filter empties the pool", async () => {
    const sessionId = `selection-empty-${Date.now()}`;
    const products = [
      {
        id: "bad2",
        name: "Wax Exterior",
        description: "Protectie pentru vopsea si luciu intens.",
        short_description: "Wax pentru exterior.",
        tags: ["exterior", "paint", "wax"]
      }
    ];

    const result = await handleChat("ce produs recomanzi pentru cotiera textil murdara", "C1", products, sessionId);
    const reply = String(result.reply || result.message || "");

    expect(result.type).toBe("reply");
    expect(reply).toMatch(/Nu sunt sigur ce produs se potrivește perfect aici|Nu sunt sigur ce produs se potriveste perfect aici/i);
    expect(Array.isArray(result.products)).toBe(true);
    expect(result.products).toHaveLength(0);
  });
});
