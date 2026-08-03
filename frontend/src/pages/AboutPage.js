import React from "react";
import SeoHead from "../seo/SeoHead";

const ABOUT_PARAGRAPHS = [
  "I've spent more than 20 years designing, improving, and delivering complex systems where reliability isn't a feature—it's a requirement.",
  "My career began in telecom operations, working with international voice traffic, SIP routing, and real-time communication systems. Over the years I progressed through technical support, quality assurance, and project management, always staying close to the technology and the teams building it. I've had the opportunity to contribute to the redesign of a telecom platform that today processes millions of calls every day with high reliability.",
  "What has remained constant throughout my career is a passion for understanding how systems work. I enjoy breaking down complex problems, finding practical solutions, and building products that are dependable, scalable, and easy to use.",
  "Today my work extends beyond telecom. I'm building software products across different domains, applying the same engineering mindset I've developed over two decades: solve real problems, keep things simple, and build with reliability in mind.",
  "I don't believe great software comes from chasing trends. It comes from understanding users, making thoughtful decisions, and continuously improving through feedback and iteration.",
  "Whether I'm working on communication platforms, SaaS products, or new ideas, my goal is always the same: build systems that people can trust.",
];

const TIMELINE = [
  {
    period: "2004 — present",
    title: "Telecom & operations",
    body: "Twenty-one years across telecom and operator environments — systems that have to work when real customers and real traffic are on the line.",
  },
  {
    period: "Hands-on builder",
    title: "Spec is not enough",
    body: "I design, ship, and operate — staying close to production behavior instead of handing off a slide deck and walking away.",
  },
  {
    period: "Now",
    title: "Building",
    body: "Creating AI agents that capture an operator's specialty knowledge and hold real conversations — chat and voice — for European businesses.",
  },
];

const CURRENT_FOCUS = [
  "AI agents that encode how specialists actually work, not generic chatbot scripts",
  "Conversational surfaces in chat and voice that stay grounded in business knowledge",
  "Shipping on real traffic with lean, cost-efficient local infrastructure",
];

export default function AboutPage() {
  return (
    <div className="px-4 py-16 sm:px-6">
      <SeoHead
        title="About — PostoSaaS"
        description="More than 20 years designing and delivering reliable systems — from telecom operations to software products built with trust and simplicity in mind."
        path="/about"
      />

      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-300">
          About
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
          About Me
        </h1>
        <div className="mt-6 space-y-5 text-lg leading-relaxed text-slate-300">
          {ABOUT_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph.slice(0, 48)}>{paragraph}</p>
          ))}
        </div>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold text-white">Current focus</h2>
          <ul className="mt-6 space-y-3">
            {CURRENT_FOCUS.map((item) => (
              <li
                key={item}
                className="flex gap-3 text-slate-300"
              >
                <span
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400"
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold text-white">Career timeline</h2>
          <ol className="mt-8 space-y-8 border-l border-white/15 pl-6">
            {TIMELINE.map((entry) => (
              <li key={entry.title} className="relative">
                <span
                  className="absolute -left-[1.625rem] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-400"
                  aria-hidden="true"
                />
                <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">
                  {entry.period}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">
                  {entry.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {entry.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
