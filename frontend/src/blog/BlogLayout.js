import React from "react";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";

export default function BlogLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <SiteHeader variant="light" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>

      <SiteFooter variant="light" />
    </div>
  );
}
