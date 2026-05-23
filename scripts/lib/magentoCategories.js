/**
 * Magento category tree fetch + path resolution for product import.
 */

const SYNTHETIC_ROOT_NAMES = /^root\s*catalog$/i;

/**
 * @param {object} node
 * @param {string[]} pathParts
 * @returns {boolean}
 */
function shouldSkipAsSyntheticRoot(node, pathParts) {
  if (pathParts.length > 0) {
    return false;
  }
  const name = String(node?.name || "").trim();
  if (SYNTHETIC_ROOT_NAMES.test(name)) {
    return true;
  }
  if (node?.is_active === false) {
    return true;
  }
  return false;
}

/**
 * Walk category tree depth-first; map category id → slash-separated path.
 * @param {object} tree
 * @returns {Map<number, string>}
 */
function flattenCategoryTree(tree) {
  const map = new Map();

  function walk(node, pathParts) {
    if (!node || typeof node !== "object") {
      return;
    }

    const name = String(node.name || "").trim();
    let nextPath = pathParts;

    if (!shouldSkipAsSyntheticRoot(node, pathParts) && name) {
      nextPath = [...pathParts, name];
    }

    const id = Number(node.id);
    if (!Number.isNaN(id) && nextPath.length > 0) {
      map.set(id, nextPath.join(" / "));
    }

    const children = Array.isArray(node.children_data) ? node.children_data : [];
    for (const child of children) {
      walk(child, nextPath);
    }
  }

  walk(tree, []);
  return map;
}

/**
 * Pick deepest category path; tiebreak alphabetical.
 * @param {number[]} categoryIds
 * @param {Map<number, string>} treeMap
 * @returns {string}
 */
function resolveCategoryPath(categoryIds, treeMap) {
  if (!Array.isArray(categoryIds) || categoryIds.length === 0 || !treeMap || treeMap.size === 0) {
    return "";
  }

  const paths = categoryIds
    .map((id) => treeMap.get(Number(id)))
    .filter((path) => typeof path === "string" && path.length > 0);

  if (paths.length === 0) {
    return "";
  }

  paths.sort((a, b) => {
    const depthA = (a.match(/\//g) || []).length;
    const depthB = (b.match(/\//g) || []).length;
    if (depthB !== depthA) {
      return depthB - depthA;
    }
    return a.localeCompare(b);
  });

  return paths[0];
}

/**
 * @param {{ baseUrl: string, token: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<object>}
 */
async function fetchCategoryTree({ baseUrl, token, fetchImpl = fetch }) {
  const url = `${baseUrl}/rest/V1/categories`;
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Magento categories API error: ${response.status}`);
  }

  return response.json();
}

module.exports = {
  fetchCategoryTree,
  flattenCategoryTree,
  resolveCategoryPath,
  shouldSkipAsSyntheticRoot
};
