import React from "react";
import { Link } from "react-router-dom";

export default function BlogLayout({ children }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link
            to="/"
            className="text-base font-semibold tracking-tight text-slate-900 hover:text-slate-700"
          >
            Posto
          </Link>
          <nav className="text-sm">
            <Link to="/blog" className="text-slate-600 hover:text-slate-900">
              Blog
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-slate-500">
          &copy; {new Date().getFullYear()} Posto
        </div>
      </footer>
    </div>
  );
}
