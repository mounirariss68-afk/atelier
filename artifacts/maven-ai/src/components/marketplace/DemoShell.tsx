import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Network, type LucideIcon } from "lucide-react";
import { useLang, tStr } from "@/lib/lang";
import type { BiText } from "@workspace/maven-content";
import { getAgentCast } from "@workspace/maven-content";
import {
  marketplaceTools,
  servicesIndex,
  assessmentsIndex,
} from "@/data/content";
import AgentExplainer from "./AgentExplainer";

const COPY = {
  back: { en: "Back to Marketplace", ar: "العودة إلى السوق" },
  liveBadge: { en: "Live demo", ar: "عرض تفاعلي" },
  buyer: { en: "Named buyer", ar: "المشتري المستهدف" },
  partner: {
    en: "Talk to a partner about this tool",
    ar: "تحدّث مع شريك حول هذه الأداة",
  },
  partnerCta: { en: "Open contact form", ar: "افتح نموذج التواصل" },
  service: { en: "Related Maven AI service", ar: "خدمة Maven AI المرتبطة" },
  serviceCta: { en: "Read service brief", ar: "اقرأ موجز الخدمة" },
  assessment: { en: "Run the related diagnostic", ar: "شغّل التشخيص المرتبط" },
  assessmentCta: { en: "Run the diagnostic", ar: "شغّل التشخيص" },
  exploreServices: { en: "Explore Maven AI services", ar: "استعرض خدمات Maven AI" },
  servicesEyebrow: { en: "Services", ar: "الخدمات" },
  engageEyebrow: { en: "Engage", ar: "ابدأ" },
  howItWorks: { en: "How does this work?", ar: "كيف يعمل؟" },
};

interface DemoShellProps {
  slug: string;
  eyebrow: BiText;
  title: BiText;
  intro: BiText;
  accent: string;
  Icon: LucideIcon;
  note?: BiText;
  /** Toolbar — reset/print/etc — rendered on the right side of the action bar. */
  toolbar?: ReactNode;
  children: ReactNode;
}

export default function DemoShell({
  slug,
  eyebrow,
  title,
  intro,
  accent,
  Icon,
  note,
  toolbar,
  children,
}: DemoShellProps) {
  const { lang, dir } = useLang();
  const tool = marketplaceTools.find((t) => t.slug === slug);
  const hasCast = !!getAgentCast(slug);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const relatedService = tool?.relatedService
    ? servicesIndex.find((s) => s.slug === tool.relatedService)
    : undefined;
  const relatedAssessment = tool?.relatedAssessment
    ? assessmentsIndex.find((a) => a.slug === tool.relatedAssessment)
    : undefined;

  return (
    <div className="pt-20" dir={dir}>
      {/* Hero */}
      <section className="bg-[#0E2841] py-14 sm:py-16 print:py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-white mb-5 print:hidden"
          >
            <ArrowLeft size={14} className="rtl:rotate-180" />
            {tStr(COPY.back, lang)}
          </Link>
          <div className="flex items-start gap-5 mb-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: accent + "33" }}
            >
              <Icon size={26} style={{ color: accent }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-white"
                  style={{ backgroundColor: accent }}
                >
                  {tStr(eyebrow, lang)}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-white text-[#0E2841]">
                  {tStr(COPY.liveBadge, lang)}
                </span>
                {tool && (
                  <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-white/10 text-gray-200">
                    {tStr(COPY.buyer, lang)}: {tStr(tool.buyer, lang)}
                  </span>
                )}
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight max-w-3xl">
                {tStr(title, lang)}
              </h1>
            </div>
          </div>
          <p className="text-base sm:text-lg text-gray-300 max-w-3xl leading-relaxed">
            {tStr(intro, lang)}
          </p>
        </div>
      </section>

      {/* Action bar — always rendered so the explainer button is always visible */}
      <section className="bg-white border-b border-gray-100 py-4 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center gap-3 justify-between">
          {note ? (
            <p className="text-xs text-gray-500 max-w-xl leading-relaxed">
              {tStr(note, lang)}
            </p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2 ms-auto flex-wrap">
            {hasCast && (
              <button
                type="button"
                onClick={() => setExplainerOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0E2841] hover:bg-[#142d4d] text-white text-xs font-bold transition-colors"
              >
                <Network size={13} />
                {tStr(COPY.howItWorks, lang)}
              </button>
            )}
            {toolbar}
          </div>
        </div>
      </section>

      {hasCast && (
        <AgentExplainer slug={slug} open={explainerOpen} onClose={() => setExplainerOpen(false)} />
      )}

      {/* Demo body */}
      <div className="bg-white">{children}</div>

      {/* CTAs */}
      <section className="py-16 bg-gradient-to-br from-[#0E2841] to-[#156082] print:hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid sm:grid-cols-2 gap-5">
          <Link
            href={`/contact?topic=${slug}`}
            className="group p-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-colors flex flex-col gap-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
              {tStr(COPY.engageEyebrow, lang)}
            </span>
            <span className="text-lg font-bold text-white">{tStr(COPY.partner, lang)}</span>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#F5A623] mt-2">
              {tStr(COPY.partnerCta, lang)}
              <ArrowRight size={14} className="rtl:rotate-180" />
            </span>
          </Link>
          {relatedService ? (
            <Link
              href={`/services/${relatedService.slug}`}
              className="group p-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-colors flex flex-col gap-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                {tStr(COPY.service, lang)}
              </span>
              <span className="text-lg font-bold text-white">{relatedService.title}</span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#F5A623] mt-2">
                {tStr(COPY.serviceCta, lang)}
                <ArrowRight size={14} className="rtl:rotate-180" />
              </span>
            </Link>
          ) : (
            <Link
              href="/services"
              className="group p-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-colors flex flex-col gap-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
                {tStr(COPY.servicesEyebrow, lang)}
              </span>
              <span className="text-lg font-bold text-white">
                {tStr(COPY.exploreServices, lang)}
              </span>
            </Link>
          )}
          {relatedAssessment && (
            <Link
              href={`/assessments/${relatedAssessment.slug}`}
              className="group p-6 bg-[#F5A623] hover:bg-[#d4622a] rounded-2xl transition-colors flex flex-col gap-2 sm:col-span-2"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">
                {tStr(COPY.assessment, lang)}
              </span>
              <span className="text-lg font-bold text-white">
                {relatedAssessment.code} — {relatedAssessment.name}
              </span>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-white mt-2">
                {tStr(COPY.assessmentCta, lang)}
                <ArrowRight size={14} className="rtl:rotate-180" />
              </span>
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
