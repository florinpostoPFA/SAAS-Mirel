import React from "react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";

/**
 * Presentation-site shell (dark navy). Blog keeps BlogLayout + light variant header.
 */
export default function SiteLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0a0f1c] text-white">
      <SiteHeader variant="dark" />
      <main className="flex-1">{children}</main>
      <SiteFooter variant="dark" />
    </div>
  );
}
