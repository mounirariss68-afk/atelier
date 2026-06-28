import { useEffect, useState, useRef } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, ChevronDown, Check,
  Activity, Database, Cpu, ShieldCheck, Layers,
  FileText, Presentation, Hourglass, Link2, Target, Settings, Rocket, Lock,
} from "lucide-react";

const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

import slide1Desktop from "@assets/Slide_1_-_Mandays_to_outcomes_-_Desktop_1782396575628_t.png";
import slide1Mobile from "@assets/Slide1_-_Mandays_to_Outcomes_-_Mobile_1782396575628_t.png";
import slide2Desktop from "@assets/Slide_2-_48_hours_prototype_-_Desktop_1782396575628_t.png";
import slide2Mobile from "@assets/Slide_2-_48_hours_prototype_-_Mobile_1782396651537_t.png";
import slide3Desktop from "@assets/Slide_3-_No_PowerPoints_-_Desktop_1782396575628_t.png";
import slide3Mobile from "@assets/Slide_3_-_No_PowerPoints_-_Mobile_1782396575628_t.png";
import slide4Desktop from "@assets/Slide_4_-_No_Vendor_Lockin_-_Desktop_1782396575628_t.png";
import slide4Mobile from "@assets/Slide_4_-_No_Vendor_Lockin_-_Mobile_1782396575628_t.png";
import introTree from "@assets/tree_agentic_glow_1782618420404_t.png";
import humanAgent from "@assets/human_agent_v2.png";

type HeroSlide =
  | {
      kind?: "value";
      white: [string, string];
      gradient: [string, string];
      desktop: string;
      mobile: string;
    }
  | {
      kind: "intro";
      headline: string;
      headlineGradient: string;
      body: string;
      desktop: string;
      mobile: string;
    };

const slideLabel = (slide: HeroSlide) =>
  slide.kind === "intro"
    ? `${slide.headline} ${slide.headlineGradient}`
    : `${slide.white.join(" ")} ${slide.gradient.join(" ")}`;

const HERO_SLIDES: HeroSlide[] = [
  {
    kind: "intro",
    headline: "Built for the",
    headlineGradient: "Agentic Enterprise.",
    body: "Cognirise is an AI-native advisory and engineering firm specializing in agentic transformation and sovereign AI. We help organizations define their AI strategy, build production-grade AI systems, and deliver measurable business impact at enterprise scale.",
    desktop: introTree,
    mobile: introTree,
  },
  { white: ["We don't", "bill mandays."], gradient: ["We deliver", "outcomes."], desktop: slide1Desktop, mobile: slide1Mobile },
  { white: ["No long", "pilots."], gradient: ["Prototype in", "48 hours."], desktop: slide2Desktop, mobile: slide2Mobile },
  { white: ["We don't build", "PowerPoints."], gradient: ["We build", "working solutions."], desktop: slide3Desktop, mobile: slide3Mobile },
  { white: ["No vendor", "lock-in."], gradient: ["You own", "the solution."], desktop: slide4Desktop, mobile: slide4Mobile },
];

