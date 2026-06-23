import { useEffect, useState, useRef } from "react";
import { Link } from "wouter";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, ChevronDown, Check, X,
  Activity, Database, Cpu, ShieldCheck, Layers,
} from "lucide-react";

const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

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

const compare = {
  old: {
    label: "Traditional consulting",
    items: ["Endless decks & discovery phases", "Man-day billing for effort", "Multi-month pilots that stall", "Vendor lock-in & black boxes", "Activity measured — not outcomes"],
  },
  cog: {
    label: "The Cognirise way",
    items: ["48-hour working prototypes", "Outcome-based delivery", "Production-ready from day one", "You own the IP, platform & outcomes", "Measured, real business impact"],
  },
};

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
  const { scrollY } = useScroll();
  const heroImgY = useTransform(scrollY, [0, 800], [0, 160]);
  const heroOpacity = useTransform(scrollY, [0, 600], [1, 0]);
  const heroTextY = useTransform(scrollY, [0, 600], [0, 120]);

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
          <a href="mailto:hello@cognirise.ai" className="group relative inline-flex items-center gap-2 bg-cog-grad-diag text-white px-5 py-2.5 rounded-full text-sm font-semibold shadow-[0_8px_24px_-8px_rgba(138,91,214,0.7)] hover:shadow-[0_10px_30px_-6px_rgba(196,91,184,0.8)] transition-shadow">
            Talk to Us <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>
      </nav>

      {/* ===== Hero ===== */}
      <section className="relative min-h-[100dvh] flex items-center overflow-hidden">
        <motion.div style={{ y: heroImgY, opacity: heroOpacity }} className="absolute inset-0 z-0">
          <img src={asset("images/deck/img19.webp")} alt="MENAT skyline" loading="eager" className="w-full h-[120%] object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-b from-navy/70 via-navy/55 to-navy" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_40%,rgba(91,124,255,0.18),transparent_55%)]" />
        </motion.div>

        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="glow-a absolute top-[18%] left-[8%] w-[34rem] h-[34rem] rounded-full bg-cogblue/25 blur-[120px]" />
          <div className="glow-b absolute bottom-[6%] right-[6%] w-[30rem] h-[30rem] rounded-full bg-cogmagenta/22 blur-[120px]" />
        </div>

        <motion.div style={{ y: heroTextY }} className="relative z-10 max-w-7xl mx-auto px-6 w-full pt-24">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 backdrop-blur px-4 py-1.5 mb-8">
            <span className="relative flex h-2 w-2">
              <span className="pulse-ring absolute inline-flex h-full w-full rounded-full bg-cogcoral" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cogcoral" />
            </span>
            <span className="text-[11px] font-semibold tracking-[2px] uppercase text-offwhite/80">Intelligence that Elevates</span>
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.25 }}
            className="text-[15vw] sm:text-[78px] md:text-[104px] leading-[0.95] font-extrabold text-white tracking-[-3px] max-w-5xl">
            From AI ambition<br />to <span className="text-gradient">AI in production.</span>
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.4 }}
            className="text-lg md:text-2xl text-offwhite/75 max-w-2xl font-light mt-8 leading-relaxed">
            The AI-native transformation partner for the MENAT region — senior delivery,
            agentic-native execution, and outcomes you fully own.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.55 }}
            className="flex flex-wrap items-center gap-4 mt-12">
            <a href="mailto:hello@cognirise.ai" className="group inline-flex items-center gap-2 bg-cog-grad-diag text-white px-8 py-4 rounded-full text-base font-semibold shadow-[0_14px_40px_-10px_rgba(138,91,214,0.8)] hover:scale-[1.02] transition-transform">
              Transform Your Enterprise <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
            <a href="#services" className="inline-flex items-center gap-2 text-offwhite/80 hover:text-white px-6 py-4 rounded-full border border-white/15 hover:border-white/30 transition-colors text-base font-medium">
              What we do
            </a>
          </motion.div>
        </motion.div>

        <motion.div style={{ opacity: heroOpacity }} className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 text-offwhite/50">
          <ChevronDown className="w-6 h-6 animate-bounce" />
        </motion.div>
      </section>

      {/* ===== Stat strip (client value) ===== */}
      <section className="relative bg-navydeep py-20 border-y border-white/5">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-y-12 gap-x-8">
          {[
            { v: <Counter end={48} suffix="h" />, l: "from idea to a working prototype" },
            { v: <Counter end={100} suffix="%" />, l: "yours — the IP, the platform, the outcomes" },
            { v: <Counter end={13} />, l: "specialized AI agents across 5 guilds" },
            { v: <Counter end={5} />, l: "service lines, one connected system" },
          ].map((s, i) => (
            <Reveal key={i} delay={i * 0.08} className={i ? "md:border-l border-white/10 md:pl-8" : ""}>
              <div className="text-[44px] md:text-[58px] font-extrabold tracking-tight leading-none mb-3 text-gradient">{s.v}</div>
              <p className="text-sm text-offwhite/55 font-medium leading-snug max-w-[15rem]">{s.l}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ===== From selling effort to outcomes (interactive comparison) ===== */}
      <section className="relative py-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="glow-a absolute top-1/3 left-1/4 w-[28rem] h-[28rem] rounded-full bg-cogpurple/15 blur-[130px]" />
        </div>
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="max-w-3xl mb-14">
            <Reveal><Eyebrow>A different kind of partner</Eyebrow></Reveal>
            <Reveal delay={0.05}>
              <h2 className="text-[38px] md:text-[56px] font-bold text-white tracking-[-1.5px] leading-[1.05]">
                From selling effort to <span className="text-gradient">delivering outcomes.</span>
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="text-lg text-offwhite/65 mt-6 font-light leading-relaxed">
                No endless decks. No man-day billing. No multi-month pilots that go nowhere. We replace
                activity with measurable, production-ready results — and you keep full ownership.
              </p>
            </Reveal>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <Reveal>
              <div className="rounded-2xl border border-white/10 bg-navydeep/50 p-8 h-full">
                <p className="text-[11px] uppercase tracking-[2px] text-offwhite/40 mb-6">{compare.old.label}</p>
                <ul className="space-y-4">
                  {compare.old.items.map((t) => (
                    <li key={t} className="flex items-start gap-3 text-offwhite/50 text-[15px]">
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        <X className="w-3 h-3 text-offwhite/40" strokeWidth={3} />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="grad-border bg-navylight/40 p-8 h-full">
                <p className="text-[11px] uppercase tracking-[2px] text-gradient font-semibold mb-6">{compare.cog.label}</p>
                <ul className="space-y-4">
                  {compare.cog.items.map((t) => (
                    <li key={t} className="flex items-start gap-3 text-offwhite/90 text-[15px]">
                      <span className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--cog-grad-diag)" }}>
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
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

      {/* ===== Execution statement ===== */}
      <section className="relative py-28">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <Reveal>
            <h2 className="text-[32px] md:text-[52px] font-bold text-white tracking-[-1.5px] leading-[1.1]">
              AI tools and PowerPoints don't create value.<br /><span className="text-gradient">Execution does.</span>
            </h2>
          </Reveal>
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
            <a href="mailto:hello@cognirise.ai" className="group inline-flex items-center gap-2 bg-cog-grad-diag text-white px-10 py-5 rounded-full text-lg font-semibold mt-10 shadow-[0_18px_50px_-12px_rgba(196,91,184,0.8)] hover:scale-[1.03] transition-transform">
              hello@cognirise.ai <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
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
