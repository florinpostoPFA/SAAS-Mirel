import React, { useState } from "react";
import { Link, NavLink } from "react-router-dom";

const NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/about", label: "About" },
  { to: "/blog", label: "Blog" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/contact", label: "Contact" },
];

/**
 * Shared public site header. Turbo is intentionally omitted from public nav.
 * @param {"dark"|"light"} variant — dark for presentation pages, light for blog shell
 */
export default function SiteHeader({ variant = "dark" }) {
  const [open, setOpen] = useState(false);
  const isDark = variant === "dark";

  const shell = isDark
    ? "border-b border-white/10 bg-[#0a0f1c]/text-white"
    : "border-b border-slate-200 bg-white text-slate-900";
  const brand = isDark
    ? "text-white hover:text-indigo-200"
    : "text-slate-900 hover:text-slate-700";
  const linkIdle = isDark
    ? "text-slate-300 hover:text-white"
    : "text-slate-600 hover:text-slate-900";
  const linkActive = isDark ? "text-white" : "text-slate-900";
  const menuBtn = isDark
    ? "border-white/20 text-white hover:bg-white/5"
    : "border-slate-300 text-slate-800 hover:bg-slate-50";

  return (
    <header className={shell}>
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/" className={`text-base font-semibold tracking-tight ${brand}`}>
          PostoSaaS
        </Link>

        <nav
          className="hidden items-center gap-6 text-sm font-medium md:flex"
          aria-label="Primary"
        >
          {NAV_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={Boolean(end)}
              className={({ isActive }) =>
                isActive ? linkActive : linkIdle
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          className={`rounded-lg border px-3 py-1.5 text-sm md:hidden ${menuBtn}`}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          Menu
        </button>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          className={`border-t px-4 py-3 md:hidden ${
            isDark ? "border-white/10" : "border-slate-200"
          }`}
          aria-label="Primary mobile"
        >
          <ul className="flex flex-col gap-3 text-sm font-medium">
            {NAV_LINKS.map(({ to, label, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={Boolean(end)}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    isActive ? linkActive : linkIdle
                  }
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
