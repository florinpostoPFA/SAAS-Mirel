import React from "react";
import { Link } from "react-router-dom";
import SeoHead from "../seo/SeoHead";

export default function PortfolioPage() {
  return (
    <div className="px-4 py-16 sm:px-6">
      <SeoHead
        title="Portfolio — PostoSaaS"
        description="Case studies from PostoSaaS — coming soon."
        path="/portfolio"
      />

      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-300">
          Portfolio
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
          Case studies coming soon
        </h1>
        <p className="mt-6 text-lg text-slate-300">
          Detailed write-ups of shipped work will land here. In the meantime,
          you can follow the thinking on the{" "}
          <Link to="/blog" className="text-indigo-300 hover:text-indigo-200">
            blog
          </Link>{" "}
          or{" "}
          <Link to="/contact" className="text-indigo-300 hover:text-indigo-200">
            get in touch
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
