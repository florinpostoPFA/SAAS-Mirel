import useTagSetup from "./useTagSetup";

export default function TagSetupPage() {
  const {
    addTag,
    error,
    loading,
    products,
    removeTag,
    setTestInput,
    simulateAI,
    testInput,
    testResult,
  } = useTagSetup();

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <header className="space-y-1">
          <h1 className="text-3xl font-bold text-slate-900">Tag Setup</h1>
          <p className="text-sm text-slate-600">Manage AI tags and test product matching.</p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800">Test Tagging</h2>

          <div className="mt-4 space-y-3">
            <input
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Type customer message..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
            />

            <button
              type="button"
              onClick={simulateAI}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              Run Test
            </button>
          </div>

          {testResult && (
            <div className="mt-6 space-y-4 border-t border-slate-100 pt-4">
              <div>
                <p className="text-sm font-medium text-slate-700">Detected Tags</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {testResult.tags.length > 0 ? (
                    testResult.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-slate-500">No tags detected.</span>
                  )}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700">Matched Products</p>
                {testResult.matchedProducts.length > 0 ? (
                  <ul className="mt-2 space-y-2 text-sm text-slate-800">
                    {testResult.matchedProducts.map((product) => (
                      <li key={product.id} className="rounded-lg bg-slate-50 px-3 py-2">
                        <div className="font-medium">{product.name}</div>
                        <div className="text-slate-600">
                          Matched because: {product.matchedBecause.join(", ")}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No matching products.</p>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-800">Products</h2>

          {loading && <p>Loading...</p>}
          {error && <p>{error}</p>}

          <div className="grid gap-4 md:grid-cols-2">
            {products.map((product) => (
              <article
                key={product.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-slate-900">{product.name}</h3>

                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Assigned Tags
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {product.aiTags.length > 0 ? (
                        product.aiTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-500">No assigned tags.</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Original Tags
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {product.originalTags.length > 0 ? (
                        product.originalTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-500">No original tags.</span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-800">Tag Editing</h2>

          <div className="grid gap-4 md:grid-cols-2">
            {products.map((product) => (
              <article
                key={product.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-slate-900">{product.name}</h3>

                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">AI Tags</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {product.aiTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => removeTag(product.id, tag)}
                          className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 transition hover:bg-blue-200"
                        >
                          {tag} ×
                        </button>
                      ))}
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="Add new AI tag and press Enter"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-blue-300 focus:ring"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addTag(product.id, e.currentTarget.value);
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}