import { motion } from "framer-motion";
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Linkedin, MapPin, Quote } from "lucide-react";
import { founders } from "@/data/content";
import OperatingModelDiagram from "@/components/OperatingModelDiagram";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } }),
};

function FounderPhoto({ src, name }: { src: string; name: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = name.split(" ").map((n) => n[0]).join("");
  return (
    <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-gradient-to-br from-[#0E2841] to-[#156082] relative">
      {!imgFailed && (
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover absolute inset-0 scale-[1.35] origin-center"
          onError={() => setImgFailed(true)}
        />
      )}
      {imgFailed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-black text-6xl opacity-30">{initials}</span>
        </div>
      )}
    </div>
  );
}

export default function About() {
  return (
    <div className="pt-20">
      {/* Hero */}
      <section className="bg-[#0E2841] py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #F5A623 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial="hidden" animate="visible" variants={fadeUp}>
            <span className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest">About Maven AI</span>
          </motion.div>
          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-5xl font-extrabold text-white mt-4 mb-6 max-w-3xl leading-tight"
          >
            Built to close the gap between AI ambition and AI in production.
          </motion.h1>
          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="text-xl text-gray-300 max-w-2xl leading-relaxed"
          >
            Maven AI was founded by four partners who spent years watching world-class organizations fail to move AI from the pilot to the production environment. We built the firm we always wished existed.
          </motion.p>
        </div>
      </section>

      {/* Story */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <div className="section-divider" />
              <h2 className="text-3xl font-extrabold text-[#0E2841] mb-6">Why we built Maven AI</h2>
              <div className="space-y-5 text-gray-600 leading-relaxed">
                <p>
                  Across the GCC, the AI opportunity is undeniable. National AI strategies, sovereign fund mandates, progressive regulatory frameworks — the region has created the conditions for AI-led transformation at an extraordinary scale.
                </p>
                <p>
                  What the region was missing was a delivery partner built for this moment. Not the large Tier-1 firms, whose pyramid models and partner economics make true production delivery structurally difficult. Not the pure-play technology vendors, who sell tools without the strategic and change management capability to make those tools work inside complex organizations.
                </p>
                <p>
                  Maven AI was founded by four partners with a combined six decades of consulting, engineering, and AI delivery experience across the GCC and globally. We built the firm around four structural choices that, together, make us better at this specific work: production-led delivery, boutique design, agentic-native capability, and platform-agnostic economics.
                </p>
                <p>
                  We are a sister company of Maven Insights, one of the GCC's leading management consulting firms, giving us access to a 200+ consultant bench, deep regional client relationships, and the change management and organizational capability that pure AI firms typically lack.
                </p>
              </div>
            </div>
            <div className="space-y-5">
              {[
                { num: "2025", title: "Founded", desc: "Maven AI incorporated as a dedicated AI delivery practice, sister company to Maven Insights." },
                { num: "200+", title: "Consultants available", desc: "Immediate access to Maven Insights' bench of advisory, PMO, change management, and domain specialists." },
                { num: "4", title: "GCC offices", desc: "Day-one presence in Dubai, Riyadh, Abu Dhabi, and Doha — the markets where GCC AI is being built." },
                { num: "4", title: "Founding partners", desc: "Combined 60+ years of consulting, engineering, and AI delivery in GCC and globally." },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="flex gap-5 p-5 border border-gray-100 rounded-xl"
                >
                  <div className="text-[#F5A623] font-black text-2xl leading-none w-16 flex-shrink-0 mt-0.5">{item.num}</div>
                  <div>
                    <h3 className="font-bold text-[#0E2841] mb-1">{item.title}</h3>
                    <p className="text-sm text-gray-600">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* The Thesis */}
      <section className="py-24 bg-[#F8F9FA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="section-divider mx-auto" />
            <h2 className="text-3xl font-extrabold text-[#0E2841] mb-4">The Maven AI thesis</h2>
            <p className="text-gray-600 max-w-xl mx-auto">Five design choices that, together, make Maven AI structurally better at AI delivery — by category, not by margin.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {[
              { num: "01", title: "Production-led", color: "#156082", desc: "We deliver AI in production, not AI in PowerPoint. Measured outcomes, not advisory decks. Every engagement is anchored to a quantified business case." },
              { num: "02", title: "Boutique by design", color: "#F5A623", desc: "Senior partners and principals on every engagement. The people you meet in the proposal are the people who will do your work." },
              { num: "03", title: "Agentic-native", color: "#F5A623", desc: "Built around agentic AI as the operating fabric. Not retrofitted onto a legacy professional services model from the BI or RPA era." },
              { num: "04", title: "Lean economics", color: "#196B24", desc: "Boutique structure plus partner leverage delivers senior-led work at rates the Tier-1 cost base structurally cannot match." },
              { num: "05", title: "Platform-agnostic", color: "#0E2841", desc: "Clients pick the right stack. Our economics aren't tied to any vendor, and our advice isn't either. Right tool, every time." },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm"
              >
                <div className="text-4xl font-black mb-3" style={{ color: item.color }}>{item.num}</div>
                <h3 className="font-bold text-[#0E2841] mb-3">{item.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Founders */}
      <section id="founders" className="py-24 bg-white scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="section-divider mx-auto" />
            <h2 className="text-3xl font-extrabold text-[#0E2841] mb-4">Our founding team</h2>
            <p className="text-gray-600 max-w-xl mx-auto">Four partners. Four complementary disciplines. One shared conviction: GCC organizations deserve a delivery partner built for this moment.</p>
          </div>

          <div className="space-y-12">
            {founders.map((founder, i) => (
              <motion.div
                key={founder.id}
                id={founder.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className={`grid lg:grid-cols-12 gap-8 items-start ${i % 2 === 1 ? "lg:flex-row-reverse" : ""}`}
              >
                {/* Photo */}
                <div className="lg:col-span-3">
                  <FounderPhoto src={founder.image} name={founder.name} />
                </div>

                {/* Bio */}
                <div className="lg:col-span-9">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-2xl font-extrabold text-[#0E2841]">{founder.name}</h3>
                      <p className="text-[#156082] font-semibold">{founder.title}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <MapPin size={13} className="text-gray-400" />
                        <span className="text-gray-500 text-sm">{founder.location}</span>
                      </div>
                    </div>
                    <a href={founder.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-2 border border-gray-200 hover:border-[#156082] text-gray-600 hover:text-[#156082] px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                      <Linkedin size={16} /> LinkedIn
                    </a>
                  </div>

                  <p className="text-gray-600 leading-relaxed mb-5">{founder.bio}</p>

                  <div className="flex flex-wrap gap-2 mb-6">
                    {founder.expertise.map((skill) => (
                      <span key={skill} className="text-xs font-semibold px-3 py-1.5 bg-[#F8F9FA] border border-gray-200 rounded-full text-gray-700">{skill}</span>
                    ))}
                  </div>

                  <blockquote className="border-l-4 border-[#F5A623] pl-5 py-2">
                    <p className="text-gray-700 italic leading-relaxed">"{founder.quote}"</p>
                  </blockquote>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Operating Model */}
      <section id="operating-model" className="py-24 bg-[#0E2841] scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="section-divider mx-auto" />
            <h2 className="text-3xl font-extrabold text-white mb-4">Our operating model</h2>
            <p className="text-gray-400 max-w-xl mx-auto">A small core leveraging four rings of capability — lean by design. Every dollar of revenue requires a fraction of the headcount of a Tier-1.</p>
          </div>
          <OperatingModelDiagram />
        </div>
      </section>

      {/* Sister Company */}
      <section className="py-20 bg-[#F8F9FA]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="section-divider mx-auto" />
          <h2 className="text-3xl font-extrabold text-[#0E2841] mb-5">Backed by Maven Insights</h2>
          <p className="text-gray-600 max-w-2xl mx-auto mb-8 leading-relaxed">
            Maven Insights is a leading management consulting firm with offices across the GCC. Maven AI was founded as a dedicated AI delivery practice, with direct access to Maven Insights' consulting bench, regional client relationships, and change management expertise. Together, we offer the most complete AI-to-production capability in the region.
          </p>
          <a href="https://www.maveninsights.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-[#156082] text-[#156082] font-semibold px-7 py-3.5 rounded-xl hover:bg-[#156082] hover:text-white transition-colors">
            Learn about Maven Insights <ArrowRight size={16} />
          </a>
        </div>
      </section>
    </div>
  );
}
