const config = require("../config");

const ROMANIAN_ONLY_INSTRUCTION = "You MUST respond ONLY in Romanian. Do not use English.";

/**
 * Get role description based on tone
 */
function getRoleDescription(tone) {
  if (tone === "expert") {
    return "You are a professional auto detailing consultant giving authoritative yet polite advice.";
  }
  return "You are a friendly, helpful auto detailing consultant focused on the customer.";
}

/**
 * Format product entry with benefits focus
 */
function formatProductEntry(product) {
  const parts = [`Name: ${product.name}`];
  if (product.price !== undefined) parts.push(`Price: ${product.price}`);
  if (product.tags && Array.isArray(product.tags)) {
    parts.push(`Tags: ${product.tags.join(", ")}`);
  }
  // Focus on benefits rather than just description
  if (product.description) {
    parts.push(`Benefits: ${product.description}`);
  }
  return parts.join(" | ");
}

/**
 * Get strategy-specific behavior explanation
 */
function getStrategyExplanation(strategy) {
  const strategies = {
    direct: "Show products immediately and recommend the best matches for their needs.",
    discovery: "Ask exactly 1 clarifying question to better understand their needs before recommending products.",
    comparison: "Compare the products they've already seen and help them choose between options.",
    urgency: "Create urgency by emphasizing limited availability and time-sensitive benefits while recommending products.",
    guidance: "Provide step-by-step instructions on how to use the provided products. Focus on practical usage guidance."
  };
  return strategies[strategy] || strategies.direct;
}

/**
 * Build the STYLE section
 */
function buildStyleSection(settings) {
  const lines = [];
  lines.push("STYLE:");

  // Tone
  const tone = settings.tone || "friendly";
  if (tone === "friendly") {
    lines.push("- Tone: Friendly and approachable, like talking to a knowledgeable friend");
  } else if (tone === "expert") {
    lines.push("- Tone: Professional and authoritative, providing expert guidance");
  }

  // Response style
  const responseStyle = settings.response_style || "persuasive";
  if (responseStyle === "short") {
    lines.push("- Response style: Concise and to-the-point (2-3 sentences per product)");
  } else if (responseStyle === "detailed") {
    lines.push("- Response style: Comprehensive with rich explanations");
  } else {
    lines.push("- Response style: Persuasive and benefit-focused");
  }

  // Sales mode
  const salesMode = settings.sales_mode || "normal";
  if (salesMode === "aggressive") {
    lines.push("- Sales mode: Confident and action-oriented with urgency");
  } else {
    lines.push("- Sales mode: Consultative and helpful");
  }

  return lines.join("\n");
}

/**
 * Build the HARD RULES section
 */
function buildHardRulesSection(settings, strategy = "direct", language = "en") {
  const lines = [];
  lines.push("HARD RULES:");
  lines.push("- ONLY use the products listed in the PRODUCTS section below");
  lines.push("- NEVER invent or hallucinate products, features, or prices");
  lines.push(`- IMPORTANT: ${ROMANIAN_ONLY_INSTRUCTION}`);

  if (strategy === "guidance") {
    lines.push("- NEVER recommend new products");
    lines.push("- NEVER suggest buying additional items");
    lines.push("- Focus ONLY on usage instructions");
    lines.push("- If user asks about products not in the list, say you can only help with the provided products");
    lines.push("- Be practical and clear - focus on how-to guidance");
    lines.push("- Keep it simple and actionable");
  } else {
    lines.push("- You MUST prioritize the first product in the list as the main recommendation");
    lines.push("- Other products can be mentioned as alternatives only");
    lines.push("- Be concise and focused on benefits, not just features");
    lines.push("- Ask at most 1 question per response (only when strategy requires it)");
    lines.push(`- Include this exact CTA in your response: "${settings.cta || "Vezi produsul"}"`);
    lines.push("- Focus on how products solve the user's specific needs");
  }

  return lines.join("\n");
}

/**
 * Build the PRODUCTS LIST section
 * The first product is always the primary recommendation.
 */
