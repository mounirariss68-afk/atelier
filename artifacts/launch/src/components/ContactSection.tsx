import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, ArrowLeft, MapPin, Mail, Building2, CheckCircle2 } from "lucide-react";
import menatMap from "@assets/MENAT_Map_1782623616287.png";

const SUPPORT_EMAIL = "support@cognirise.ai";

const CITIES = ["Riyadh", "Dubai", "Abu Dhabi", "Doha", "Istanbul"];

function Reveal({
  children, delay = 0, y = 28, className = "",
}: { children: React.ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
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

const inputCls =
  "w-full rounded-xl bg-navydeep/60 border border-white/10 px-4 py-3 text-[15px] text-white placeholder:text-offwhite/35 outline-none transition-colors focus:border-cogpurple/70 focus:bg-navydeep/80";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="block text-[11px] uppercase tracking-[2px] text-mutedgrey mb-2">{label}</span>
      {children}
    </label>
  );
}

export default function ContactSection({ id }: { id?: string }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [sent, setSent] = useState(false);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = `New enquiry from ${form.name || "website visitor"}${form.company ? ` — ${form.company}` : ""}`;
    const body = [
      `Name: ${form.name}`,
      `Email: ${form.email}`,
      `Company: ${form.company || "—"}`,
      "",
      "Message:",
      form.message,
    ].join("\n");
    const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    setSent(true);
  };

  return (
    <section id={id} className="relative overflow-hidden pt-10 pb-28 md:pt-14 scroll-mt-24 md:scroll-mt-28">
      {/* ===== Background map ===== */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <img
          src={menatMap}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover opacity-[0.35] select-none"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-navy via-navy/85 to-navy" />
        <div className="glow-a absolute top-1/4 -left-20 w-[34rem] h-[34rem] rounded-full bg-cogpurple/15 blur-[150px]" />
        <div className="glow-b absolute bottom-0 right-0 w-[30rem] h-[30rem] rounded-full bg-cogmagenta/12 blur-[150px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        <div className="max-w-3xl">
          <Reveal><Eyebrow>Contact us</Eyebrow></Reveal>
          <Reveal delay={0.05}>
            <h2 className="text-[38px] md:text-[60px] font-extrabold text-white tracking-[-2px] leading-[1.03]">
              Let’s build your <span className="text-gradient">Agentic Enterprise.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-lg text-offwhite/65 mt-6 font-light leading-relaxed">
              Tell us what you’re trying to achieve. We’ll get back to you to scope a 48-hour prototype and a path to full platform ownership.
            </p>
          </Reveal>
        </div>

        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8 mt-14 items-start">
          {/* ===== Form ===== */}
          <Reveal delay={0.05}>
            <div className="grad-border bg-navydeep/50 backdrop-blur-md p-7 md:p-9 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)]">
              {sent ? (
                <div className="flex flex-col items-start gap-4 py-6">
                  <span className="w-12 h-12 rounded-full bg-cog-grad-diag flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-white" />
                  </span>
                  <h3 className="text-2xl font-bold text-white">Your message is ready to send.</h3>
                  <p className="text-offwhite/65 font-light leading-relaxed">
                    We’ve opened your email app with the details pre-filled. If nothing opened, write to us directly at{" "}
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-cogmagenta hover:text-white transition-colors">{SUPPORT_EMAIL}</a>.
                  </p>
                  <button
                    onClick={() => setSent(false)}
                    className="mt-2 inline-flex items-center gap-2 text-sm text-offwhite/75 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" /> Edit message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid sm:grid-cols-2 gap-5">
                    <Field label="Name" htmlFor="name">
                      <input id="name" required value={form.name} onChange={update("name")} placeholder="Your full name" className={inputCls} />
                    </Field>
                    <Field label="Work email" htmlFor="email">
                      <input id="email" type="email" required value={form.email} onChange={update("email")} placeholder="you@company.com" className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Company" htmlFor="company">
                    <input id="company" value={form.company} onChange={update("company")} placeholder="Company name" className={inputCls} />
                  </Field>
                  <Field label="How can we help?" htmlFor="message">
                    <textarea id="message" required value={form.message} onChange={update("message")} rows={5} placeholder="Tell us about your goals, timelines and any context…" className={`${inputCls} resize-none`} />
                  </Field>
                  <button
                    type="submit"
                    className="group inline-flex items-center gap-2 bg-cog-grad-diag text-white px-8 py-4 rounded-full text-base font-semibold shadow-[0_14px_40px_-10px_rgba(138,91,214,0.8)] hover:scale-[1.02] transition-transform"
                  >
                    Send message <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <p className="text-xs text-offwhite/45 pt-1">
                    Submitting opens your email app, pre-filled to{" "}
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-mutedgrey hover:text-white transition-colors">{SUPPORT_EMAIL}</a>.
                  </p>
                </form>
              )}
            </div>
          </Reveal>

          {/* ===== Locations + direct contact ===== */}
          <Reveal delay={0.12}>
            <div className="space-y-5">
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="grad-border bg-navylight/20 backdrop-blur-md p-6 flex items-center gap-4 group transition-transform hover:-translate-y-0.5"
              >
                <span className="w-11 h-11 rounded-xl bg-cog-grad-diag flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5 text-white" />
                </span>
                <span className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[2px] text-mutedgrey mb-1">Email</p>
                  <p className="text-white font-semibold truncate">{SUPPORT_EMAIL}</p>
                </span>
                <ArrowUpRight className="w-4 h-4 text-offwhite/50 ml-auto group-hover:text-white transition-colors" />
              </a>

              <div className="grad-border bg-navylight/20 backdrop-blur-md p-6">
                <div className="flex items-center gap-3 mb-5">
                  <span className="w-11 h-11 rounded-xl bg-cog-grad-diag flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-white" />
                  </span>
                  <div>
                    <p className="text-[11px] uppercase tracking-[2px] text-mutedgrey mb-1">Head office</p>
                    <p className="text-white font-semibold">Dubai, United Arab Emirates</p>
                  </div>
                </div>
                <div className="flex gap-3 text-offwhite/70">
                  <Building2 className="w-4 h-4 mt-0.5 shrink-0 text-cogmagenta" />
                  <div className="text-sm leading-relaxed font-light">
                    <p className="text-white/90 font-medium">
                      Cognitive Rise Artificial Intelligence Developing Services L.L.C
                    </p>
                    <p className="mt-1.5">Prestige 2 Business Center</p>
                    <p>Business Bay, 1914-13</p>
                    <p>Dubai, United Arab Emirates</p>
                  </div>
                </div>

                <div className="mt-6 pt-5 border-t border-white/10">
                  <p className="text-[11px] uppercase tracking-[2px] text-mutedgrey mb-3">Where we are</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-offwhite/70">
                    {CITIES.map((city, i) => (
                      <span key={city} className="flex items-center gap-x-3">
                        {i > 0 && <span className="text-cogmagenta/60">·</span>}
                        <span className="text-[15px] font-medium">{city}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
