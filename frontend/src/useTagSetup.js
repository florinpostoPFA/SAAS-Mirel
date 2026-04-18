import { useEffect, useState } from "react";

const PRODUCTS_ENDPOINT = `${process.env.REACT_APP_API_URL}/products`;

function normalizeProduct(product) {
  return {
    ...product,
    aiTags: Array.isArray(product.aiTags) ? product.aiTags : [],
    originalTags: Array.isArray(product.originalTags) ? product.originalTags : [],
  };
}

function getDetectedTags(input) {
  const normalizedInput = input.toLowerCase();
  const detectedTags = [];

  if (normalizedInput.includes("cotiera") || normalizedInput.includes("interior")) {
    detectedTags.push("interior");
  }
  if (
    normalizedInput.includes("murdar") ||
    normalizedInput.includes("pata") ||
    normalizedInput.includes("curata")
  ) {
    detectedTags.push("cleaning");
  }
  if (normalizedInput.includes("piele") || normalizedInput.includes("leather")) {
    detectedTags.push("leather");
  }

  return [...new Set(detectedTags)];
}

function getMatchedProducts(products, detectedTags) {
  return products
    .map((product) => {
      const matchedBecause = detectedTags.filter((tag) => product.aiTags.includes(tag));
      return { ...product, matchedBecause };
    })
    .filter((product) => product.matchedBecause.length > 0);
}

export default function useTagSetup() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    fetch(PRODUCTS_ENDPOINT)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch products");
        }

        return res.json();
      })
      .then((data) => {
        setProducts((data || []).map(normalizeProduct));
      })
      .catch(() => {
        setError("Failed to load products.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const addTag = (productId, newTag) => {
    const trimmedTag = newTag.trim().toLowerCase();
    if (!trimmedTag) return;

    setProducts((prev) =>
      prev.map((product) =>
        product.id === productId && !product.aiTags.includes(trimmedTag)
          ? { ...product, aiTags: [...product.aiTags, trimmedTag] }
          : product
      )
    );
  };

  const removeTag = (productId, tagToRemove) => {
    setProducts((prev) =>
      prev.map((product) =>
        product.id === productId
          ? {
              ...product,
              aiTags: product.aiTags.filter((tag) => tag !== tagToRemove),
            }
          : product
      )
    );
  };

  const simulateAI = () => {
    const detectedTags = getDetectedTags(testInput);
    const matchedProducts = getMatchedProducts(products, detectedTags);

    setTestResult({ tags: detectedTags, matchedProducts });
  };

  return {
    addTag,
    error,
    loading,
    products,
    removeTag,
    setTestInput,
    simulateAI,
    testInput,
    testResult,
  };
}