function buildProductsSection(products) {
  if (!products || products.length === 0) {
    return "PRODUCTS LIST:\n(No products available)";
  }

  const lines = ["PRODUCTS LIST:"];

  // Primary product (ranked #1)
  const primary = products[0];
  lines.push("Primary product (MUST be your main recommendation):");
  lines.push(`- Name: ${primary.name}`);
  if (primary.price !== undefined) lines.push(`- Price: ${primary.price}`);
  if (primary.short_description) lines.push(`- Description: ${primary.short_description}`);
  else if (primary.description) lines.push(`- Description: ${primary.description.slice(0, 300)}`);

  // Alternatives
  if (products.length > 1) {
    lines.push("");
    lines.push("Alternatives (mention only if relevant):");
    products.slice(1).forEach((product, idx) => {
      lines.push(`${idx + 2}. ${formatProductEntry(product)}`);
    });
  }

  return lines.join("\n");
}

/**
 * Build the OUTPUT INSTRUCTIONS section
 */
function buildOutputInstructions(settings, strategy) {
  const lines = [];
  lines.push("OUTPUT INSTRUCTIONS:");

  if (strategy === "guidance") {
    lines.push("- Use natural, conversational language");
    lines.push("- Provide step-by-step instructions (1, 2, 3...) for using the products");
    lines.push("- Be practical and clear - focus on how-to guidance");
    lines.push("- Keep it simple and actionable");
    lines.push("- Structure: Acknowledge question → Provide steps → Offer additional help");
    lines.push("- Do not recommend new products or upsell");
  } else {
    lines.push("- Use natural, conversational language");
    lines.push("- Be persuasive by focusing on benefits and outcomes");
    lines.push("- Make the user feel confident in their choice");
    lines.push(`- Always end with the CTA: "${settings.cta || "Vezi produsul"}"`);
    lines.push("- Structure: Start with the primary product recommendation → Explain its benefits → Optionally mention alternatives → CTA");
  }

  return lines.join("\n");
}