/* ---------- Hero carousel ---------- */
function HeroCarousel() {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;
    const id = window.setInterval(() => {
      setSelected((s) => (s + 1) % HERO_SLIDES.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="relative min-h-[100dvh] flex items-center overflow-hidden bg-navy">
      {/* Background treatment */}
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-navy via-navy to-navy" />
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_30%_40%,rgba(91,124,255,0.18),transparent_55%)]" />

      {/* Floating glows */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="glow-a absolute top-[18%] left-[8%] w-[34rem] h-[34rem] rounded-full bg-cogblue/25 blur-[120px]" />
        <div className="glow-b absolute bottom-[6%] right-[6%] w-[30rem] h-[30rem] rounded-full bg-cogmagenta/22 blur-[120px]" />
      </div>

      {/* Content: text left, image right (40%) */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 w-full pt-24 pb-16 md:pb-0 grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-10 md:gap-10 items-center">
        {/* Left: message + CTAs */}
        <div className="relative z-20">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-gradient-bright text-base sm:text-lg md:text-xl font-bold mb-10 max-w-xl"
          >
            Professional services.<br />Rebuilt for the age of agents.
          </motion.p>

          <div className="min-h-[42vw] sm:min-h-[204px] md:min-h-[244px] lg:min-h-[276px]">
            <AnimatePresence mode="popLayout">
              {HERO_SLIDES[selected].kind === "intro" ? (
                <motion.div key={selected} className="max-w-2xl">
                  <motion.h1
                    className="text-[10vw] sm:text-[44px] md:text-[52px] lg:text-[60px] leading-[1.0] font-extrabold tracking-[-2px]"
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.55, ease: [0.21, 0.6, 0.35, 1] }}
                  >
                    <span className="block text-white">{HERO_SLIDES[selected].headline}</span>
                    <span className="block text-gradient-bright pb-2">{HERO_SLIDES[selected].headlineGradient}</span>
                  </motion.h1>
                  <motion.p
                    className="mt-5 text-offwhite/75 text-base sm:text-lg leading-relaxed max-w-xl"
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.55, delay: 0.08, ease: [0.21, 0.6, 0.35, 1] }}
                  >
                    {HERO_SLIDES[selected].body}
                  </motion.p>
                </motion.div>
              ) : (
                <motion.h1
                  key={selected}
                  className="text-[10vw] sm:text-[48px] md:text-[58px] lg:text-[66px] leading-[0.98] font-extrabold tracking-[-2px] max-w-2xl"
                >
                  <motion.span
                    className="block text-white"
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.55, ease: [0.21, 0.6, 0.35, 1] }}
                  >
                    {HERO_SLIDES[selected].white[0]}
                    <br />
                    {HERO_SLIDES[selected].white[1]}
                  </motion.span>
                  <motion.span
                    className="block text-gradient-bright pb-2"
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -14 }}
                    transition={{ duration: 0.55, delay: 0.08, ease: [0.21, 0.6, 0.35, 1] }}
                  >
                    {HERO_SLIDES[selected].gradient[0]}
                    <br />
                    {HERO_SLIDES[selected].gradient[1]}
                  </motion.span>
                </motion.h1>
              )}
            </AnimatePresence>
          </div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.45 }}
            className="flex flex-wrap items-center gap-4 mt-12">
            <a href="mailto:support@cognirise.ai" className="group inline-flex items-center gap-2 bg-cog-grad-diag text-white px-8 py-4 rounded-full text-base font-semibold shadow-[0_14px_40px_-10px_rgba(138,91,214,0.8)] hover:scale-[1.02] transition-transform">
              Book a 48-Hour Prototype <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
            <a href="#services" className="inline-flex items-center gap-2 text-offwhite/80 hover:text-white px-6 py-4 rounded-full border border-white/15 hover:border-white/30 transition-colors text-base font-medium">
              What we do
            </a>
          </motion.div>

          {/* Slide navigator */}
          <div className="flex items-center gap-3 mt-14">
            {HERO_SLIDES.map((slide, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(i)}
                aria-label={`Go to slide ${i + 1}: ${slideLabel(slide)}`}
                aria-current={selected === i}
                className="group h-3 flex items-center"
              >
                <span
                  className={`block h-[3px] rounded-full transition-all duration-500 ${
                    selected === i ? "w-12 bg-cog-grad" : "w-6 bg-white/25 group-hover:bg-white/50"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Right: crossfading slide image (decorative, sits behind text) */}
        <div className="w-full grid pointer-events-none md:absolute md:right-0 md:top-[58%] md:-translate-y-1/2 md:w-[87%] md:max-w-none md:z-0">
          {HERO_SLIDES.map((slide, i) => (
            <motion.div
              key={i}
              className="col-start-1 row-start-1"
              initial={false}
              animate={{ opacity: selected === i ? 1 : 0 }}
              transition={{ duration: 0.8, ease: "easeInOut" }}
            >
              <picture>
                <source media="(min-width: 768px)" srcSet={slide.desktop} />
                <img
                  src={slide.mobile}
                  alt={slideLabel(slide)}
                  loading={i === 0 ? "eager" : "lazy"}
                  className="w-full h-auto object-contain"
                />
              </picture>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 text-offwhite/50">
        <ChevronDown className="w-6 h-6 animate-bounce" />
      </div>
    </section>
  );
}

/* ---------- Scroll reveal ---------- */
function Reveal({
  children, delay = 0, y = 36, className = "",
}: { children: React.ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: [0.21, 0.6, 0.35, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 mb-6">
    <span className="grad-rule" />
    <p className="text-[11px] font-semibold tracking-[3px] text-mutedgrey uppercase">{children}</p>
  </div>
);

/* ---------- Count-up ---------- */
function Counter({ end, prefix = "", suffix = "", duration = 1.8 }: { end: number; prefix?: string; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const ob = new IntersectionObserver(([e]) => { if (e.isIntersecting) setSeen(true); }, { threshold: 0.3 });
    if (ref.current) ob.observe(ref.current);
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    let start: number | null = null;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min((t - start) / (duration * 1000), 1);
      setCount(Math.floor(p * end));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [seen, end, duration]);

  return <span ref={ref}>{prefix}{count}{suffix}</span>;
}

/* ===================== DATA ===================== */

type ProblemCard = {
  icon: typeof Database;
  accent: string;
  title: string;
  quote: string;
  points: string[];
};

const problemCards: ProblemCard[] = [
  {
    icon: Activity, accent: "#5B7CFF",
    title: "Agentic Enterprise Transformation",
    quote: "You’ve approved the pilots, run the workshops — and still, no value.",
    points: [
      "Agentic operating model, end to end",
      "FDEs embedded in your team",
      "Agents in production from day one",
    ],
  },
  {
    icon: Database, accent: "#8A5BD6",
    title: "Data & AI Foundations",
    quote: "You have the data. It’s siloed, ungoverned, and not powering anything.",
    points: [
      "Unified data platforms & pipelines",
      "Governance & AI operating models",
      "Built so agents can use it day one",
    ],
  },
  {
    icon: Cpu, accent: "#C45BB8",
    title: "Engineering with AI",
    quote: "You’re building far too slowly and paying too much for systems maintenance.",
    points: [
      "AI powered software development at scale",
      "AI powered legacy modernization",
      "Owned systems, on-premise capable",
    ],
  },
  {
    icon: Settings, accent: "#FF7B5A",
    title: "Sovereign Agent Studio",
    quote: "AI adoption stops at the tool level — no real productivity impact.",
    points: [
      "Agents alongside every individual",
      "End-to-end agentic workflows",
      "Autonomous processes with human-in-the-loop",
    ],
  },
  {
    icon: Layers, accent: "#5B7CFF",
    title: "Platforms",
    quote: "Many enterprise platforms. None of them are intelligent.",
    points: [
      "AI-native, built for enterprise",
      "Mission-specific agentic platforms solving toughest business problems",
      "You own it — no vendor lock-in",
    ],
  },
];

/* The transformation map — each row pairs an old-world cost (left) with the
   Cognirise outcome it becomes (right), wired through the central "new model"
   node. Used by <TransformationMap />. */
const transformPairs = [
  {
    old: { icon: FileText, title: "Man-days", lines: ["People tied up.", "Slow and expensive."] },
    cog: { icon: Target, title: "Outcomes", lines: ["Measured impact.", "Business results that matter."] },
  },
  {
    old: { icon: Presentation, title: "PowerPoints", lines: ["Endless decks.", "No real progress."] },
    cog: { icon: Settings, title: "Working solutions", lines: ["Production-ready.", "Built for scale."] },
  },
  {
    old: { icon: Hourglass, title: "Long pilots", lines: ["Months of pilots.", "Uncertain results."] },
    cog: { icon: Rocket, title: "48-hour prototype", lines: ["From idea to prototype", "in 48 hours."] },
  },
  {
    old: { icon: Link2, title: "Vendor lock-in", lines: ["Locked in.", "Hard to change."] },
    cog: { icon: Lock, title: "You own the platform", lines: ["No lock-in.", "Full transparency & control."] },
  },
];

/* ===================== INTERACTIVE: TRANSFORMATION MAP ===================== */
/* The "Traditional vs Cognirise" comparison. On large screens it renders the
   uploaded rendered artwork as four layered images (old-world costs on the left,
   the "new model" node in the centre, the Cognirise outcomes on the right),
   revealed in sequence. Below lg it falls back to legible hand-coded cards. */
function TransformationMap() {
  /* The diagram ships as a glowing connector backdrop plus four transparent layers
     (rendered artwork). Stacking them rebuilds the full comparison; revealing them in
     sequence walks the eye from the old-world model (left) through the new model
     (centre) to the outcomes (right). Each old cost is wired to the outcome it becomes,
     so hovering a row lights up that full transformation path. */
  const layers = [
    { src: "images/model/background.webp", from: { opacity: 0, scale: 1.04 }, delay: 0, z: 0 },
    { src: "images/model/traditional.png", from: { opacity: 0, x: -28 }, delay: 0.18, z: 1 },
    { src: "images/model/outcomes.png", from: { opacity: 0, x: 28 }, delay: 0.66, z: 1 },
    { src: "images/model/center.png", from: { opacity: 0, y: 16 }, delay: 0.54, z: 3 },
    { src: "images/model/logo.png", from: { opacity: 0, scale: 0.82 }, delay: 0.4, z: 4 },
  ];

  /* Connector geometry, fit to the actual backdrop streams (viewBox 952×481): the lit
     particle streams were sampled from background.png and each half (node→core) was
     least-squares fit as a cubic with horizontal tangents at both the node and the bright
     core at (474,256). Each flow runs left node → core → paired right node. Drawn BELOW the
     logo/centre layers (z 2 < z 3/4) so it disappears behind the central logo circle. */
  const flows = [
    { id: 0, d: "M262,137 C 367,137 304,256 474,256 C 644,256 563,137 668,137", label: "Man-days become measured outcomes" },
    { id: 1, d: "M262,219 C 337,219 294,256 474,256 C 654,256 573,219 668,219", label: "PowerPoints become working solutions" },
    { id: 2, d: "M262,312 C 357,312 374,256 474,256 C 654,256 553,312 668,312", label: "Long pilots become a 48-hour prototype" },
    { id: 3, d: "M262,388 C 387,388 294,256 474,256 C 654,256 543,389 668,389", label: "Vendor lock-in becomes platform ownership" },
  ];

  /* Invisible hover targets over each labelled item (4 left + 4 right), mapped to the
     flow they light up. Percentages are relative to the aspect-locked diagram box. */
  const hotspots: { flow: number; pos: React.CSSProperties }[] = [
    { flow: 0, pos: { left: "3%", top: "21%", width: "27%", height: "16%" } },
    { flow: 1, pos: { left: "3%", top: "39%", width: "27%", height: "16%" } },
    { flow: 2, pos: { left: "3%", top: "58%", width: "27%", height: "16%" } },
    { flow: 3, pos: { left: "3%", top: "74%", width: "27%", height: "16%" } },
    { flow: 0, pos: { right: "2%", top: "21%", width: "30%", height: "16%" } },
    { flow: 1, pos: { right: "2%", top: "39%", width: "30%", height: "16%" } },
    { flow: 2, pos: { right: "2%", top: "58%", width: "30%", height: "16%" } },
    { flow: 3, pos: { right: "2%", top: "74%", width: "30%", height: "16%" } },
  ];

  const [activeFlow, setActiveFlow] = useState<number | null>(null);

  return (
    <div className="relative">
      {/* ---- Large screens: the actual rendered diagram, revealed in sequence.
              Gated at lg so the baked-in text stays crisp (native artwork is 952px). ---- */}
      <div
        className="hidden lg:block relative w-full max-w-5xl mx-auto"
        style={{ aspectRatio: "952 / 481" }}
      >
        {layers.map((l) => (
          <motion.img
            key={l.src}
            src={asset(l.src)}
            alt=""
            aria-hidden="true"
            loading="lazy"
            draggable={false}
            initial={l.from}
            whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, delay: l.delay, ease: [0.21, 0.6, 0.35, 1] }}
            style={{ zIndex: l.z }}
            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
          />
        ))}

        {/* Highlight overlay — sits below the logo/centre (zIndex 2) so the lit path passes
            behind the central circle; the hovered path lights up and a pulse travels it */}
        <svg
          viewBox="0 0 952 481"
          preserveAspectRatio="xMidYMid meet"
          style={{ zIndex: 2 }}
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#5273f5" />
              <stop offset="50%" stopColor="#b95ac9" />
              <stop offset="100%" stopColor="#e75a60" />
            </linearGradient>
            <filter id="flowGlow" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {flows.map((f) => {
            const on = activeFlow === f.id;
            return (
              <g key={f.id} style={{ opacity: on ? 1 : 0, transition: "opacity .3s ease" }}>
                <path
                  d={f.d}
                  fill="none"
                  stroke="url(#flowGrad)"
                  strokeWidth={3}
                  strokeLinecap="round"
                  filter="url(#flowGlow)"
                />
                {on && (
                  <circle r="4.5" fill="#ffffff" filter="url(#flowGlow)" className="flow-pulse">
                    <animateMotion dur="1.2s" repeatCount="indefinite" path={f.d} />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        {/* Invisible hover targets over the labelled items (above every layer) */}
        <div className="absolute inset-0" style={{ zIndex: 5 }}>
          {hotspots.map((h, i) => (
            <button
              key={i}
              type="button"
              aria-label={flows[h.flow].label}
              onMouseEnter={() => setActiveFlow(h.flow)}
              onMouseLeave={() => setActiveFlow(null)}
              onFocus={() => setActiveFlow(h.flow)}
              onBlur={() => setActiveFlow(null)}
              className="absolute rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              style={h.pos}
            />
          ))}
        </div>
      </div>

      {/* Screen-reader equivalent of the diagram's baked-in text */}
      <p className="sr-only">
        From the traditional vendor model — man-days, PowerPoints, long pilots and
        vendor lock-in — to the Cognirise model: measured outcomes, working solutions,
        a 48-hour prototype and full platform ownership, powered by human and agent
        shared intelligence.
      </p>

      {/* ---- Phone & tablet stacked fallback (baked-in artwork text is too small below lg) ---- */}
      <div className="lg:hidden">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <h3 className="text-base font-semibold text-offwhite/80">Traditional vendor</h3>
          <h3 className="text-base font-semibold text-gradient text-right">cognirise</h3>
        </div>
        <div className="space-y-3">
          {transformPairs.map((p, i) => {
            const OldIcon = p.old.icon;
            const CogIcon = p.cog.icon;
            return (
              <div key={i} className="grid grid-cols-2 gap-3 items-stretch">
                <div className="rounded-xl border border-white/10 bg-navydeep/50 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <OldIcon className="w-4 h-4 text-offwhite/40 shrink-0" strokeWidth={1.6} />
                    <p className="text-[11px] font-semibold uppercase tracking-[1px] text-offwhite/70">{p.old.title}</p>
                  </div>
                  <p className="text-[12px] text-offwhite/45 leading-snug">{p.old.lines.join(" ")}</p>
                </div>
                <div className="grad-border bg-navylight/40 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <CogIcon className="w-4 h-4 shrink-0" strokeWidth={1.6} style={{ color: "#FF9E7A" }} />
                    <p className="text-[11px] font-semibold uppercase tracking-[1px] text-offwhite/90">{p.cog.title}</p>
                  </div>
                  <p className="text-[12px] text-offwhite/55 leading-snug">{p.cog.lines.join(" ")}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-center gap-3 mt-6">
          <img src={asset("images/logo-mark.png")} alt="" className="w-8 h-8 object-contain opacity-90" />
          <p className="text-[13px] text-offwhite/55">The new model — <span className="text-gradient font-semibold">Human + Agent + Shared Intelligence</span></p>
        </div>
      </div>
    </div>
  );
}

/* ===================== FORMULA (rendered four-step journey) ===================== */

type FormulaStep = {
  num: string;
  stage: string;
  label: string;
  icon: typeof Target;
  accent: string;
  body: string;
  takeaway: string;
  duration: string;
};

const formulaSteps: FormulaStep[] = [
  {
    num: "01",
    stage: "Innovate",
    label: "Spot the value",
    icon: Target,
    accent: "#5B7CFF",
    body: "Start with one high-value use case with clear ROI and real data.",
    takeaway: "Don’t boil the ocean.",
    duration: "1 day",
  },
  {
    num: "02",
    stage: "Demonstrate",
    label: "Prototype",
    icon: Presentation,
    accent: "#8A5BD6",
    body: "See it, test it, and validate value in 48 hours.",
    takeaway: "See it before you buy it.",
    duration: "48 hours",
  },
  {
    num: "03",
    stage: "Activate",
    label: "Build the Solution",
    icon: Settings,
    accent: "#C45BB8",
    body: "Senior-led teams working with AI agents to build, iterate and deliver at speed.",
    takeaway: "Human judgment. Agent scale.",
    duration: "2–4 weeks (MVP)",
  },
  {
    num: "04",
    stage: "Generate",
    label: "Scale & Operationalize",
    icon: Rocket,
    accent: "#FF7B5A",
    body: "You own the IP, the platform and the outcomes. No lock-in.",
    takeaway: "No lock-in. Full ownership.",
    duration: "4–12 weeks",
  },
];

function Formula() {
  return (
    <div className="relative">
      <div className="grid gap-5 sm:gap-6 pt-9 md:grid-cols-2 lg:grid-cols-4">
        {formulaSteps.map((s, i) => {
          const Icon = s.icon;
          return (
            <Reveal key={s.num} delay={i * 0.08}>
              <div className="relative h-full">
                {/* Floating vector icon above the card */}
                <span
                  className="absolute -top-9 left-1/2 -translate-x-1/2 z-20 w-[68px] h-[68px] rounded-2xl flex items-center justify-center ring-4 ring-navy"
                  style={{ background: s.accent, boxShadow: `0 16px 34px -10px ${s.accent}cc` }}
                >
                  <Icon className="w-7 h-7 text-white" strokeWidth={1.8} />
                </span>
                <div className="grad-border relative h-full bg-navylight/20 px-6 pb-6 pt-12 flex flex-col items-center text-center overflow-hidden">
                  <span
                    className="absolute inset-x-0 top-0 h-[2px]"
                    style={{ background: s.accent }}
                  />
                  <div
                    className="text-[11px] font-bold tracking-[2.5px] uppercase mb-2"
                    style={{ color: s.accent }}
                  >
                    {s.num} — {s.stage}
                  </div>
                  <h3 className="text-lg font-bold text-white leading-tight mb-2.5">{s.label}</h3>
                  <p className="text-[13px] text-offwhite/60 font-light leading-relaxed mb-4">
                    {s.body}
                  </p>
                  <div className="mt-auto flex items-center gap-2 pt-3 border-t border-white/10 w-full justify-center">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.accent }} />
                    <span className="text-[12.5px] font-semibold" style={{ color: s.accent }}>
                      {s.takeaway}
                    </span>
                  </div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      {/* Timeline */}
      <Reveal delay={0.1}>
        <div className="relative mt-12">
          <div
            className="hidden md:block absolute top-1/2 left-[12%] right-[10%] h-[2px] -translate-y-1/2 rounded-full opacity-80"
            style={{ background: "var(--cog-grad)" }}
          />
          <ArrowRight
            className="hidden md:block absolute right-[2%] top-1/2 -translate-y-1/2 w-5 h-5"
            style={{ color: "#FF7B5A" }}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 relative">
            {formulaSteps.map((s) => (
              <div key={s.num} className="flex justify-center">
                <span
                  className="px-5 py-2 rounded-full text-[13px] font-semibold text-white whitespace-nowrap shadow-[0_8px_24px_-10px_rgba(0,0,0,0.8)]"
                  style={{ background: s.accent }}
                >
                  {s.duration}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* ===================== GUILD SYSTEM (cropped deck graphic) ===================== */

function GuildSystem() {
  return (
    <div className="grad-border bg-navydeep/40 p-1.5 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)]">
      <div className="overflow-x-auto rounded-[12px]">
        <img
          src={asset("images/scenes/guild-deck-v3.webp")}
          alt="The Cognirise Guild System — five specialized agent guilds connected to a central AI transformation platform"
          className="block h-auto rounded-[12px] min-w-[880px] w-full select-none"
          draggable={false}
        />
      </div>
    </div>
  );
}

/* ===================== AGENTIC WORKFLOW PROTOTYPE (rendered mock) ===================== */

function AgenticWorkflowMock() {
  type NodeStatus = "done" | "running" | "queued";
  type WfNode = {
    id: string;
    icon: typeof Database;
    x: number;
    y: number;
    accent: string;
    status: NodeStatus;
  };

  const nodes: WfNode[] = [
    { id: "n1", icon: Hourglass, x: 6, y: 47, accent: "#8A5BD6", status: "done" },
    { id: "n2", icon: Database, x: 21, y: 17, accent: "#5B7CFF", status: "done" },
    { id: "n3", icon: Activity, x: 27, y: 45, accent: "#5B7CFF", status: "done" },
    { id: "n4", icon: Layers, x: 19, y: 77, accent: "#5B7CFF", status: "done" },
    { id: "n5", icon: Cpu, x: 41, y: 15, accent: "#C45BB8", status: "running" },
    { id: "n6", icon: Target, x: 45, y: 43, accent: "#C45BB8", status: "running" },
    { id: "n7", icon: ShieldCheck, x: 38, y: 71, accent: "#C45BB8", status: "running" },
    { id: "n8", icon: Settings, x: 59, y: 25, accent: "#FF7B5A", status: "queued" },
    { id: "n9", icon: Lock, x: 64, y: 53, accent: "#FF7B5A", status: "queued" },
    { id: "n10", icon: FileText, x: 56, y: 81, accent: "#FF7B5A", status: "queued" },
    { id: "n11", icon: Presentation, x: 78, y: 33, accent: "#5B7CFF", status: "queued" },
    { id: "n12", icon: Rocket, x: 81, y: 67, accent: "#5B7CFF", status: "queued" },
    { id: "n13", icon: Rocket, x: 93, y: 49, accent: "#5fd0a6", status: "queued" },
  ];

  const edges = [
    { from: "n1", to: "n2" },
    { from: "n1", to: "n3" },
    { from: "n1", to: "n4" },
    { from: "n2", to: "n5" },
    { from: "n2", to: "n6" },
    { from: "n3", to: "n6" },
    { from: "n3", to: "n7" },
    { from: "n4", to: "n7" },
    { from: "n4", to: "n6" },
    { from: "n5", to: "n8" },
    { from: "n5", to: "n9" },
    { from: "n6", to: "n8" },
    { from: "n6", to: "n9" },
    { from: "n7", to: "n9" },
    { from: "n7", to: "n10" },
    { from: "n8", to: "n11" },
    { from: "n8", to: "n12" },
    { from: "n9", to: "n11" },
    { from: "n9", to: "n12" },
    { from: "n10", to: "n12" },
    { from: "n11", to: "n13" },
    { from: "n12", to: "n13" },
  ];

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const path = (a: WfNode, b: WfNode) => {
    const cx = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`;
  };

  const dot: Record<NodeStatus, string> = {
    done: "bg-[#5fd0a6]",
    running: "bg-white animate-pulse",
    queued: "bg-white/25",
  };

  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <div className="pointer-events-none absolute -inset-8 bg-cog-grad-diag opacity-20 blur-[80px]" />
      {/* ===== Computer screen (Mac desktop 16:10) ===== */}
      <div className="relative grad-border bg-navydeep/40 p-1.5 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)]">
        <div className="rounded-[12px] overflow-hidden bg-navydeep aspect-[16/10] flex flex-col">
          {/* macOS title bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-navylight/30 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
            <div className="ml-3 hidden sm:block flex-1 max-w-[180px] rounded-md bg-white/5 px-3 py-1 text-[10px] text-offwhite/45 truncate">
              app.cognirise.ai/workflows
            </div>
            <span className="ml-auto flex items-center gap-1.5 text-[10px] uppercase tracking-[1px] text-[#5fd0a6]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#5fd0a6] animate-pulse" /> Live
            </span>
          </div>

          {/* workflow canvas */}
          <div
            className="relative flex-1"
            style={{
              backgroundImage:
                "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "12px 12px",
            }}
          >
            {/* connectors */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="wf-edge" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#5B7CFF" />
                  <stop offset="50%" stopColor="#8A5BD6" />
                  <stop offset="100%" stopColor="#C45BB8" />
                </linearGradient>
              </defs>
              {edges.map((e, i) => {
                const a = byId[e.from];
                const b = byId[e.to];
                return (
                  <path
                    key={i}
                    d={path(a, b)}
                    fill="none"
                    stroke="url(#wf-edge)"
                    strokeWidth={1.3}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="4 4"
                    className="wf-flow"
                  />
                );
              })}
            </svg>

            {/* nodes */}
            {nodes.map((n) => {
              const Icon = n.icon;
              return (
                <div
                  key={n.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${n.x}%`, top: `${n.y}%` }}
                >
                  <div className="relative rounded-lg border border-white/10 bg-navylight/90 backdrop-blur-sm p-1 shadow-[0_6px_18px_-8px_rgba(0,0,0,0.7)]">
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center"
                      style={{ background: n.accent }}
                    >
                      <Icon className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                    </span>
                    <span className={`absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full ring-2 ring-navydeep ${dot[n.status]}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* ===== Monitor stand ===== */}
      <div className="relative flex flex-col items-center">
        <div className="h-5 w-12 bg-gradient-to-b from-white/12 to-white/[0.04]" />
        <div className="h-2 w-36 rounded-full bg-white/10" />
      </div>
    </div>
  );
}

/* ===================== WHAT WE DO — PROBLEM CARDS ===================== */

function ProblemCards() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-5 auto-rows-fr">
      {problemCards.map((c, i) => {
        const Icon = c.icon;
        return (
          <Reveal key={c.title} delay={i * 0.06}>
            <div className="grad-border bg-navylight/20 h-full p-5 flex flex-col">
              <span
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mb-4"
                style={{ background: c.accent }}
              >
                <Icon className="w-5 h-5 text-white" strokeWidth={1.8} />
              </span>
              <h3 className="text-base font-bold text-white leading-tight mb-4 min-h-[2.5em]">{c.title}</h3>
              <p
                className="border-l-2 pl-3 mb-5 text-white/90 text-[13.5px] font-medium italic leading-snug line-clamp-3 min-h-[4.2em]"
                style={{ borderColor: c.accent }}
              >
                {c.quote}
              </p>
              <ul className="space-y-2.5">
                {c.points.map((pt) => (
                  <li key={pt} className="flex gap-2.5 text-[12.5px] text-offwhite/65 font-light leading-snug">
                    <span
                      className="mt-[6px] w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: c.accent }}
                    />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

/* ===================== PAGE ===================== */

export default function Home() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  return (
    <div className="min-h-screen bg-navy overflow-x-hidden">
      {/* ===== Nav ===== */}
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${scrolled ? "bg-navydeep/85 backdrop-blur-xl border-b border-white/5 py-3" : "bg-transparent py-5"}`}>
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <img src={asset("images/cognirise-logo.png")} alt="Cognirise" className="h-9 md:h-10 w-auto" />
          </Link>
          <div className="hidden md:flex items-center gap-9 text-sm text-offwhite/75">
            <a href="#how-we-work" className="nav-link hover:text-white transition-colors">How we work</a>
            <a href="#services" className="nav-link hover:text-white transition-colors">What we do</a>
            <a href="#approach" className="nav-link hover:text-white transition-colors">Our Approach</a>
            <a href="#guilds" className="nav-link hover:text-white transition-colors">The Guild System</a>
          </div>
          <Link href="/contact" className="group relative inline-flex items-center gap-2 bg-cog-grad-diag text-white px-5 py-2.5 rounded-full text-sm font-semibold shadow-[0_8px_24px_-8px_rgba(138,91,214,0.7)] hover:shadow-[0_10px_30px_-6px_rgba(196,91,184,0.8)] transition-shadow">
            Talk to Us <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </nav>

      {/* ===== Hero ===== */}
      <HeroCarousel />

      {/* ===== Execution statement (client value) ===== */}
      <section className="relative bg-navydeep py-24 border-y border-white/5">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <Reveal>
            <h2 className="text-[26px] md:text-[40px] font-bold text-white tracking-[-1.5px] leading-[1.1]">
              AI tools and PowerPoints don't create value.<br /><span className="text-gradient">Execution does.</span>
            </h2>
          </Reveal>
        </div>
      </section>

      {/* ===== From selling effort to outcomes (interactive comparison) ===== */}
      <section id="model" className="relative pt-32 pb-16">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-a absolute top-1/3 left-1/4 w-[28rem] h-[28rem] rounded-full bg-cogpurple/15 blur-[130px]" />
        </div>
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <Reveal><Eyebrow>A different kind of partner</Eyebrow></Reveal>
              <Reveal delay={0.05}>
                <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                  Most engagements start with a proposal. <span className="text-gradient">Ours start with a prototype.</span>
                </h2>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="text-lg md:text-xl text-offwhite/70 mt-8 font-light leading-relaxed">
                  <span className="text-gradient-bright font-semibold">In 48 hours,</span> you’ll have a working system — not a roadmap, not a recommendation, not a deck.
                </p>
              </Reveal>
              <Reveal delay={0.15}>
                <p className="text-lg md:text-xl text-offwhite/70 mt-4 font-light leading-relaxed">
                  See it running in your environment before you commit to anything.
                </p>
              </Reveal>
            </div>
            <Reveal delay={0.1}>
              <AgenticWorkflowMock />
            </Reveal>
          </div>
          <Reveal delay={0.2}>
            <a href="#how-we-work" className="group mt-10 flex items-center justify-center gap-2 text-mutedgrey hover:text-white transition-colors">
              <span className="text-sm tracking-wide">Here’s how we do it.</span>
              <ChevronDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
            </a>
          </Reveal>
        </div>
      </section>

      {/* ===== How We Work (human + agents) ===== */}
      <section id="how-we-work" className="relative pt-16 pb-32 scroll-mt-24 md:scroll-mt-28">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-b absolute top-1/4 left-1/3 w-[30rem] h-[30rem] rounded-full bg-cogblue/10 blur-[140px]" />
        </div>
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="max-w-4xl mb-16">
            <Reveal><Eyebrow>How we work</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                Two kinds of intelligence. <span className="text-gradient">One delivery team.</span>
              </h2>
            </Reveal>
          </div>

          {/* Two columns split by the human/agent visual */}
          <div className="grid lg:grid-cols-[1fr_minmax(260px,400px)_1fr] gap-10 lg:gap-10 items-start">
            {/* Left: human side */}
            <Reveal delay={0.05}>
              <div className="lg:text-right">
                <p className="text-[11px] uppercase tracking-[2px] text-mutedgrey mb-3">The human side</p>
                <h3 className="text-2xl md:text-[30px] font-bold mb-4 tracking-[-0.5px]">
                  <span className="text-gradient">Forward Deployed<br />Engineers (FDEs)</span>
                </h3>
                <p className="text-offwhite/70 leading-relaxed font-light">
                  Not a remote advisor. A senior transformation professional who works inside your
                  organization from day one — alongside your leadership, your teams, your systems. They
                  direct the agents, bridge strategy with execution, and stay until the outcome is real.
                </p>
              </div>
            </Reveal>

            {/* Center visual */}
            <Reveal delay={0.1}>
              <img
                src={humanAgent}
                alt="Human expertise and AI agents working as one delivery team"
                className="w-full max-w-[400px] mx-auto select-none drop-shadow-[0_30px_80px_rgba(91,124,255,0.25)]"
                draggable={false}
              />
            </Reveal>

            {/* Right: agent side */}
            <Reveal delay={0.15}>
              <div>
                <p className="text-[11px] uppercase tracking-[2px] text-mutedgrey mb-3">The agent side</p>
                <h3 className="text-2xl md:text-[30px] font-bold mb-4 tracking-[-0.5px]">
                  <span className="text-gradient">Forward Deployed<br />Agents (FDAs)</span>
                </h3>
                <p className="text-offwhite/70 leading-relaxed font-light">
                  Specialized AI agents organized into five guilds — each with a defined role, working at
                  machine speed, in parallel. Not automation. Purpose-built agents assembled around your
                  specific problem.
                </p>
              </div>
            </Reveal>
          </div>

          {/* Five guilds */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-16 max-w-5xl mx-auto">
            {[
              { name: "Strategy Guild", role: "What to build and why" },
              { name: "Delivery Guild", role: "Ideas into programs" },
              { name: "Engineering Guild", role: "Production systems" },
              { name: "Governance Guild", role: "Trust and compliance" },
              { name: "Value Guild", role: "Outcomes that stick" },
            ].map((g, i) => (
              <Reveal key={g.name} delay={i * 0.06}>
                <div className="grad-border bg-navylight/20 h-full p-5 transition-transform duration-300 hover:-translate-y-1">
                  <p className="font-semibold text-white text-[15px] mb-1.5">{g.name}</p>
                  <p className="text-sm text-offwhite/55 leading-snug">{g.role}</p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Tie-back line */}
          <Reveal delay={0.1}>
            <p className="text-center text-xl md:text-2xl font-light text-offwhite/85 mt-16">
              Together, they're why <span className="text-gradient">48 hours</span> is possible.
            </p>
          </Reveal>

          {/* Transition into services */}
          <Reveal delay={0.15}>
            <a href="#services" className="group mt-10 flex items-center justify-center gap-2 text-mutedgrey hover:text-white transition-colors">
              <span className="text-sm tracking-wide">Here's what you can apply this to.</span>
              <ChevronDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
            </a>
          </Reveal>
        </div>
      </section>

      {/* ===== What We Do (interactive service lines) ===== */}
      <section id="services" className="relative bg-navydeep py-32 border-y border-white/5 scroll-mt-24 md:scroll-mt-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mb-14">
            <Reveal><Eyebrow>What we do</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                Which problem are we <span className="text-gradient">solving for you?</span>
              </h2>
            </Reveal>
          </div>
          <ProblemCards />
          <Reveal delay={0.1}>
            <div className="mt-12 flex justify-center">
              <a
                href="#approach"
                className="group inline-flex items-center gap-2 text-sm font-semibold text-white/80 hover:text-white transition-colors"
              >
                Here’s how we deliver
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ===== Approach (rendered four-step journey) ===== */}
      <section id="approach" className="relative py-32 scroll-mt-24 md:scroll-mt-28">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-b absolute top-1/3 right-1/4 w-[28rem] h-[28rem] rounded-full bg-cogblue/12 blur-[140px]" />
        </div>
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="max-w-3xl mb-14">
            <Reveal><Eyebrow>Our approach</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                The formula for <span className="text-gradient">scalable AI value.</span>
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="text-lg text-offwhite/60 mt-5 font-light">
                What the top performers do differently — four steps from focused use case to enterprise scale.
              </p>
            </Reveal>
          </div>
          <Reveal delay={0.05}><Formula /></Reveal>
          <Reveal delay={0.1}>
            <a href="#guilds" className="group mt-12 flex items-center justify-center gap-2 text-mutedgrey hover:text-white transition-colors">
              <span className="text-sm tracking-wide">See our Guild System</span>
              <ChevronDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
            </a>
          </Reveal>
        </div>
      </section>

      {/* ===== Guild System (interactive constellation) ===== */}
      <section id="guilds" className="relative bg-navydeep py-32 border-y border-white/5 scroll-mt-24 md:scroll-mt-28">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-b absolute top-1/4 right-1/4 w-[30rem] h-[30rem] rounded-full bg-cogmagenta/12 blur-[140px]" />
        </div>
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="max-w-3xl mb-14">
            <Reveal><Eyebrow>The Cognirise Guild System</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                Five guilds. <span className="text-gradient">Thirteen agents.</span>
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="text-lg text-offwhite/65 mt-6 font-light leading-relaxed">
                Forward-deployed engineers work alongside specialized AI agent guilds, assembled into mission teams.
                Five guilds. Thirteen agents. One connected system — from business objectives to real transformation.
              </p>
            </Reveal>
          </div>
          <Reveal delay={0.05}><GuildSystem /></Reveal>
          <Reveal delay={0.1}>
            <a href="#cta" className="group mt-12 flex items-center justify-center gap-2 text-mutedgrey hover:text-white transition-colors">
              <span className="text-sm tracking-wide">Ready to become an agentic enterprise?</span>
              <ChevronDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
            </a>
          </Reveal>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section id="cta" className="relative py-36 overflow-hidden bg-navydeep border-t border-white/5">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-a absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] rounded-full bg-cogpurple/20 blur-[150px]" />
        </div>
        <div className="max-w-3xl mx-auto px-6 text-center relative">
          <Reveal delay={0.05}>
            <h2 className="text-[40px] md:text-[64px] font-extrabold text-white tracking-[-2px] leading-[1.02]">
              Ready to become an <span className="text-gradient">Agentic Enterprise?</span>
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-lg text-offwhite/65 mt-6 font-light">
              Strategy. Data. AI. Engineering. Integrated for impact across MENAT.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <a href="mailto:support@cognirise.ai" className="group inline-flex items-center gap-2 bg-cog-grad-diag text-white px-10 py-5 rounded-full text-lg font-semibold mt-10 shadow-[0_18px_50px_-12px_rgba(196,91,184,0.8)] hover:scale-[1.03] transition-transform">
              support@cognirise.ai <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </a>
          </Reveal>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="bg-navy pt-12 pb-12 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col items-center text-center gap-3 pb-10 mb-10 border-b border-white/5">
            <p className="text-[11px] uppercase tracking-[2px] text-mutedgrey">Where we are</p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-offwhite/70">
              {["Riyadh", "Dubai", "Abu Dhabi", "Doha", "Istanbul"].map((city, i) => (
                <span key={city} className="flex items-center gap-x-3">
                  {i > 0 && <span className="text-cogmagenta/60">·</span>}
                  <span className="text-[15px] font-medium">{city}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <img src={asset("images/cognirise-logo.png")} alt="Cognirise" className="h-9 w-auto opacity-90" />
            </div>
            <p className="text-offwhite/45 text-xs tracking-[2px] uppercase">Intelligence that Elevates</p>
            <span className="text-offwhite/40 text-xs">© {new Date().getFullYear()} Cognirise. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
