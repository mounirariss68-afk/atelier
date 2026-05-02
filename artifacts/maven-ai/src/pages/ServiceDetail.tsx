import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Code2, Database, Rocket, CheckCircle, Clock, Users } from "lucide-react";
import { services, insights } from "@/data/content";

const serviceIcons: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  Brain, Code2, Database, Rocket,
};

export default function ServiceDetail() {
  const [, params] = useRoute("/services/:slug");
  const service = services.find((s) => s.slug === params?.slug);

  if (!service) {
    return (
      <div className="pt-20 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#0E2841] mb-4">Service not found</h1>
          <Link href="/services" className="text-[#156082] font-semibold hover:underline">Back to Services</Link>
        </div>
      </div>
    );
  }

  const Icon = serviceIcons[service.icon] || Brain;
  const relatedInsight = insights.find((i) => i.id === service.relatedReport);

  return (
    <div className="pt-20">
      {/* Hero */}
      <section className="bg-[#0E2841] py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #F5A623 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/services" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-8 transition-colors">
            ← Back to Services
          </Link>
          <div className="flex items-start gap-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: service.color + "30" }}>
              <Icon size={32} style={{ color: service.color }} />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full mb-4 inline-block" style={{ backgroundColor: service.color + "25", color: service.color }}>
                Buyer: {service.buyer}
              </span>
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl sm:text-5xl font-extrabold text-white mt-3 mb-4 max-w-3xl leading-tight"
              >
                {service.title}
              </motion.h1>
              <p className="text-xl text-gray-300 max-w-2xl">{service.tagline}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {service.stats.map((stat, i) => (
              <div key={i} className="text-center p-4">
                <div className="text-3xl font-extrabold mb-1" style={{ color: service.color }}>{stat.value}</div>
                <div className="text-sm text-gray-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Overview */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-12">
            <div className="lg:col-span-7">
              <div className="section-divider" />
              <h2 className="text-3xl font-extrabold text-[#0E2841] mb-6">Overview</h2>
              <p className="text-gray-600 text-lg leading-relaxed mb-10">{service.longDescription}</p>

              <h3 className="text-xl font-bold text-[#0E2841] mb-5">Representative use cases</h3>
              <div className="space-y-4">
                {service.useCases.map((uc, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08, duration: 0.4 }}
                    className="flex gap-3 p-4 border border-gray-100 rounded-xl"
                  >
                    <CheckCircle size={18} style={{ color: service.color }} className="mt-0.5 flex-shrink-0" />
                    <p className="text-gray-700 text-sm leading-relaxed">{uc}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5 space-y-6">
              {/* Engagement model */}
              <div className="bg-[#F8F9FA] rounded-2xl p-7">
                <h3 className="text-lg font-bold text-[#0E2841] mb-5 flex items-center gap-2">
                  <Clock size={18} style={{ color: service.color }} /> Engagement model
                </h3>
                <div className="space-y-4">
                  {service.engagementModel.map((phase, i) => (
                    <div key={i} className="flex gap-4">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: service.color }}
                      >
                        {i + 1}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-[#0E2841] text-sm">{phase.phase}</span>
                          <span className="text-xs text-gray-400 font-medium">{phase.duration}</span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">{phase.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Related insight */}
              {relatedInsight && (
                <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className="h-36 bg-[#0E2841] relative overflow-hidden">
                    <img
                      src={relatedInsight.coverImage}
                      alt={relatedInsight.title}
                      className="w-full h-full object-cover opacity-60"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0E2841]/80 to-transparent" />
                    <div className="absolute bottom-3 left-4">
                      <span className="text-xs font-bold text-white bg-[#F5A623] px-2 py-0.5 rounded">Related Report</span>
                    </div>
                  </div>
                  <div className="p-5">
                    <h4 className="font-bold text-[#0E2841] mb-2 text-sm leading-snug">{relatedInsight.title}</h4>
                    <p className="text-xs text-gray-500 mb-3">{relatedInsight.readTime} · {relatedInsight.date}</p>
                    <Link href={`/insights/${relatedInsight.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#156082] hover:text-[#F5A623] transition-colors">
                      Read report <ArrowRight size={13} />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20" style={{ backgroundColor: service.color }}>
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">Ready to explore {service.title}?</h2>
          <p className="text-white/80 mb-8 text-lg">Three days to scope. Three weeks to prototype. Let's start the conversation.</p>
          <Link href="/contact" className="inline-flex items-center gap-2 bg-white text-[#0E2841] font-bold px-8 py-4 rounded-xl hover:bg-gray-100 transition-colors">
            Schedule a call <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
}
