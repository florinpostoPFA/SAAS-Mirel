import React, { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAllPosts, getAllCategories } from "../blog/blogData";
import SeoHead from "../seo/SeoHead";

const ALL_CATEGORIES = "all";
const BLOG_DESCRIPTION =
  "Technical and strategic essays — generalizable, no client gossip.";

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogIndexPage() {
  const allPosts = useMemo(() => getAllPosts(), []);
  const categories = useMemo(() => getAllCategories(), []);

  const [searchParams, setSearchParams] = useSearchParams();
  const rawCategory = searchParams.get("category");
  const activeCategory =
    rawCategory && categories.includes(rawCategory) ? rawCategory : ALL_CATEGORIES;

  const visiblePosts = useMemo(() => {
    if (activeCategory === ALL_CATEGORIES) return allPosts;
    return allPosts.filter((p) => p.categories.includes(activeCategory));
  }, [allPosts, activeCategory]);

  const handleSelect = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === ALL_CATEGORIES) {
      params.delete("category");
    } else {
      params.set("category", next);
    }
    setSearchParams(params, { replace: false });
  };

  return (
    <div>
      <SeoHead
        title="Blog — PostoSaaS"
        description={BLOG_DESCRIPTION}
        path="/blog"
      />

      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-300">
          Writing
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Blog
        </h1>
        <p className="mt-3 text-lg text-slate-300">{BLOG_DESCRIPTION}</p>
      </header>

      {categories.length > 0 && (
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs uppercase tracking-wide text-slate-500">
            Filter:
          </span>
          <FilterPill
            label="All"
            active={activeCategory === ALL_CATEGORIES}
            onClick={() => handleSelect(ALL_CATEGORIES)}
          />
          {categories.map((category) => (
            <FilterPill
              key={category}
              label={category}
              active={activeCategory === category}
              onClick={() => handleSelect(category)}
            />
          ))}
        </div>
      )}

      {visiblePosts.length === 0 ? (
        <p className="text-slate-500">No posts in this category.</p>
      ) : (
        <ul className="space-y-4">
          {visiblePosts.map((post) => (
            <li key={post.slug}>
              <Link
                to={`/blog/${post.slug}`}
                className="block rounded-xl border border-white/10 bg-white/5 p-5 transition hover:border-indigo-400/40 hover:bg-white/[0.07]"
              >
                <h2 className="text-xl font-semibold text-white">
                  {post.title}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {formatDate(post.date)}
                </p>
                {post.description && (
                  <p className="mt-2 text-slate-300">{post.description}</p>
                )}
                {post.categories.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {post.categories.map((category) => (
                      <span
                        key={category}
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-slate-300"
                      >
                        {category}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterPill({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-3 py-1 text-sm font-medium transition " +
        (active
          ? "border-indigo-400 bg-indigo-500 text-white"
          : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10")
      }
    >
      {label}
    </button>
  );
}
