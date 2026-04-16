

import { useState } from "react";

export default function ProductAIDashboard() {
  const [products, setProducts] = useState([
    {
      id: 1,
      name: "CarPro Interior Cleaner",
      aiTags: ["cleaning", "interior", "leather"],
      originalTags: ["cleaner", "carpro", "interior care"],
    },
  ]);

  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState(null);

  const addTag = (productId, newTag) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId && !p.aiTags.includes(newTag)
          ? { ...p, aiTags: [...p.aiTags, newTag] }
          : p
      )
    );
  };

  const removeTag = (productId, tag) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? { ...p, aiTags: p.aiTags.filter((t) => t !== tag) }
          : p
      )
    );
  };

  const simulateAI = () => {
    // fake logic for demo
    const tags = [];
    const input = testInput.toLowerCase();

    if (input.includes("cotiera")) tags.push("interior");
    if (input.includes("murdar")) tags.push("cleaning");

    const matchedProducts = products.filter((p) =>
      tags.every((tag) => p.aiTags.includes(tag))
    );

    setTestResult({ tags, matchedProducts });
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">AI Product Intelligence</h1>

      {/* Product List */}
      {products.map((product) => (
        <div key={product.id} className="border p-4 rounded-2xl shadow">
          <h2 className="font-semibold text-lg">{product.name}</h2>

          <div className="mt-2">
            <p className="text-sm text-gray-500">AI Tags</p>
            <div className="flex gap-2 flex-wrap mt-1">
              {product.aiTags.map((tag) => (
                <span
                  key={tag}
                  className="bg-blue-100 px-2 py-1 rounded-full text-sm cursor-pointer"
                  onClick={() => removeTag(product.id, tag)}
                >
                  {tag} ✕
                </span>
              ))}
            </div>

            <input
              placeholder="Add tag..."
              className="mt-2 border p-1 rounded"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addTag(product.id, e.currentTarget.value);
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>

          <div className="mt-3">
            <p className="text-sm text-gray-500">Original Tags</p>
            <div className="flex gap-2 flex-wrap mt-1">
              {product.originalTags.map((tag) => (
                <span
                  key={tag}
                  className="bg-gray-100 px-2 py-1 rounded-full text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}

      {/* Test AI */}
      <div className="border p-4 rounded-2xl shadow">
        <h2 className="font-semibold text-lg">Test AI</h2>

        <input
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder="Type customer message..."
          className="w-full border p-2 rounded mt-2"
        />

        <button
          onClick={simulateAI}
          className="mt-2 px-4 py-2 bg-black text-white rounded"
        >
          Run Test
        </button>

        {testResult && (
          <div className="mt-4">
            <p className="text-sm">Detected Tags:</p>
            <div className="flex gap-2 flex-wrap">
              {testResult.tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-green-100 px-2 py-1 rounded-full text-sm"
                >
                  {tag}
                </span>
              ))}
            </div>

            <p className="text-sm mt-2">Matched Products:</p>
            <ul className="list-disc ml-4">
              {testResult.matchedProducts.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
