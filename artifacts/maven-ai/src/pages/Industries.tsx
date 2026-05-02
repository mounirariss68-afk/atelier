import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Building2, Wifi, TrendingUp, Zap, ShoppingBag, Plane, Car, ExternalLink } from "lucide-react";
import { industries } from "@/data/content";

const industryIcons: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  Building2, Wifi, TrendingUp, Zap, ShoppingBag, Plane, Car,
};

type Source = { name: string; year: number; url: string };

function SourceCaption({ source, prefix = "Source" }: { source: Source; prefix?: string }) {
  return (
    <p className="text-[11px] text-gray-500 leading-snug mt-1.5">
      {prefix}:{" "}
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-gray-300 hover:decoration-[#0E2841] hover:text-[#0E2841] transition-colors"
      >
        {source.name} ({source.year})
        <ExternalLink size={9} className="inline ml-0.5 -mt-0.5" />
      </a>
    </p>
  );
}

export default function Industries() {
  return (
    <div className="pt-20">
      {/* Hero */}
      <section className="bg-[#0E2841] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest">Industries</span>
          <h1 className="text-5xl font-extrabold text-white mt-3 mb-5 max-w-3xl leading-tight">
            Deep domain expertise in the sectors that matter most.
          </h1>
          <p className="text-xl text-gray-300 max-w-2xl">
            Maven AI works where AI transformation is most consequential and most complex — across the GCC's flagship sectors, from sovereign public services to global hospitality.
          </p>
          <p className="text-xs text-gray-400 max-w-2xl mt-6 leading-relaxed">
            <span className="text-[#F5A623] font-semibold uppercase tracking-wider">A note on this page —</span> the headline figures and key metrics below are drawn from named third-party sources (PwC, McKinsey, BCG, Strategy&, IMARC, Mordor Intelligence, EY, Saudi Aramco, the Saudi Tourism Authority and the Public Investment Fund), and link to those sources. The case studies are <em>illustrative scenarios</em> showing how agentic AI can deliver value in each industry — not delivered Maven AI engagements; any numbers inside them are round figures or public benchmark ranges, not specific outcomes Maven AI has produced.
          </p>
        </div>
      </section>

      {/* Industry nav */}
      <div className="bg-white border-b border-gray-100 sticky top-20 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6 py-4 overflow-x-auto">
            {industries.map((ind) => (
              <a key={ind.id} href={`#${ind.id}`} className="text-sm font-semibold text-gray-500 hover:text-[#0E2841] transition-colors whitespace-nowrap flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ind.color }} />
                {ind.title}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Industries */}
      {industries.map((industry, idx) => {
        const Icon = industryIcons[industry.icon] || Building2;
        return (
          <section key={industry.id} id={industry.id} className={`py-24 scroll-mt-32 ${idx % 2 === 0 ? "bg-white" : "bg-[#F8F9FA]"}`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              {/* Header */}
              <div className="flex items-start gap-5 mb-12">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: industry.color + "18" }}>
                  <Icon size={28} style={{ color: industry.color }} />
                </div>
                <div>
                  <motion.h2
                    initial={{ opacity: 0, y: 15 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-3xl font-extrabold text-[#0E2841] mb-1"
                  >
                    {industry.title}
                  </motion.h2>
                  <p className="text-lg font-semibold" style={{ color: industry.color }}>{industry.subtitle}</p>
                </div>
              </div>

              <div className="grid lg:grid-cols-12 gap-10">
                {/* Main content */}
                <div className="lg:col-span-7 space-y-10">
                  {/* Hero stat */}
                  <div className="p-7 rounded-2xl" style={{ backgroundColor: industry.color + "10" }}>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-5xl font-black" style={{ color: industry.color }}>{industry.heroStat}</span>
                      <span className="text-gray-600 font-medium">{industry.heroStatLabel}</span>
                    </div>
                    <SourceCaption source={industry.heroStatSource} />
                  </div>

                  <p className="text-gray-700 leading-relaxed text-lg">{industry.description}</p>

                  {/* Challenges */}
                  <div>
                    <h3 className="text-lg font-bold text-[#0E2841] mb-5">Industry challenges we address</h3>
                    <div className="space-y-3">
                      {industry.challenges.map((challenge, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -10 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: i * 0.06 }}
                          className="flex gap-3 items-start"
                        >
                          <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: industry.color + "20" }}>
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: industry.color }} />
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed">{challenge}</p>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Our approach */}
                  <div className="p-7 bg-[#0E2841] rounded-2xl text-white">
                    <h3 className="font-bold text-[#F5A623] text-sm uppercase tracking-wider mb-3">Our approach</h3>
                    <p className="text-gray-300 leading-relaxed">{industry.approach}</p>
                  </div>
                </div>

                {/* Sidebar: Stats + Case vignette */}
                <div className="lg:col-span-5 space-y-5">
                  {/* Stats */}
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
                    <h3 className="font-bold text-[#0E2841] text-sm uppercase tracking-wider">Key metrics</h3>
                    {industry.stats.map((stat, i) => (
                      <div key={i} className="flex items-start gap-4">
                        <div className="text-2xl font-extrabold flex-shrink-0 min-w-[64px]" style={{ color: industry.color }}>{stat.value}</div>
                        <div className="flex-1">
                          <p className="text-sm text-gray-600 leading-relaxed">{stat.label}</p>
                          {stat.source && <SourceCaption source={stat.source} />}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Illustrative scenario */}
                  <div className="rounded-xl border-2 p-6" style={{ borderColor: industry.color + "40" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: industry.color }} />
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: industry.color }}>Illustrative scenario</span>
                    </div>
                    <h4 className="font-bold text-[#0E2841] mb-2">{industry.caseVignette.title}</h4>
                    <p className="text-xs text-gray-500 italic mb-4 leading-relaxed">{industry.caseVignette.framing}</p>
                    <div className="space-y-3">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: industry.color }}>Challenge</span>
                        <p className="text-sm text-gray-600 mt-1 leading-relaxed">{industry.caseVignette.challenge}</p>
                      </div>
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: industry.color }}>Approach</span>
                        <p className="text-sm text-gray-600 mt-1 leading-relaxed">{industry.caseVignette.approach}</p>
                      </div>
                      <div className="p-3 rounded-lg" style={{ backgroundColor: industry.color + "10" }}>
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: industry.color }}>What good looks like</span>
                        <p className="text-sm font-semibold text-[#0E2841] mt-1 leading-relaxed">{industry.caseVignette.outcome}</p>
                      </div>
                    </div>
                  </div>

                  <Link href="/contact" className="block w-full text-center font-bold py-3.5 rounded-xl text-white transition-colors" style={{ backgroundColor: industry.color }}>
                    Talk to our {industry.title} team <ArrowRight size={14} className="inline ml-1" />
                  </Link>
                </div>
              </div>
            </div>
          </section>
        );
      })}

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-[#0E2841] to-[#156082]">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-5">Don't see your sector?</h2>
          <p className="text-gray-300 mb-8 text-lg">Maven AI works with organizations across the GCC economy. Our agentic AI and data capabilities apply across industries — from healthcare to logistics to energy.</p>
          <Link href="/contact" className="inline-flex items-center gap-2 bg-[#F5A623] text-white font-bold px-8 py-4 rounded-xl hover:bg-[#d4622a] transition-colors">
            Discuss your industry <ArrowRight size={18} />
          </Link>
        </div>
      </section>
    </div>
  );
}
