import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { MapPin, Phone, Mail, Send, CheckCircle, Clock, Users, ArrowRight } from "lucide-react";

const offices = [
  { city: "Dubai", country: "UAE", address: "Jumeirah Lakes Towers, Cluster Y\nSwiss Tower 3402, 34th Floor", phone: "+971 4 561 3707", primary: true },
  { city: "Riyadh", country: "KSA", address: "4288, Anas Bin Malik\n6745 Al Malqa District", phone: "+966 11 257 1940", primary: true },
  { city: "Abu Dhabi", country: "UAE", address: "Block B Offices\nMusaffah, M40, 91", phone: "+971 5 259 91055", primary: false },
  { city: "Doha", country: "Qatar", address: "Office 241-3, Floor 2\nRegus, No. 67", phone: "+974 442 31111", primary: false },
];

const interestAreas = [
  "Agentic AI Transformation",
  "AI-Driven SDLC & Legacy Modernization",
  "Data & Governance Foundations",
  "AI Product Studio",
  "General Inquiry",
  "Partnership",
];

export default function Contact() {
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", interest: "", message: "" });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="pt-20">
      {/* Hero */}
      <section className="bg-[#0E2841] py-20 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle, #F5A623 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <span className="text-[#F5A623] font-semibold text-sm uppercase tracking-widest">Contact</span>
          <h1 className="text-5xl font-extrabold text-white mt-3 mb-5 max-w-2xl leading-tight">
            Let's talk about what AI can do for your organization.
          </h1>
          <p className="text-xl text-gray-300 max-w-xl">
            Three days to scope. Three weeks to prototype. 90 days to MVP. It starts with a conversation.
          </p>
          <div className="mt-8 inline-flex items-center gap-3 bg-white/5 border border-white/15 rounded-2xl px-5 py-4">
            <div className="w-10 h-10 rounded-lg bg-[#0F9ED5]/20 flex items-center justify-center flex-shrink-0">
              <ArrowRight size={18} className="text-[#0F9ED5]" />
            </div>
            <div className="text-sm text-white/85">
              <p className="font-semibold text-white">Not ready for a call yet?</p>
              <p>Take a free 12-minute diagnostic and we will respond with your scored memo.</p>
            </div>
            <Link href="/assessments" className="ml-2 bg-[#0F9ED5] hover:bg-[#0E8BB8] text-white text-sm font-bold px-4 py-2 rounded-lg whitespace-nowrap">
              Start a diagnostic
            </Link>
          </div>
        </div>
      </section>

      {/* Why talk to us */}
      <section className="py-12 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: Clock, color: "#156082", title: "3-day scoping", desc: "We scope the opportunity and propose a plan — before you commit to anything" },
              { icon: Users, color: "#F5A623", title: "Senior-led from day one", desc: "You'll speak to a Partner in your first call — not a business development team" },
              { icon: ArrowRight, color: "#F5A623", title: "Production focus", desc: "Every conversation starts with the outcome you need — not the solution we want to sell" },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex gap-4 p-5 rounded-xl bg-gray-50">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: item.color + "18" }}>
                    <Icon size={20} style={{ color: item.color }} />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#0E2841] mb-1 text-sm">{item.title}</h3>
                    <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Form + Info */}
      <section className="py-20 bg-[#F8F9FA]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-12 gap-12">
            {/* Form */}
            <div className="lg:col-span-7">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                <h2 className="text-2xl font-extrabold text-[#0E2841] mb-2">Get in touch</h2>
                <p className="text-gray-500 text-sm mb-8">We typically respond within one business day.</p>

                {submitted ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-16"
                  >
                    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
                      <CheckCircle size={32} className="text-green-600" />
                    </div>
                    <h3 className="text-xl font-bold text-[#0E2841] mb-2">Message sent</h3>
                    <p className="text-gray-500">A Partner will be in touch within one business day.</p>
                  </motion.div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Full name *</label>
                        <input
                          required
                          type="text"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder="Your name"
                          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#156082] focus:ring-1 focus:ring-[#156082] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Company *</label>
                        <input
                          required
                          type="text"
                          value={form.company}
                          onChange={(e) => setForm({ ...form, company: e.target.value })}
                          placeholder="Your organization"
                          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#156082] focus:ring-1 focus:ring-[#156082] transition-colors"
                        />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Email *</label>
                        <input
                          required
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          placeholder="work@company.com"
                          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#156082] focus:ring-1 focus:ring-[#156082] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Phone</label>
                        <input
                          type="tel"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                          placeholder="+971 ..."
                          className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#156082] focus:ring-1 focus:ring-[#156082] transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Area of interest *</label>
                      <select
                        required
                        value={form.interest}
                        onChange={(e) => setForm({ ...form, interest: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#156082] focus:ring-1 focus:ring-[#156082] transition-colors text-gray-700"
                      >
                        <option value="" disabled>Select an area</option>
                        {interestAreas.map((area) => <option key={area}>{area}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Message *</label>
                      <textarea
                        required
                        rows={5}
                        value={form.message}
                        onChange={(e) => setForm({ ...form, message: e.target.value })}
                        placeholder="Tell us about your AI challenge or what you'd like to explore..."
                        className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#156082] focus:ring-1 focus:ring-[#156082] transition-colors resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full flex items-center justify-center gap-2 bg-[#F5A623] hover:bg-[#d4622a] text-white font-bold py-3.5 rounded-xl transition-colors"
                    >
                      Send message <Send size={16} />
                    </button>
                    <p className="text-xs text-gray-400 text-center">By submitting, you agree to Maven AI's privacy policy.</p>
                  </form>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="lg:col-span-5 space-y-6">
              <div>
                <h2 className="text-2xl font-extrabold text-[#0E2841] mb-2">Our offices</h2>
                <p className="text-gray-500 text-sm">Present across the GCC's four main business centers.</p>
              </div>

              {offices.map((office) => (
                <motion.div
                  key={office.city}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className={`p-5 rounded-xl border ${office.primary ? "border-[#156082]/30 bg-[#156082]/5" : "border-gray-100 bg-white"}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin size={15} className="text-[#F5A623]" />
                    <span className="font-bold text-[#0E2841]">{office.city}, {office.country}</span>
                    {office.primary && <span className="text-xs font-semibold text-[#156082] bg-[#156082]/10 px-2 py-0.5 rounded-full">Main office</span>}
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-line pl-5 mb-1.5">{office.address}</p>
                  <div className="flex items-center gap-1.5 pl-5">
                    <Phone size={12} className="text-gray-400" />
                    <a href={`tel:${office.phone.replace(/\s/g, "")}`} className="text-sm text-gray-500 hover:text-[#156082] transition-colors">{office.phone}</a>
                  </div>
                </motion.div>
              ))}

              {/* Email */}
              <div className="p-5 rounded-xl bg-[#0E2841] text-white">
                <div className="flex items-center gap-2 mb-2">
                  <Mail size={15} className="text-[#F5A623]" />
                  <span className="font-bold">Email us directly</span>
                </div>
                <a href="mailto:info@maven-ai.com" className="text-[#F5A623] hover:text-white transition-colors text-sm">info@maven-ai.com</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
