const fs = require("fs");
const path = require("path");
const { resolveProductsForRole } = require("../services/flowExecutor");

const ROOT = path.join(__dirname, "..");
const PRODUCTS_PATH = path.join(ROOT, "data", "products.json");
const FLOWS_DIR = path.join(ROOT, "flows");
const REPORTS_DIR = path.join(ROOT, "reports");
const REPORT_PATH = path.join(REPORTS_DIR, "role-coverage-report.json");

const ENABLE_LLM_FALLBACK = process.env.ENABLE_LLM_FALLBACK === "1";
const MAX_CANDIDATES_PER_ROLE = 10;

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectRoleOccurrences() {
  const flowFiles = fs.readdirSync(FLOWS_DIR).filter((name) => name.endsWith(".json")).sort();
  const occurrencesByRole = new Map();

  for (const file of flowFiles) {
    const flow = loadJson(path.join(FLOWS_DIR, file));
    const steps = Array.isArray(flow?.steps) ? flow.steps : [];

    for (const step of steps) {
      const roles = Array.isArray(step?.roles)
        ? step.roles
        : Array.isArray(step?.productRoles)
          ? step.productRoles
          : [];

      for (const role of roles) {
        if (!occurrencesByRole.has(role)) {
          occurrencesByRole.set(role, {
            role,
            occurrences: 0,
            flowFiles: new Set()
          });
        }

        const record = occurrencesByRole.get(role);
        record.occurrences += 1;
        record.flowFiles.add(file);
      }
    }
  }

  return Array.from(occurrencesByRole.values())
    .map((record) => ({
      role: record.role,
      occurrences: record.occurrences,
      flowFiles: Array.from(record.flowFiles).sort()
    }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

function scoreCandidateForRole(product, roleTokens) {
  const haystack = normalizeText(
    [product?.name, product?.description, product?.searchText]
      .filter(Boolean)
      .join(" ")
  );

  if (!haystack) {
    return 0;
  }

  let score = 0;
  for (const token of roleTokens) {
    if (!token) continue;
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function pickCandidatesForRole(products, role) {
  const roleTokens = String(role || "")
    .split("_")
    .map((token) => normalizeText(token))
    .filter(Boolean);

  if (roleTokens.length === 0) {
    return [];
  }

  return products
    .map((product) => ({
      product,
      score: scoreCandidateForRole(product, roleTokens)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.product?.name || "").localeCompare(String(b.product?.name || ""));
    })
    .slice(0, MAX_CANDIDATES_PER_ROLE)
    .map((entry) => entry.product);
}

async function buildLlmFallbackSuggestions(products, missingRole) {
  const candidates = pickCandidatesForRole(products, missingRole.role);
  if (candidates.length === 0) {
    return [];
  }

  const { generateTagsForProduct } = require("./autoTagProducts");
  const suggestions = [];

  for (const candidate of candidates) {
    const currentTags = Array.isArray(candidate?.tags) ? candidate.tags : [];
    if (currentTags.length > 0) {
      continue;
    }

    try {
      const proposedTags = await generateTagsForProduct(candidate);
      suggestions.push({
        productId: candidate?.id ?? null,
        productName: candidate?.name ?? null,
        proposedTags: Array.isArray(proposedTags) ? proposedTags : []
      });
    } catch (error) {
      suggestions.push({
        productId: candidate?.id ?? null,
        productName: candidate?.name ?? null,
        proposedTags: [],
        error: String(error?.message || "tag_generation_failed")
      });
    }
  }

  return suggestions;
}

async function main() {
  const products = loadJson(PRODUCTS_PATH);
  const roleOccurrences = collectRoleOccurrences();

  const rolesWithZeroMatchingProducts = [];

  for (const roleInfo of roleOccurrences) {
    const resolved = resolveProductsForRole(roleInfo.role, products);
    if (!Array.isArray(resolved) || resolved.length < 1) {
      const item = {
        role: roleInfo.role,
        occurrences: roleInfo.occurrences,
        flowFiles: roleInfo.flowFiles,
        suggestedFix: {
          type: "mapping_or_tags",
          notes: "Role exists in flows but 0 matches in catalog. Check product_roles.json mapping and product tags."
        }
      };

      if (ENABLE_LLM_FALLBACK) {
        item.llmFallback = {
          enabled: true,
          maxCandidates: MAX_CANDIDATES_PER_ROLE,
          proposals: await buildLlmFallbackSuggestions(products, roleInfo)
        };
      }

      rolesWithZeroMatchingProducts.push(item);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    llmFallbackEnabled: ENABLE_LLM_FALLBACK,
    totalProducts: Array.isArray(products) ? products.length : 0,
    totalRolesChecked: roleOccurrences.length,
    rolesWithZeroMatchingProducts
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`Coverage report written: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`Roles checked: ${report.totalRolesChecked}`);
  console.log(`Roles with zero matches: ${report.rolesWithZeroMatchingProducts.length}`);
}

main().catch((error) => {
  console.error("Failed to build coverage report:", error?.message || error);
  process.exitCode = 1;
});
