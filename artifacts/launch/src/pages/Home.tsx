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
import humanAgent from "@assets/human_agent_trimmed.webp";

type HeroSlide = {
  white: [string, string];
  gradient: [string, string];
  desktop: string;
  mobile: string;
};

const HERO_SLIDES: HeroSlide[] = [
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

          <div className="h-[42vw] sm:h-[204px] md:h-[244px] lg:h-[276px]">
            <AnimatePresence mode="popLayout">
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
                aria-label={`Go to slide ${i + 1}: ${slide.white.join(" ")} ${slide.gradient.join(" ")}`}
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
                  alt={`${slide.white.join(" ")} ${slide.gradient.join(" ")}`}
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

const NODE_COLORS = ["#5B7CFF", "#8A5BD6", "#C45BB8", "#FF7B5A", "#5B7CFF"];

const services = [
  {
    icon: Activity, short: "Agentic Transformation",
    title: "Agentic Enterprise Transformation",
    desc: "An end-to-end overhaul that embeds autonomous AI agents across strategy, operations, and delivery — engineered into how you run, not bolted on after.",
    deliverables: ["Agentic operating model design", "Cross-functional agent deployment", "Workflow re-architecture"],
    video: "images/scenes/service-line-01.mp4",
  },
  {
    icon: Database, short: "Data & AI Foundations",
    title: "Data & AI Foundations",
    desc: "The data and AI backbone — resilient pipelines, governance, and infrastructure that make scalable, trustworthy AI deployment possible.",
    deliverables: ["Data platform & pipelines", "AI governance & guardrails", "Scalable cloud infrastructure"],
    video: "images/scenes/service-line-02.mp4",
  },
  {
    icon: Cpu, short: "Engineering with AI",
    title: "Engineering with AI",
    desc: "Senior-led teams working alongside AI agents to build, iterate, and ship production-grade systems at a speed traditional delivery can't match.",
    deliverables: ["Production-grade builds", "Senior + agent pairing", "Rapid iteration cycles"],
    video: "images/scenes/service-line-03.mp4",
  },
  {
    icon: ShieldCheck, short: "Sovereign Agentic AI",
    title: "Sovereign Agentic AI",
    desc: "Compliance-first, sovereign-capable deployments built for highly regulated sectors across MENAT — security and control by design.",
    deliverables: ["In-region & sovereign hosting", "Regulatory compliance", "Security & privacy by design"],
    video: "images/scenes/service-line-04.mp4",
  },
  {
    icon: Layers, short: "AI-Native Platforms",
    title: "AI-Native Platforms",
    desc: "Intelligent platforms that redefine market engagement, customer experience, and enterprise loyalty — owned by you, built to evolve.",
    deliverables: ["Custom AI platforms", "Market & CX intelligence", "Owned IP & roadmap"],
    video: "images/scenes/service-line-05.mp4",
  },
];

const agentCards = [
  { src: "images/deck/img35.webp", name: "CogniSage", role: "Research & Knowledge Synthesis" },
  { src: "images/deck/img36.webp", name: "CogniCompass", role: "Strategy & Decision Intelligence" },
  { src: "images/deck/img37.webp", name: "CogniSignal", role: "Competitive Intelligence" },
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

/* Measured node centers as % of the cropped service-lines deck graphic (for hotspot overlays) */
const SERVICE_NODES = [
  { x: 12, y: 54 }, { x: 30.3, y: 54 }, { x: 48.8, y: 54 }, { x: 67.2, y: 54 }, { x: 87.7, y: 54 },
];

const panelMotion = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.4, ease: [0.21, 0.6, 0.35, 1] as const },
};

/* ===================== INTERACTIVE: SERVICE LINES ===================== */

function ServiceNodeButton({ i, active, onActivate }: { i: number; active: number; onActivate: () => void }) {
  const sv = services[i];
  const on = i === active;
  const Icon = sv.icon;
  const c = NODE_COLORS[i];
  return (
    <button
      onMouseEnter={onActivate}
      onFocus={onActivate}
      onClick={onActivate}
      className="group flex flex-col items-center text-center focus:outline-none"
      aria-pressed={on}
    >
      <span className="relative flex items-center justify-center w-[64px] h-[64px] lg:w-[84px] lg:h-[84px] transition-transform duration-300" style={{ transform: on ? "scale(1.12)" : undefined }}>
        <span className="absolute inset-[-8px] rounded-full blur-xl transition-opacity duration-300" style={{ background: c, opacity: on ? 0.6 : 0.16 }} />
        <span
          className="relative w-full h-full rounded-full flex items-center justify-center border-2 transition-colors duration-300"
          style={{ borderColor: on ? "transparent" : "rgba(255,255,255,0.18)", background: on ? "var(--cog-grad-diag)" : "rgba(7,11,34,0.9)", boxShadow: on ? `0 0 28px ${c}aa` : `inset 0 0 18px ${c}33` }}
        >
          <Icon className="w-6 h-6 lg:w-8 lg:h-8" style={{ color: on ? "#fff" : c }} />
        </span>
      </span>
      <span className="mt-3 text-[11px] font-bold tracking-[2px]" style={{ color: on ? "#fff" : "rgba(239,239,239,0.45)" }}>0{i + 1}</span>
      <span className="text-[12px] leading-tight max-w-[8.5rem] mt-0.5 font-medium" style={{ color: on ? "#fff" : "rgba(239,239,239,0.5)" }}>{sv.short}</span>
    </button>
  );
}

