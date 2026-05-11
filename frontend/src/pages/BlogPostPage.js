import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { marked } from "marked";
import { getPostBySlug, hasPost, loadPostMarkdown } from "../blog/blogData";
import SeoHead from "../seo/SeoHead";

marked.setOptions({
  gfm: true,
  breaks: false,
});

const renderer = new marked.Renderer();
const baseImageRenderer = renderer.image.bind(renderer);
renderer.image = function image(href, title, text) {
  const html = baseImageRenderer(href, title, text);
  return html.replace("<img ", '<img loading="lazy" ');
};

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

export default function BlogPostPage() {
  const { slug } = useParams();
  const post = getPostBySlug(slug);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!post || !hasPost(slug)) {
      setLoading(false);
      setError("Post not found.");
      setHtml("");
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError("");

    loadPostMarkdown(slug)
      .then((markdown) => {
        if (cancelled) return;
        const parsed = marked.parse(markdown, { renderer });
        setHtml(parsed);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load post.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!post) {
    return (
      <div>
        <p className="text-slate-700">Post not found.</p>
        <Link to="/blog" className="mt-4 inline-block text-indigo-600 hover:underline">
          &larr; Back to blog
        </Link>
      </div>
    );
  }

  return (
    <article>
      <SeoHead
        title={`${post.title} — Posto Blog`}
        description={post.description}
        path={`/blog/${post.slug}`}
        image={post.coverImage}
        type="article"
      />

      <Link
        to="/blog"
        className="mb-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700"
      >
        &larr; Back to blog
      </Link>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {post.title}
        </h1>
        <p className="mt-2 text-sm text-slate-500">{formatDate(post.date)}</p>
      </header>

      {post.coverImage && (
        <div
          className="mb-8 overflow-hidden rounded-2xl bg-slate-100"
          style={{ aspectRatio: "16 / 9" }}
        >
          <img
            src={post.coverImage}
            alt={post.title}
            loading="eager"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {loading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && (
        <div
          className="prose prose-slate mt-8 max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </article>
  );
}