function buildGuidancePrompt(products, userMessage, tags = [], language = "en", guidanceType = "general", knowledgeContext = "", object = null) {
  const surfaceTags = ["plastic", "leather", "textile", "alcantara", "glass", "paint", "rubber"];
  const detectedSurfaces = (tags || []).filter(t => surfaceTags.includes(t));
  const hasProducts = Array.isArray(products) && products.length > 0;
  const hasKnowledge = typeof knowledgeContext === "string" && knowledgeContext.trim().length > 0;

  const lines = [];

  lines.push("You are an auto detailing expert.");
  lines.push("");
  lines.push(`Detected tags: ${(tags || []).join(", ") || "(none)"}`);
  lines.push("");

  // Safety / compatibility questions get a dedicated prompt structure
  if (guidanceType === "safety") {
    lines.push("## TASK");
    lines.push("The user asked a safety or compatibility question. You MUST answer it DIRECTLY first.");
    lines.push("");
    lines.push("## RESPONSE STRUCTURE (MANDATORY)");
    lines.push("1. Direct yes/no answer + one short explanation sentence");
    lines.push("2. (Optional) 1–2 sentence recommendation of a safer/better alternative");
    if (hasProducts) {
      lines.push("3. Natural product suggestion using the products listed below");
      lines.push("");
      lines.push("## PRODUCTS (suggest only if relevant)");
      const maxProducts = Math.min(products.length, 3);
      products.slice(0, maxProducts).forEach((p, i) => {
        const desc = p.short_description || (p.description ? p.description.slice(0, 120) : "");
        lines.push(`${i + 1}. ${p.name}${p.price !== undefined ? ` — ${p.price}` : ""}${desc ? " | " + desc : ""}`);
      });
    }
    lines.push("");
    lines.push("## RULES");
    lines.push("- ALWAYS answer the question first — never skip to products");
    lines.push("- Keep the answer short and practical");
    lines.push("");
    if (hasKnowledge) {
      lines.push("## RELEVANT KNOWLEDGE");
      lines.push(knowledgeContext);
      lines.push("");
    }
    lines.push("## USER QUESTION");
    lines.push(userMessage || "");
    lines.push("");
    lines.push(ROMANIAN_ONLY_INSTRUCTION);
    lines.push("Final answer MUST be entirely in Romanian.");
    return lines.join("\n");
  }

  lines.push("You MUST strictly follow the detected tags.");
  lines.push("");
  lines.push("## RULES (CRITICAL)");

  if (object) {
    lines.push("- If an object (e.g. cotiera, scaun, volan) is provided, tailor the answer specifically to that object instead of generic surface instructions");
    lines.push(`- The specific object is: ${object}`);
    lines.push("- You MUST explicitly mention this object in the response");
    lines.push("- Always use singular phrasing for the object and do not generalize to broader categories");
    lines.push("- Avoid generic phrasing like \"curata textilele\" when object is known");
  }

  if (detectedSurfaces.length > 0) {
    lines.push(`- The user's surface is: ${detectedSurfaces.join(", ")}`);
    lines.push("- ONLY give instructions for that specific surface");
    lines.push("- DO NOT mention other materials or surfaces");
    lines.push("- DO NOT use \"if textile / if leather / if plastic\" conditionals");
    lines.push("- DO NOT generalize across multiple materials");
  } else {
    lines.push("- Surface is unknown — give general advice and ask for clarification if needed");
  }

  lines.push("- Use practical detailing language");
  lines.push("- Mention: \"nu imbiba excesiv materialul\"");
  lines.push("- Mention: \"lucreaza pe zone mici\"");
  lines.push("- Mention: \"foloseste microfibra/perie moale\"");
  lines.push("- Avoid generic wording like \"solutie speciala\"");
  lines.push("- Prefer concrete wording like \"APC diluat\" or \"solutie pentru textile\"");

  lines.push("");
  lines.push("## RESPONSE STRUCTURE (MANDATORY)");
  lines.push("1. Short intro specific to the detected object and surface");
  if (detectedSurfaces.includes("textile")) {
    lines.push("2. Method 1: fara echipament");
    lines.push("3. Method 2: cu aspirator injectie-extractie");
    lines.push("4. End with one practical tip");
  } else {
    lines.push("2. Exactly 2–3 numbered steps — ONLY for the detected surface, NO branching");
    lines.push("3. End with one practical tip");
  }

  if (hasProducts) {
    lines.push("Natural product recommendation transition (not aggressive), then list the products below");
    lines.push("");
    lines.push("## PRODUCTS (recommend these after the steps)");
    const maxProducts = Math.min(products.length, 3);
    products.slice(0, maxProducts).forEach((p, i) => {
      const desc = p.short_description || (p.description ? p.description.slice(0, 120) : "");
      lines.push(`${i + 1}. ${p.name}${p.price !== undefined ? ` — ${p.price}` : ""}${desc ? " | " + desc : ""}`);
    });
  } else {
    lines.push("3. Optional practical tip");
    lines.push("DO NOT recommend new products.");
  }

  lines.push("");

  if (hasKnowledge) {
    lines.push("## RELEVANT KNOWLEDGE");
    lines.push(knowledgeContext);
    lines.push("");
    lines.push("Base your steps primarily on the provided knowledge. Enrich with additional explanations if needed.");
    lines.push("");
  }

  lines.push("## USER QUESTION");
  lines.push(userMessage || "");
  lines.push("");
  lines.push(`${ROMANIAN_ONLY_INSTRUCTION} Do NOT switch languages. Do NOT include words from another language.`);
  lines.push("Final answer MUST be entirely in Romanian.");

  return lines.join("\n");
}

function buildInformationalPrompt(userMessage, language = "en", knowledgeContext = "") {
  const lines = [];

  lines.push("You are an auto detailing expert.");
  lines.push("");
  lines.push("## TASK");
  lines.push("The user asked an informational question. Provide a short explanatory answer about the concept only.");
  lines.push("");
  lines.push("## RULES (MANDATORY)");
  lines.push("- Provide a clear explanation of the concept");
  lines.push("- Explain WHAT it is and WHY it matters");
  lines.push("- Do NOT include step-by-step instructions");
  lines.push("- Do NOT explain how to use the product");
  lines.push("- Do NOT format the response as a guide or process");
  lines.push("- Do NOT include numbered steps or action lists");
  lines.push("- Keep the answer short and explanatory");
  lines.push("");

  if (knowledgeContext && knowledgeContext.trim()) {
    lines.push("## RELEVANT KNOWLEDGE");
    lines.push(knowledgeContext);
    lines.push("");
    lines.push("Base the explanation on the provided knowledge.");
    lines.push("");
  }

  lines.push("## USER QUESTION");
  lines.push(userMessage || "");
  lines.push("");
  lines.push(`${ROMANIAN_ONLY_INSTRUCTION} Do NOT switch languages.`);
  lines.push("Final answer MUST be entirely in Romanian.");

  return lines.join("\n");
}

