import React from "react";
import { Link } from "react-router-dom";

/**
 * @param {"dark"|"light"} variant
 */
export default function SiteFooter({ variant = "dark" }) {
  const isDark = variant === "dark";
  const shell = isDark
    ? "border-t border-white/10 bg-[#0a0f1c] text-slate-400"
    : "border-t border-slate-200 bg-white text-slate-500";
  const link = isDark
    ? "text-slate-300 hover:text-white"
    : "text-slate-600 hover:text-slate-900";

  return (
    <footer className={shell}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="text-sm">
          &copy; {new Date().getFullYear()} PostoSaaS
          {(process.env.REACT_APP_GIT_SHA || process.env.REACT_APP_BUILD_TIME) && (
            <p className="mt-2 font-mono text-xs opacity-70">
              {process.env.REACT_APP_GIT_SHA && (
                <span>Version: {process.env.REACT_APP_GIT_SHA}</span>
              )}
              {process.env.REACT_APP_BUILD_TIME && (
                <span className="ml-2">Built: {process.env.REACT_APP_BUILD_TIME}</span>
              )}
            </p>
          )}
        </div>
        <nav className="flex flex-wrap gap-4 text-sm" aria-label="Footer">
          <Link to="/about" className={link}>
            About
          </Link>
          <Link to="/blog" className={link}>
            Blog
          </Link>
          <Link to="/portfolio" className={link}>
            Portfolio
          </Link>
          <Link to="/contact" className={link}>
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}
