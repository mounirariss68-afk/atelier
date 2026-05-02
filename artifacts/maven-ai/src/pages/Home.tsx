import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Code2, Database, Rocket, ChevronRight, Quote } from "lucide-react";
import { stats, services, insights, founders } from "@/data/content";
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
                href="/contact"
                className="inline-flex items-center gap-2 bg-[#F5A623] hover:bg-[#d4622a] text-white font-bold px-8 py-4 rounded-xl text-base transition-colors shadow-lg"
              >
                Start the conversation <ArrowRight size={18} />
              </Link>
              <Link
                href="/about"
                className="inline-flex items-center gap-2 border border-white/30 hover:border-white/60 text-white font-semibold px-8 py-4 rounded-xl text-base transition-colors"
              >
                Our approach <ChevronRight size={18} />
              </Link>
            </motion.div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* ── STATS BAR ── */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
            {stats.map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="text-center"
              >
                <div className="text-3xl font-extrabold text-[#0E2841] mb-1">
                  <AnimatedCounter value={stat.value} />
                </div>
                <div className="text-xs text-gray-500 font-medium leading-tight">{stat.label}</div>
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
              Across GCC enterprises, the average organization runs 14 concurrent AI pilots. Fewer than 2 reach production within 12 months. We fix that.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="space-y-5">
              {[
                { num: "01", title: "Pilot purgatory", desc: "Dozens of POCs, no production path. The fix is governance plus orchestration plus change leadership — work the Tier-1 margin model rejects." },
                { num: "02", title: "Technical debt trap", desc: "70% of IT spend trapped in maintenance. AI-driven SDLC is the path out — almost no one delivers it on-prem for sovereign clients." },
                { num: "03", title: "Data & governance vacuum", desc: "AI exposes data debt instantly. Big-4 sells strategy, hyperscalers sell tools. No one delivers the operating activation that makes agents trustworthy." },
                { num: "04", title: "Pricing mismatch", desc: "Tier-1 rate cards assume 1:8 senior-to-junior pyramids. Clients now know the seniors aren't on the work. The premium is no longer matched." },
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
          <div className="grid md:grid-cols-3 gap-7">
            {[
              { title: "Public Sector", stat: "$33B", desc: "projected GCC government AI spend through 2030. From national safety platforms to smart city AI.", href: "/industries#public-sector", color: "#156082" },
              { title: "Telecommunications", stat: "$7.3B", desc: "GCC telecom AI investment. Legacy modernization, 5G operations, and customer AI at national scale.", href: "/industries#telecom", color: "#F5A623" },
              { title: "Financial Services", stat: "$11.7B", desc: "GCC FS AI investment. SAMA-compliant governance, capital markets AI, and data foundations for banks.", href: "/industries#financial-services", color: "#F5A623" },
            ].map((ind, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="report-card group p-8 border border-gray-100 rounded-2xl hover:border-transparent hover:shadow-xl"
              >
                <div className="text-5xl font-extrabold mb-2" style={{ color: ind.color }}>{ind.stat}</div>
                <h3 className="text-xl font-bold text-[#0E2841] mb-3">{ind.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">{ind.desc}</p>
                <Link href={ind.href} className="inline-flex items-center gap-1 text-sm font-semibold text-[#156082] group-hover:text-[#F5A623] transition-colors">
                  Explore <ArrowRight size={14} />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLIENT LOGOS ── */}
      <section className="py-14 bg-[#F8F9FA] border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center mb-10">
            Illustrative client organizations we've worked with
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
            {[
              "Ministry of Interior",
              "Saudi Telecom Company",
              "Abu Dhabi Investment Authority",
              "Qatar National Bank",
              "Emirates NBD",
              "Zain Group",
              "Saudi Aramco",
              "Etisalat / e&",
            ].map((name) => (
              <div
                key={name}
                className="px-6 py-3 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-500 hover:text-[#156082] hover:border-[#156082]/30 transition-colors"
              >
                {name}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 text-center mt-6 italic">
            Representative client types — actual client names held in confidence
          </p>
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
