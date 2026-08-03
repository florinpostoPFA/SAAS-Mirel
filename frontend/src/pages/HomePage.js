import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { getAllPosts } from "../blog/blogData";
import SeoHead from "../seo/SeoHead";

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const DIFFERENTIATORS = [
  {
    title: "Build and operate",
    body: "Not just spec-and-handoff — I ship systems and stay accountable for how they run in production.",
  },
  {
    title: "Production-speed delivery",
    body: "Shipped and proven on real traffic in weeks, not quarters of slideware.",
  },
  {
    title: "Cost-efficient local infrastructure",
    body: "Practical hosting and ops that keep European workloads close, lean, and under control.",
  },
];

export default function HomePage() {
  const recentPosts = useMemo(() => getAllPosts().slice(0, 3), []);

  return (
    <div>
      <SeoHead
        title="PostoSaaS — builder & operator of AI assistants"
        description="Hands-on builder and operator creating AI agents that capture specialty knowledge and hold real conversations — chat and voice — for European businesses."
        path="/"
      />

      {/* Hero */}
      <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(79,70,229,0.25),_transparent_55%)]"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-indigo-300">
            PostoSaaS
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Building AI systems that capture operational expertise.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
            From telecom and voice platforms to SaaS products, I build AI Agents
            that learn how experts work and deliver that knowledge through
            natural conversations in chat and voice.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/contact"
              className="rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400"
            >
              Get in touch
            </Link>
            <Link
              to="/about"
              className="rounded-lg border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              See what I&apos;m building
            </Link>
          </div>
        </div>
      </section>

      {/* Differentiators */}
      <section className="border-t border-white/10 px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-white">
            What differentiates me
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
            Twenty-two years in telecom. Hands-on builder and operator — currently
            building reliable, deterministic AI Systems.
          </p>
          <ul className="mt-12 grid gap-8 sm:grid-cols-3">
            {DIFFERENTIATORS.map((item) => (
              <li key={item.title}>
                <h3 className="text-lg font-semibold text-indigo-200">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Blog preview */}
      <section className="border-t border-white/10 px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                From the blog
              </h2>
              <p className="mt-2 text-slate-400">
                Technical and strategic essays — generalizable, no client gossip.
              </p>
            </div>
            <Link
              to="/blog"
              className="text-sm font-medium text-indigo-300 hover:text-indigo-200"
            >
              View all writing →
            </Link>
          </div>

          {recentPosts.length === 0 ? (
            <p className="mt-8 text-slate-500">Posts coming soon.</p>
          ) : (
            <ul className="mt-10 grid gap-6 sm:grid-cols-3">
              {recentPosts.map((post) => (
                <li key={post.slug}>
                  <Link
                    to={`/blog/${post.slug}`}
                    className="block h-full rounded-xl border border-white/10 bg-white/5 p-5 transition hover:border-indigo-400/40 hover:bg-white/[0.07]"
                  >
                    <p className="text-xs text-slate-500">
                      {formatDate(post.date)}
                    </p>
                    <h3 className="mt-2 text-base font-semibold text-white">
                      {post.title}
                    </h3>
                    {post.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-400">
                        {post.description}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