function ServiceClip({ src, color, Icon }: { src: string; color: string; Icon: typeof Activity }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  return (
    <div
      className="relative w-full aspect-video rounded-xl overflow-hidden mb-6 border border-white/10 bg-navydeep"
      style={{ boxShadow: `inset 0 0 50px ${color}26` }}
    >
      {!failed ? (
        <video
          key={src}
          src={asset(src)}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: "var(--cog-grad-diag)" }}>
          <Icon className="w-10 h-10 text-white" />
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(to top, rgba(7,11,34,0.6), rgba(7,11,34,0) 55%)" }}
      />
    </div>
  );
}

function ServiceLines() {
  const [active, setActive] = useState(0);
  const s = services[active];
  const activeColor = NODE_COLORS[active];
  return (
    <div>
      {/* Desktop: cropped deck graphic with interactive hotspots */}
      <div className="hidden lg:block mb-8">
        <div className="grad-border bg-navydeep/40 p-1.5 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)]">
          <div className="relative rounded-[12px] overflow-hidden">
            <img
              src={asset("images/scenes/service-lines-deck.webp")}
              alt="The five Cognirise service lines connected as one system"
              className="w-full h-auto block select-none"
              draggable={false}
            />
            {services.map((sv, i) => {
              const n = SERVICE_NODES[i];
              const on = i === active;
              const c = NODE_COLORS[i];
              return (
                <button
                  key={i}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  className="group absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus:outline-none cursor-pointer"
                  style={{ left: `${n.x}%`, top: `${n.y}%`, width: "15%", aspectRatio: "1" }}
                  aria-pressed={on}
                  aria-label={sv.title}
                >
                  <span
                    className="absolute inset-0 rounded-full transition-all duration-300"
                    style={{ boxShadow: on ? `0 0 26px 5px ${c}, inset 0 0 20px 2px ${c}` : undefined, opacity: on ? 0.8 : 0 }}
                  />
                  <span className="absolute inset-0 rounded-full border-2 border-white/0 group-hover:border-white/50 transition-colors duration-300" />
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-center text-[12px] text-mutedgrey mt-4 tracking-wide">Hover or tap a service line to see what we deliver</p>
      </div>

      {/* Mobile: cropped deck graphic (scrollable) + node selector */}
      <div className="lg:hidden -mx-6 px-6 overflow-x-auto mb-7">
        <img
          src={asset("images/scenes/service-lines-deck.webp")}
          alt="The five Cognirise service lines connected as one system"
          className="h-auto rounded-xl min-w-[680px]"
          draggable={false}
        />
      </div>
      <div className="lg:hidden grid grid-cols-3 gap-y-7 gap-x-2 mb-10">
        {services.map((_, i) => (
          <ServiceNodeButton key={i} i={i} active={active} onActivate={() => setActive(i)} />
        ))}
      </div>

      {/* Detail panel */}
      <AnimatePresence mode="wait">
        <motion.div key={active} {...panelMotion} className="grad-border bg-navylight/30 p-8 md:p-10" style={{ boxShadow: `0 0 50px -24px ${activeColor}99` }}>
          <div className="grid md:grid-cols-[1.1fr_1fr] gap-8 md:gap-10 items-start">
            <div>
              <ServiceClip src={s.video} color={activeColor} Icon={s.icon} />
              <h3 className="text-2xl md:text-[32px] font-bold text-white mb-3 tracking-[-0.5px] leading-snug">{s.title}</h3>
              <p className="text-offwhite/65 leading-relaxed">{s.desc}</p>
            </div>
            <div className="md:border-l border-white/10 md:pl-10">
              <p className="text-[11px] uppercase tracking-[2px] text-mutedgrey mb-4">What you get</p>
              <ul className="space-y-3.5">
                {s.deliverables.map((d) => (
                  <li key={d} className="flex items-start gap-3 text-offwhite/85 text-[15px]">
                    <span className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--cog-grad-diag)" }}>
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ===================== FORMULA (cropped deck graphic) ===================== */

function Formula() {
  return (
    <div className="grad-border bg-navydeep/40 p-1.5 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)]">
      <div className="overflow-x-auto rounded-[12px]">
        <img
          src={asset("images/scenes/approach-deck.webp")}
          alt="The Cognirise formula for scalable AI value — four phases from a focused use case to build-to-own at enterprise scale"
          className="block h-auto rounded-[12px] min-w-[860px] w-full select-none"
          draggable={false}
        />
      </div>
    </div>
  );
}

/* ===================== GUILD SYSTEM (cropped deck graphic) ===================== */

function GuildSystem() {
  return (
    <div className="grad-border bg-navydeep/40 p-1.5 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)]">
      <div className="overflow-x-auto rounded-[12px]">
        <img
          src={asset("images/scenes/guild-deck.webp")}
          alt="The Cognirise Guild System — five specialized agent guilds connected to a central AI transformation platform"
          className="block h-auto rounded-[12px] min-w-[880px] w-full select-none"
          draggable={false}
        />
      </div>
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
            <a href="#services" className="nav-link hover:text-white transition-colors">Services</a>
            <a href="#approach" className="nav-link hover:text-white transition-colors">Approach</a>
            <a href="#guilds" className="nav-link hover:text-white transition-colors">The Guild</a>
          </div>
          <a href="mailto:support@cognirise.ai" className="group relative inline-flex items-center gap-2 bg-cog-grad-diag text-white px-5 py-2.5 rounded-full text-sm font-semibold shadow-[0_8px_24px_-8px_rgba(138,91,214,0.7)] hover:shadow-[0_10px_30px_-6px_rgba(196,91,184,0.8)] transition-shadow">
            Talk to Us <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
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
      <section id="model" className="relative py-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-a absolute top-1/3 left-1/4 w-[28rem] h-[28rem] rounded-full bg-cogpurple/15 blur-[130px]" />
        </div>
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="max-w-4xl">
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
        </div>
      </section>

      {/* ===== How We Work (human + agents) ===== */}
      <section id="how-we-work" className="relative py-32">
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
          <div className="grid lg:grid-cols-[1fr_minmax(260px,400px)_1fr] gap-10 lg:gap-10 items-center">
            {/* Left: human side */}
            <Reveal delay={0.05}>
              <div className="lg:text-right">
                <p className="text-[11px] uppercase tracking-[2px] text-mutedgrey mb-3">The human side</p>
                <h3 className="text-2xl md:text-[30px] font-bold mb-4 tracking-[-0.5px]">
                  <span className="text-gradient">Forward Deployed Engineer</span>
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
                  <span className="text-gradient">Agent Guilds</span>
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-16">
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
      <section id="services" className="relative bg-navydeep py-32 border-y border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mb-14">
            <Reveal><Eyebrow>What we do</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                Five service lines. <span className="text-gradient">Infinite impact.</span>
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="text-lg text-offwhite/60 mt-5 font-light">
                Built to transform. Designed to scale. Select a service line to explore what we deliver.
              </p>
            </Reveal>
          </div>
          <Reveal delay={0.05}><ServiceLines /></Reveal>
        </div>
      </section>

      {/* ===== Approach (cropped deck graphic) ===== */}
      <section id="approach" className="relative py-32">
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
        </div>
      </section>

      {/* ===== Guild System (interactive constellation) ===== */}
      <section id="guilds" className="relative bg-navydeep py-32 border-y border-white/5">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-b absolute top-1/4 right-1/4 w-[30rem] h-[30rem] rounded-full bg-cogmagenta/12 blur-[140px]" />
        </div>
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="max-w-3xl mb-14">
            <Reveal><Eyebrow>Humans + Agents</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                The Cognirise <span className="text-gradient">Guild System.</span>
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
        </div>
      </section>

      {/* ===== Agents ===== */}
      <section className="relative py-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mb-14">
            <Reveal><Eyebrow>Meet the agents</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                Specialized intelligence, <span className="text-gradient">on demand.</span>
              </h2>
            </Reveal>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {agentCards.map((a, i) => (
              <Reveal key={a.name} delay={i * 0.1}>
                <div className="grad-border group bg-navy/60 p-1.5 transition-transform duration-300 hover:-translate-y-2">
                  <img src={asset(a.src)} alt={a.name} loading="lazy" className="w-full h-auto rounded-[12px] block" />
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="relative py-36 overflow-hidden bg-navydeep border-t border-white/5">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-a absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] rounded-full bg-cogpurple/20 blur-[150px]" />
        </div>
        <div className="max-w-3xl mx-auto px-6 text-center relative">
          <Reveal>
            <img src={asset("images/logo-mark.png")} alt="" className="h-14 w-auto mx-auto mb-8 spin-slow opacity-90" />
          </Reveal>
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
      <footer className="bg-navy py-12 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <img src={asset("images/cognirise-logo.png")} alt="Cognirise" className="h-7 w-auto opacity-90" />
          </div>
          <p className="text-offwhite/45 text-sm tracking-[2px] uppercase">Intelligence that Elevates</p>
          <span className="text-offwhite/40 text-sm">© {new Date().getFullYear()} Cognirise. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
