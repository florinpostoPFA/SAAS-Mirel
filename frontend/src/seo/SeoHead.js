import React from "react";
import { Helmet } from "react-helmet-async";

const DEFAULT_SITE_URL =
  process.env.REACT_APP_SITE_URL || "https://postosaas.com";

function buildAbsoluteUrl(path) {
  const base = DEFAULT_SITE_URL.replace(/\/$/, "");
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function SeoHead({
  title,
  description,
  path,
  image,
  type = "website",
}) {
  const canonical = path ? buildAbsoluteUrl(path) : undefined;
  const ogImage = image ? buildAbsoluteUrl(image) : undefined;

  return (
    <Helmet>
      {title && <title>{title}</title>}
      {description && <meta name="description" content={description} />}
      {canonical && <link rel="canonical" href={canonical} />}

      {title && <meta property="og:title" content={title} />}
      {description && <meta property="og:description" content={description} />}
      <meta property="og:type" content={type} />
      {canonical && <meta property="og:url" content={canonical} />}
      {ogImage && <meta property="og:image" content={ogImage} />}

      <meta name="twitter:card" content={ogImage ? "summary_large_image" : "summary"} />
      {title && <meta name="twitter:title" content={title} />}
      {description && <meta name="twitter:description" content={description} />}
      {ogImage && <meta name="twitter:image" content={ogImage} />}
    </Helmet>
  );
}
