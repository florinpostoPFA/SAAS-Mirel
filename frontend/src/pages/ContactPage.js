import React from "react";
import SeoHead from "../seo/SeoHead";

const CONTACT_EMAIL = "florin@postosaas.com";

export default function ContactPage() {
  return (
    <div className="px-4 py-16 sm:px-6">
      <SeoHead
        title="Contact — PostoSaaS"
        description="Get in touch with PostoSaaS — partnerships, projects, and conversations about AI agents for operators."
        path="/contact"
      />

      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-300">
          Contact
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
          Get in touch
        </h1>
        <p className="mt-6 text-lg text-slate-300">
          Interested in working together, or just want to talk through an idea?
          Reach me directly by email.
        </p>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="mt-10 inline-block rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400"
        >
          {CONTACT_EMAIL}
        </a>
        <p className="mt-6 text-sm text-slate-500">
          Prefer an alias?{" "}
          <a
            href="mailto:contact@postosaas.com"
            className="text-indigo-300 hover:text-indigo-200"
          >
            contact@postosaas.com
          </a>{" "}
          also reaches me.
        </p>
      </div>
    </div>
  );
}
