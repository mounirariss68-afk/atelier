import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Code2, Database, Rocket, ChevronRight, Quote, ExternalLink } from "lucide-react";
import { stats, services, insights, industries, SITE_SOURCES } from "@/data/content";
import PartnerLogos from "@/components/PartnerLogos";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } }),
};

const serviceIcons: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  Brain, Code2, Database, Rocket,
};

function AnimatedCounter({ value }: { value: string }) {
  return <span>{value}</span>;
}

export default function Home() {
  const featuredInsights = insights.filter((i) => i.featured).slice(0, 3);

  return (
    <div className="pt-20">
      {/* ── HERO ── */}
      <section className="relative min-h-[88vh] bg-[#0E2841] flex items-center overflow-hidden">
        {/* Animated background grid */}
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(rgba(15,158,213,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(15,158,213,0.4) 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />
        </div>
        {/* Radial glow */}
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-[#156082]/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-[#F5A623]/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="max-w-4xl">
            <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
              <span className="inline-flex items-center gap-2 bg-[#F5A623]/20 border border-[#F5A623]/30 text-[#F5A623] text-xs font-semibold px-4 py-2 rounded-full uppercase tracking-wider mb-8">
                A Maven Insights Company
              </span>
            </motion.div>

            <motion.h1
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={1}
              className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-white leading-[1.05] tracking-tight mb-8"
            >
              From AI ambition
              <br />
              <span className="text-[#F5A623]">to AI in production.</span>
            </motion.h1>

            <motion.p
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={2}
              className="text-xl text-gray-300 leading-relaxed max-w-2xl mb-12"
            >
              Maven AI is a boutique AI advisory and engineering firm built for outcomes. We close the gap between enterprise AI ambition and enterprise AI in production — with senior delivery, lean economics, and an agentic-native practice.
            </motion.p>

            <motion.div
              initial="hidden"
              animate="visible"
              variants={fadeUp}
              custom={3}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-4"
            >
              <Link
                href="/assessments"
                className="inline-flex items-center gap-2 bg-[#F5A623] hover:bg-[#d4622a] text-white font-bold px-8 py-4 rounded-xl text-base transition-colors shadow-lg"
              >
                Take a free 12-min diagnostic <ArrowRight size={18} />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 border border-white/30 hover:border-white/60 text-white font-semibold px-8 py-4 rounded-xl text-base transition-colors"
              >
                Start the conversation <ChevronRight size={18} />
              </Link>
            </motion.div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* ── DIAGNOSTIC SUITE BANNER ── */}
      <section className="bg-gradient-to-r from-[#0F9ED5] via-[#156082] to-[#0E2841] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#E97132] mb-2">Maven AI Diagnostic Suite · Free · ~12 min</p>
            <p className="text-2xl font-extrabold leading-tight">Where does your AI program actually stand against the GCC peer band?</p>
            <p className="text-sm text-white/80 mt-2">Four diagnostics — Agentic Readiness, Model & Value, Data & Governance, Use Case Value — produce a sovereign-aware score, an executive memo, and a branded board pack.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
            <Link href="/assessments/ari" className="bg-white text-[#0E2841] font-bold px-5 py-3 rounded-lg whitespace-nowrap hover:bg-gray-100">Start ARI →</Link>
            <Link href="/assessments" className="border border-white/40 text-white font-semibold px-5 py-3 rounded-lg whitespace-nowrap hover:bg-white/10">See all 4 diagnostics</Link>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center mb-8">
            The Middle East AI opportunity — by the published numbers
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            {stats.map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="text-center md:text-left md:px-2"
              >
                <div className="text-5xl font-extrabold text-[#0E2841] mb-2 leading-none">
                  <AnimatedCounter value={stat.value} />
                </div>
                <div className="text-sm text-gray-700 font-medium leading-snug mb-2">
                  {stat.label}
                </div>
                <p className="text-[11px] text-gray-500 leading-snug">
                  Source:{" "}
                  <a
                    href={stat.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-gray-300 hover:decoration-[#0E2841] hover:text-[#0E2841] transition-colors"
                  >
                    {stat.source.name} ({stat.source.year})
                    <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
                  </a>
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE GAP WE CLOSE ── */}
      <section className="py-24 bg-[#F8F9FA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <div className="section-divider mx-auto" />
            <h2 className="text-4xl font-extrabold text-[#0E2841] mb-5">The gap we exist to close</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              MIT's 2025 <em>State of AI in Business</em> report found that <span className="font-semibold text-[#0E2841]">95% of enterprise GenAI pilots delivered no measurable P&amp;L impact</span> — only 5% of integrated systems generated meaningful value. We exist to put GCC enterprises in the 5%.
            </p>
            <p className="text-xs text-gray-500 mt-4">
              Source:{" "}
              <a
                href="https://nanda.media.mit.edu/ai_report_2025.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-gray-300 hover:decoration-[#0E2841] hover:text-[#0E2841] transition-colors"
              >
                MIT NANDA — The GenAI Divide: State of AI in Business (2025)
                <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
              </a>
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="space-y-5">
              {[
                { num: "01", title: "Pilot purgatory", desc: "Dozens of POCs, no production path. The fix is governance plus orchestration plus change leadership — work the Tier-1 margin model rejects." },
                { num: "02", title: "Technical debt trap", desc: "Industry research puts 60–80% of IT budgets into maintaining existing systems (with telcos at the higher end). AI-driven SDLC is the path out — almost no one delivers it on-prem for sovereign clients.", source: SITE_SOURCES.eyTelcoLegacy },
                { num: "03", title: "Data & governance vacuum", desc: "AI exposes data debt instantly. Big-4 sells strategy, hyperscalers sell tools. No one delivers the operating activation that makes agents trustworthy." },
                { num: "04", title: "Adoption gap", desc: "BCG finds only 26% of companies have moved past AI pilots to generate any value at scale — and just 4% sit at the elite frontier. The bottleneck is delivery, not models.", source: SITE_SOURCES.bcgValueAI },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="flex gap-4 p-5 bg-white rounded-xl border border-gray-100 shadow-sm"
                >
                  <span className="text-[#F5A623] font-black text-xl leading-none mt-0.5 w-8 flex-shrink-0">{item.num}</span>
                  <div>
                    <h3 className="font-bold text-[#0E2841] mb-1">{item.title}</h3>
                    <p className="text-sm text-gray-600 leading-relaxed">{item.desc}</p>
                    {item.source && (
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        Source:{" "}
                        <a
                          href={item.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-gray-300 hover:decoration-[#0E2841] hover:text-[#0E2841] transition-colors"
                        >
                          {item.source.name} ({item.source.year})
                          <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
                        </a>
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="bg-[#0E2841] rounded-2xl p-10 text-white"
            >
              <h3 className="text-2xl font-bold mb-8">How Maven AI is different</h3>
              <div className="space-y-6">
                {[
                  { label: "Production-led", desc: "We deliver AI in production, not AI in PowerPoint. Measured outcomes, not advisory." },
                  { label: "Boutique by design", desc: "Senior partners and principals on every engagement. No pyramid, no bench-warming." },
                  { label: "Agentic-native", desc: "Built around agentic AI as the operating fabric — not retrofitted onto a legacy services model." },
                  { label: "Lean economics", desc: "Boutique structure plus partner leverage delivers what Tier-1 cost bases cannot match." },
                  { label: "Platform-agnostic", desc: "Clients pick the right stack. Our economics aren't tied to any vendor." },
                ].map((item, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#F5A623] mt-2 flex-shrink-0" />
                    <div>
                      <span className="font-bold text-white">{item.label} — </span>
                      <span className="text-gray-300 text-sm">{item.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/about" className="mt-8 inline-flex items-center gap-2 text-[#F5A623] font-semibold text-sm hover:text-white transition-colors">
                Learn more about our approach <ArrowRight size={16} />
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <div className="section-divider" />
            <h2 className="text-4xl font-extrabold text-[#0E2841] mb-4">Four value propositions</h2>
            <p className="text-lg text-gray-600 max-w-xl">Built for what clients actually need to ship.</p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {services.map((service, i) => {
              const Icon = serviceIcons[service.icon] || Brain;
              return (
                <motion.div
                  key={service.id}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="report-card group border border-gray-100 rounded-2xl p-7 hover:border-transparent hover:shadow-xl cursor-pointer"
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                    style={{ backgroundColor: service.color + "18" }}
                  >
                    <Icon size={24} style={{ color: service.color }} />
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: service.color }}>
                    {service.buyer}
                  </div>
                  <h3 className="text-lg font-bold text-[#0E2841] mb-3 leading-snug">{service.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed mb-5">{service.description}</p>
                  <Link
                    href={`/services/${service.slug}`}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#156082] group-hover:text-[#F5A623] transition-colors"
                  >
                    Learn more <ArrowRight size={14} />
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── PLATFORM PARTNERS ── */}
      <PartnerLogos variant="light" />

      {/* ── FEATURED INSIGHTS ── */}
      <section className="py-24 bg-[#F8F9FA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-14">
            <div>
              <div className="section-divider" />
              <h2 className="text-4xl font-extrabold text-[#0E2841] mb-2">Featured insights</h2>
              <p className="text-gray-600">Research, perspectives, and analysis from the Maven AI team.</p>
            </div>
            <Link href="/insights" className="hidden sm:inline-flex items-center gap-2 text-[#156082] font-semibold text-sm hover:text-[#F5A623] transition-colors">
              All insights <ArrowRight size={14} />
            </Link>
          </div>

          <div className="grid lg:grid-cols-3 gap-7">
            {featuredInsights.map((insight, i) => (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="report-card group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm cursor-pointer"
              >
                <Link href={`/insights/${insight.slug}`}>
                  <div className="h-52 overflow-hidden bg-[#0E2841] relative">
                    <img
                      src={insight.coverImage}
                      alt={insight.title}
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity group-hover:scale-105 transition-transform duration-500"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0E2841]/80 to-transparent" />
                    <div className="absolute bottom-4 left-4">
                      <span
                        className="text-xs font-bold px-3 py-1 rounded-full"
                        style={{
                          backgroundColor:
                            insight.category === "Agentic AI" ? "#156082" :
                            insight.category === "Data & Governance" ? "#F5A623" :
                            insight.category === "Industry Trends" ? "#F5A623" : "#196B24",
                          color: "white",
                        }}
                      >
                        {insight.type}
                      </span>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold text-[#156082]">{insight.category}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{insight.date}</span>
                    </div>
                    <h3 className="font-bold text-[#0E2841] text-lg leading-snug mb-3 group-hover:text-[#156082] transition-colors">
                      {insight.title}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed mb-4">{insight.summary}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{insight.readTime}</span>
                      <span className="text-sm font-semibold text-[#156082] group-hover:text-[#F5A623] transition-colors flex items-center gap-1">
                        Read <ArrowRight size={13} />
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOUNDER QUOTE ── */}
      <section className="py-24 bg-[#0E2841] relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #F5A623 1px, transparent 1px)`, backgroundSize: "40px 40px" }} />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Quote size={48} className="text-[#F5A623] mx-auto mb-8 opacity-60" />
          <blockquote className="text-2xl sm:text-3xl font-semibold text-white leading-relaxed mb-10">
            "The organizations that will win the next decade are not the ones that started AI first — they are the ones that moved AI from the slide deck to production. That is the only gap we exist to close."
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-14 h-14 rounded-full overflow-hidden bg-[#156082] border-2 border-[#F5A623] flex items-center justify-center text-white font-bold text-lg">
              MA
            </div>
            <div className="text-left">
              <div className="text-white font-bold">Mounir Aris</div>
              <div className="text-gray-400 text-sm">CEO & Co-Founder, Maven AI</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── INDUSTRIES ── */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <div className="section-divider" />
            <h2 className="text-4xl font-extrabold text-[#0E2841] mb-4">Where we work</h2>
            <p className="text-lg text-gray-600 max-w-xl">Deep domain knowledge in the sectors that matter most in the GCC.</p>
          </motion.div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {industries.map((ind, i) => (
              <motion.div
                key={ind.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="report-card group p-8 border border-gray-100 rounded-2xl hover:border-transparent hover:shadow-xl flex flex-col"
              >
                <div className="text-5xl font-extrabold mb-2 leading-none" style={{ color: ind.color }}>{ind.heroStat}</div>
                <p className="text-[11px] text-gray-500 leading-snug mb-4">
                  {ind.heroStatLabel}
                  <br />
                  <a
                    href={ind.heroStatSource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 underline decoration-gray-300 hover:decoration-[#0E2841] hover:text-[#0E2841] transition-colors"
                  >
                    {ind.heroStatSource.name} ({ind.heroStatSource.year})
                    <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
                  </a>
                </p>
                <h3 className="text-xl font-bold text-[#0E2841] mb-3">{ind.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6 flex-1">{ind.subtitle}</p>
                <Link href={`/industries#${ind.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#156082] group-hover:text-[#F5A623] transition-colors">
                  Explore <ArrowRight size={14} />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MARKETPLACE TEASER ── */}
      <section className="py-20 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7">
              <div className="section-divider" />
              <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white bg-[#0F9ED5] mb-4">
                New · Marketplace
              </span>
              <h2 className="text-4xl font-extrabold text-[#0E2841] mb-5 max-w-2xl leading-tight">
                What good looks like — interactive demos, not slides.
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl leading-relaxed mb-6">
                MIT NANDA finds 95% of enterprise GenAI pilots deliver no measurable P&L impact. Our Marketplace is the answer: a working CFO scoreboard for AI initiatives, plus detail pages for fourteen demos across the seven industries we know best.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/marketplace/value-realization"
                  className="inline-flex items-center gap-2 bg-[#0E2841] hover:bg-[#156082] text-white font-bold px-6 py-3.5 rounded-xl transition-colors"
                >
                  Open the Value Realization Tool <ArrowRight size={16} />
                </Link>
                <Link
                  href="/marketplace"
                  className="inline-flex items-center gap-2 border border-[#0E2841] text-[#0E2841] hover:bg-[#0E2841] hover:text-white font-bold px-6 py-3.5 rounded-xl transition-colors"
                >
                  Browse the Marketplace
                </Link>
              </div>
            </div>
            <div className="lg:col-span-5">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#0F9ED5]">
                    Value Realization · sample
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    AED · annual
                  </span>
                </div>
                {[
                  { label: "Citizen-services agent", expected: 4.2, realized: 3.35, color: "#196B24" },
                  { label: "Network-ops copilot", expected: 6.8, realized: 4.6, color: "#196B24" },
                  { label: "Procurement intelligence", expected: 9.5, realized: 5.2, color: "#F5A623" },
                  { label: "Demand forecaster", expected: 3.1, realized: 1.4, color: "#0F9ED5" },
                  { label: "Hospitality revenue", expected: 5.4, realized: 0.0, color: "#B91C1C" },
                ].map((row) => {
                  const max = 9.5;
                  const expW = (row.expected / max) * 100;
                  const realW = (row.realized / max) * 100;
                  return (
                    <div key={row.label} className="space-y-1">
                      <div className="flex justify-between text-[11px] text-gray-600">
                        <span className="font-semibold">{row.label}</span>
                        <span className="text-gray-400">
                          AED {row.realized.toFixed(1)}M / {row.expected.toFixed(1)}M
                        </span>
                      </div>
                      <div className="relative h-2.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="absolute inset-y-0 start-0 rounded-full"
                          style={{ width: `${expW}%`, background: "#0E284122" }}
                        />
                        <div
                          className="absolute inset-y-0 start-0 rounded-full"
                          style={{ width: `${realW}%`, background: row.color }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-gray-500 leading-relaxed pt-2 border-t border-gray-100">
                  Realization rate <span className="font-bold text-[#0E2841]">49%</span> · Value at risk <span className="font-bold text-[#B91C1C]">AED 9.7M</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── MAVEN INSIGHTS BANNER ── */}
      <section className="py-16 bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">A sister company</p>
          <h2 className="text-3xl font-extrabold text-[#0E2841] mb-4">
            Maven AI is backed by 200+ consultants at Maven Insights
          </h2>
          <p className="text-gray-600 max-w-2xl mx-auto mb-8">
            Maven Insights is a leading consulting firm with offices in Dubai, Riyadh, Abu Dhabi, Doha, and Ankara. Maven AI was founded as a dedicated AI delivery practice, leveraging Maven Insights' bench, client relationships, and regional presence.
          </p>
          <a
            href="https://www.maveninsights.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-[#156082] text-[#156082] font-semibold px-6 py-3 rounded-xl hover:bg-[#156082] hover:text-white transition-colors"
          >
            Visit Maven Insights <ArrowRight size={16} />
          </a>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 bg-gradient-to-br from-[#0E2841] to-[#156082]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl font-extrabold text-white mb-6">
              Ready to move AI from the slide to production?
            </h2>
            <p className="text-xl text-gray-300 mb-10 max-w-xl mx-auto">
              Three-day scope. Three-week prototype. 90-day MVP. Let's talk about where to start.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/contact" className="inline-flex items-center gap-2 bg-[#F5A623] hover:bg-[#d4622a] text-white font-bold px-8 py-4 rounded-xl text-base transition-colors shadow-lg">
                Start the conversation <ArrowRight size={18} />
              </Link>
              <Link href="/insights" className="inline-flex items-center gap-2 border border-white/30 hover:border-white text-white font-semibold px-8 py-4 rounded-xl text-base transition-colors">
                Read our research <ArrowRight size={16} />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
