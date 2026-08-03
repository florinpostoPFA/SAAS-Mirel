/**
 * Build gate: every posts.json slug must appear as <loc> in public/sitemap.xml
 * under REACT_APP_SITE_URL or default https://postosaas.com (must match SeoHead).
 */
const fs = require("fs");
const path = require("path");

const base = (process.env.REACT_APP_SITE_URL || "https://postosaas.com").replace(
  /\/$/,
  ""
);
const rootDir = path.join(__dirname, "..");
const postsPath = path.join(rootDir, "src", "content", "blog", "posts.json");
const sitemapPath = path.join(rootDir, "public", "sitemap.xml");

const posts = JSON.parse(fs.readFileSync(postsPath, "utf8"));
const sitemap = fs.readFileSync(sitemapPath, "utf8");

const required = [
  `${base}/`,
  `${base}/about`,
  `${base}/blog`,
  `${base}/portfolio`,
  `${base}/contact`,
];
for (const url of required) {
  if (!sitemap.includes(`>${url}<`)) {
    console.error(`check-sitemap-posts: missing sitemap entry for ${url}`);
    process.exit(1);
  }
}

for (const post of posts) {
  const slug = post && post.slug;
  if (!slug) continue;
  const needle = `${base}/blog/${slug}`;
  if (!sitemap.includes(needle)) {
    console.error(
      `check-sitemap-posts: missing <loc> for slug "${slug}" (expected ${needle})`
    );
    process.exit(1);
  }
}

console.log("check-sitemap-posts: OK");
