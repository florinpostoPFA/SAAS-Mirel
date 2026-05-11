import postsIndex from "../content/blog/posts.json";
import helloWorldUrl from "../content/blog/posts/hello-world.md";
import shippingTheBlogUrl from "../content/blog/posts/shipping-the-blog.md";
import thePageLoadsMeansNothingUrl from "../content/blog/posts/the-page-loads-means-nothing.md";

function fetchMarkdown(url) {
  return fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(`Failed to load post markdown: ${res.status}`);
    }
    return res.text();
  });
}

const markdownLoaders = {
  "hello-world": () => fetchMarkdown(helloWorldUrl),
  "shipping-the-blog": () => fetchMarkdown(shippingTheBlogUrl),
  "the-page-loads-means-nothing": () =>
    fetchMarkdown(thePageLoadsMeansNothingUrl),
};

function normalizePost(post) {
  return {
    ...post,
    categories: Array.isArray(post.categories) ? post.categories : [],
  };
}

export function getAllPosts() {
  return [...postsIndex]
    .map(normalizePost)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug) {
  const post = postsIndex.find((p) => p.slug === slug);
  return post ? normalizePost(post) : null;
}

export function getAllCategories() {
  const set = new Set();
  for (const post of postsIndex) {
    const categories = Array.isArray(post.categories) ? post.categories : [];
    for (const c of categories) {
      if (typeof c === "string" && c.trim()) set.add(c);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function loadPostMarkdown(slug) {
  const loader = markdownLoaders[slug];
  if (!loader) {
    throw new Error(`No markdown registered for slug: ${slug}`);
  }
  return loader();
}

export function hasPost(slug) {
  return Boolean(getPostBySlug(slug)) && Boolean(markdownLoaders[slug]);
}