/**
 * Build conversion-focused prompt with structured sections
 */
function buildPrompt({ products = [], settings = {}, userMessage, detectedTags = [], context = {}, strategy = "direct", language = "en", guidanceType = "general", knowledgeContext = "", object = null }) {
  const resolvedObject = context?.object || object || null;

  if (context?.queryType === "informational") {
    return buildInformationalPrompt(userMessage, language, knowledgeContext);
  }

  if (strategy === "guidance") {
    return buildGuidancePrompt(products, userMessage, detectedTags, language, guidanceType, knowledgeContext, resolvedObject);
  }

  const languageLabel = "Romanian";
  const languageInstruction = "Raspunde STRICT in limba romana. Nu folosi engleza.";

  const sections = [];

  sections.push(`You MUST respond ONLY in the following language: ${languageLabel}.`);
  sections.push("Do NOT switch languages.");
  sections.push("Do NOT include any words or phrases in another language unless explicitly asked.");
  sections.push(`${languageInstruction}`);
  sections.push("");

  sections.push("You are assisting a Romanian customer in an auto detailing shop.");
  sections.push("");

  sections.push("You are an AI assistant for an AUTO DETAILING shop.");
  sections.push("");
  sections.push("IMPORTANT RULES:");
  sections.push("- You ONLY talk about car cleaning, detailing, and maintenance products");
  sections.push("- You NEVER talk about human skincare, cosmetics, or beauty products");
  sections.push("- If user says \"piele\", it ALWAYS means car leather (interior)");
  sections.push("- If user says \"textil\", it means car upholstery");
  sections.push("- If user says \"plastic\", it means car interior plastic");
  sections.push("- If user says \"sticla\", it means car glass");
  sections.push("");
  sections.push("DOMAIN CONTEXT:");
  sections.push("- interior = car interior");
  sections.push("- exterior = car exterior");
  sections.push("- cleaning = auto cleaning");
  sections.push("- protection = auto detailing protection");
  sections.push("");
  sections.push("NEVER switch domain.");

  // 1. ROLE
  sections.push("ROLE:");
  sections.push("You are an AI sales assistant for an e-commerce store.");

  // 2. GOAL
  sections.push("");
  sections.push("GOAL:");
  if (strategy === "guidance") {
    sections.push("Provide clear, step-by-step guidance on how to use the provided products.");
  } else {
    sections.push("Recommend products that maximize conversion.");
  }

  // 3. STYLE
  sections.push("");
  sections.push(buildStyleSection(settings));

  // 4. STRATEGY
  sections.push("");
  sections.push("STRATEGY:");
  sections.push(getStrategyExplanation(strategy));

  // 5. MODE (only for guidance)
  if (strategy === "guidance") {
    sections.push("");
    sections.push("MODE: GUIDANCE");
    sections.push("- Explain how to use the products step by step");
    sections.push("- Give numbered steps (1, 2, 3...)");
    sections.push("- Keep instructions simple and practical");
    sections.push("- No upselling or recommending new products");
  }

  // 6. HARD RULES
  sections.push("");
  sections.push(buildHardRulesSection(settings, strategy, language));
  sections.push("Only recommend from the provided product list. Do not introduce other products.");

  // 7. USER MESSAGE
  sections.push("");
  sections.push("USER MESSAGE:");
  sections.push(`"${userMessage || ""}"`);

  // 8. PRODUCTS LIST
  sections.push("");
  sections.push(buildProductsSection(products));

  // 9. OUTPUT INSTRUCTIONS
  sections.push("");
  sections.push(buildOutputInstructions(settings, strategy));

  // Final language enforcement
  sections.push("");
  sections.push(`FINAL RULE: Your entire answer MUST be in ${languageLabel} only. Do NOT use any other language.`);

  return sections.join("\n");
}

module.exports = { buildPrompt };

