import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Calendar,
  Download,
  Loader2,
  Mail,
  Sparkles,
  ShieldCheck,
  Users,
  Lock,
} from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import {
  getAssessment,
  TIER_INTERPRETATION,
  ui,
  type AssessmentSlug,
  type ScoreResult,
} from "@workspace/assessments";
import { fetchSubmission, fetchMemo, emailReport, bookCall, createTeamLink, fetchTeamHeatmap, type SubmissionDetail } from "@/lib/api";
import { useLang, tStr, formatDate, formatNumber, type T } from "@/lib/lang";
import Gauge from "@/components/assessment/Gauge";
import Radar from "@/components/assessment/Radar";
import UvrPortfolio from "@/components/assessment/UvrPortfolio";
import Heatmap from "@/components/assessment/Heatmap";
import AssessmentPDF from "@/components/assessment/AssessmentPDF";
import Logo from "@/components/Logo";

const TIER_COLORS: Record<string, string> = {
  Nascent: "#B91C1C",
  Emerging: "#D97706",
  Established: "#5B7CFF",
  Advanced: "#5B7CFF",
  Leading: "#8A5BD6",
};

export default function AssessmentResults() {
  const [, params] = useRoute("/assessments/:slug/results/:publicId");
  const slug = params?.slug as AssessmentSlug | undefined;
  const publicId = params?.publicId;
  const { lang, dir } = useLang();
  const t = (s: T) => tStr(s, lang);

  const [data, setData] = useState<SubmissionDetail | null>(null);
  const [memoLoading, setMemoLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [teamLink, setTeamLink] = useState<string | null>(null);
  const [bookingDone, setBookingDone] = useState(false);
  const [heatmap, setHeatmap] = useState<{
    ready: boolean;
    count?: number;
    needed?: number;
    respondents?: { name: string; role: string; overall: number; dimensionScores: Record<string, number> }[];
    variance?: Record<string, number>;
    dimensions?: { id: string; title: { en: string; ar: string } }[];
  } | null>(null);

  const def = useMemo(() => (slug ? getAssessment(slug) : null), [slug]);

  useEffect(() => {
    if (!publicId) return;
    fetchSubmission(publicId).then(setData).catch(() => setData(null));
  }, [publicId]);

  useEffect(() => {
    if (!data || data.memo) return;
    setMemoLoading(true);
    fetchMemo(data.publicId)
      .then((r) => setData((prev) => (prev ? { ...prev, memo: r.memo } : prev)))
      .finally(() => setMemoLoading(false));
  }, [data]);

  if (!def || !publicId) {
    return <div className="pt-32 text-center text-gray-500">{t({ en: "Not found", ar: "غير موجود", tr: "Bulunamadı" })}</div>;
  }
  if (!data) {
    return (
      <div className="pt-32 text-center">
        <Loader2 className="mx-auto animate-spin text-[#5B7CFF]" size={48} />
      </div>
    );
  }

  const result = data.result as ScoreResult;
  const tierColor = TIER_COLORS[result.tier] ?? "#5B7CFF";
  const interp = TIER_INTERPRETATION[result.tier];
  const radarDims = def.dimensions.map((d) => ({ id: d.id, label: tStr(d.title, lang) }));
  const peerAverages = result.peerBenchmark;
  const sovereignSummary = result.sovereignSubScore.components
    .slice(0, 2)
    .map((c) => `${tStr(c.label, lang)}: ${formatNumber(c.value, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`)
    .join(" · ");
  const productivityFte = +(result.costOfInaction.ebitDeltaUsd / 250_000).toFixed(1);
  const sovereignSpecific = result.recommendations.roadmap6m;
  const assessmentLang = lang;
  const antiVendorMessage = tStr({ en: def.antiVendor.en[0] ?? "", ar: def.antiVendor.ar[0] ?? "", tr: def.antiVendor.tr?.[0] }, lang);
  const fmtScore = (n: number) => formatNumber(n, lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const blob = await pdf(
        <AssessmentPDF
          def={def}
          result={result}
          profile={data.profile}
          memo={data.memo ?? ""}
          lang={assessmentLang}
          publicId={data.publicId}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Cognirise-${def.code}-${data.profile.company.replace(/\s+/g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const sendEmail = async () => {
    setEmailing(true);
    await emailReport(data.publicId, window.location.href);
    setEmailing(false);
    setEmailSent(true);
  };

  const handleTeam = async () => {
    setShowTeam(true);
    if (teamLink) return;
    const r = await createTeamLink({
      slug: def.slug,
      initiatorName: data.profile.name,
      initiatorEmail: data.profile.email,
      company: data.profile.company,
      seats: 10,
    });
    const url = `${window.location.origin}/assessments/team/${r.teamToken}`;
    setTeamLink(url);
    fetchTeamHeatmap(r.teamToken).then(setHeatmap).catch(() => undefined);
  };

  return (
    <div dir={dir} className="bg-gradient-to-b from-slate-50 via-white to-slate-50 pt-20 pb-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* Hero */}
        <section className="relative bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10 blur-3xl pointer-events-none" style={{ backgroundColor: tierColor }} />
          <div className="p-8 sm:p-12 relative">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: def.brandColor }}>
                {def.code}
              </span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">{data.profile.company}</span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">{formatDate(new Date(data.createdAt), lang)}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#0A1230] leading-tight">
              {t({ en: "Your", ar: "تقريرك في", tr: "Sizin" })} {def.code} {t({ en: "report", ar: "", tr: "raporunuz" })}
            </h1>
            <p className="mt-2 text-lg text-gray-600 max-w-2xl">{t(def.subtitle)}</p>

            <div className="mt-10 grid sm:grid-cols-2 gap-8 items-center">
              <div className="text-center sm:text-left">
                <Gauge score={result.overallScore} color={tierColor} label={t({ en: "out of 5", ar: "من 5", tr: "5 üzerinden" })} />
                <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-xs font-bold uppercase tracking-widest"
                  style={{ backgroundColor: tierColor }}>
                  <BadgeCheck size={14} />
                  {result.tier} · {t(interp)}
                </div>
              </div>
              <div className="text-center sm:text-left">
                <div className="border-l-4 pl-5 py-2" style={{ borderColor: "#8A5BD6" }}>
                  <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
                    {t(ui.results.sovereignSubScore)}
                  </p>
                  <p className="text-4xl font-extrabold text-[#8A5BD6]">
                    {fmtScore(result.sovereignSubScore.score)} <span className="text-base text-gray-400">/ 5</span>
                  </p>
                  <p className="text-sm text-gray-600 mt-2 leading-relaxed">{sovereignSummary || t({ en: "No sovereign-flagged answers yet.", ar: "لا توجد إجابات سيادية بعد.", tr: "Henüz egemenlikle ilgili işaretlenmiş yanıt yok." })}</p>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={downloadPdf}
                disabled={downloading}
                className="inline-flex items-center gap-2 bg-[#0A1230] hover:bg-[#1B2755] text-white font-semibold px-5 py-3 rounded-xl transition"
                data-testid="button-download-pdf"
              >
                {downloading ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                {t(ui.results.downloadPdf)}
              </button>
              <button
                onClick={sendEmail}
                disabled={emailing || emailSent}
                className="inline-flex items-center gap-2 bg-white border-2 border-[#5B7CFF] text-[#5B7CFF] font-semibold px-5 py-3 rounded-xl hover:bg-blue-50 transition"
                data-testid="button-email-report"
              >
                {emailing ? <Loader2 className="animate-spin" size={16} /> : <Mail size={16} />}
                {emailSent ? t({ en: "Sent ✓", ar: "تم الإرسال ✓", tr: "Gönderildi ✓" }) : t(ui.results.emailReport)}
              </button>
              <button
                onClick={() => setShowBooking(true)}
                className="inline-flex items-center gap-2 bg-[#C45BB8] hover:bg-[#A04A99] text-white font-bold px-5 py-3 rounded-xl transition shadow-lg"
                data-testid="button-book-call"
              >
                <Calendar size={16} /> {t(ui.results.bookCall)}
              </button>
            </div>
          </div>
        </section>

        {/* Memo */}
        <section className="mt-8 bg-white rounded-3xl shadow-lg border border-gray-100 p-8 sm:p-12">
          <div className="flex items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
            <Logo variant="light" size="sm" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              {t({ en: "Executive memo", ar: "مذكرة تنفيذية", tr: "Yönetici notu" })}
            </span>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="text-[#C45BB8]" size={20} />
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#C45BB8]">
              {t(ui.results.memoTitle)}
            </h2>
          </div>
          <h3 className="text-2xl sm:text-3xl font-extrabold text-[#0A1230] mb-6">
            {t(ui.results.fromThePartnership)}
          </h3>
          {data.memo ? (
            <div className="prose prose-slate max-w-none">
              {data.memo.split("\n\n").map((para, i) => (
                <p key={i} className="text-gray-700 leading-relaxed text-lg mb-4">
                  {para}
                </p>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-gray-400">
              <Loader2 className="animate-spin" size={18} />
              <p>{memoLoading ? t({ en: "Drafting your memo…", ar: "جارٍ إعداد المذكرة…", tr: "Notunuz hazırlanıyor…" }) : t({ en: "Loading…", ar: "جارٍ التحميل…", tr: "Yükleniyor…" })}</p>
            </div>
          )}
        </section>

        {/* Radar / breakdown */}
        <section className="mt-8 bg-white rounded-3xl shadow-lg border border-gray-100 p-8 sm:p-12">
          <h2 className="text-2xl font-extrabold text-[#0A1230] mb-2">
            {t(ui.results.radarTitle)}
          </h2>
          <p className="text-sm text-gray-500 mb-8">
            {t({ en: "Your scores (filled) vs GCC peer averages (dashed).", ar: "نتائجك (ملوّن) مقابل متوسط أقران الخليج (متقطع).", tr: "Skorlarınız (dolu) ile Körfez akran ortalamaları (kesikli) karşılaştırması." })}
          </p>
          <div className="grid md:grid-cols-2 gap-8 items-start">
            <Radar dimensions={radarDims} scores={result.dimensionScores} benchmark={peerAverages} color={def.brandColor} />
            <div className="space-y-3">
              {def.dimensions.map((d) => {
                const v = result.dimensionScores[d.id] ?? 0;
                const peer = peerAverages[d.id] ?? 0;
                const delta = v - peer;
                return (
                  <div key={d.id} className="border rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold text-[#0A1230]">{t(d.title)}</p>
                      <p className="text-sm font-bold" style={{ color: def.brandColor }}>{fmtScore(v)}</p>
                    </div>
                    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="absolute h-2 rounded-full" style={{ width: `${(v / 5) * 100}%`, backgroundColor: def.brandColor }} />
                      <div className="absolute h-3 -top-0.5 w-0.5 bg-gray-700" style={{ left: `${(peer / 5) * 100}%` }} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {t({ en: "Peer", ar: "الأقران", tr: "Akran" })}: {fmtScore(peer)} ·{" "}
                      <span className={delta >= 0 ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
                        {delta >= 0 ? "+" : ""}{fmtScore(delta)} {t({ en: "vs peers", ar: "مقابل الأقران", tr: "akranlara karşı" })}
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* UVR portfolio */}
        {def.slug === "uvr" && result.useCases && result.useCases.length > 0 && (
          <section className="mt-8 bg-white rounded-3xl shadow-lg border border-gray-100 p-8 sm:p-12">
            <h2 className="text-2xl font-extrabold text-[#0A1230] mb-2">
              {t({ en: "Use case portfolio (Value × Readiness)", ar: "محفظة حالات الاستخدام (القيمة × الجاهزية)", tr: "Kullanım senaryosu portföyü (Değer × Hazırlık)" })}
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {t({ en: "Bubble size = effort. Quadrants tell you where to push and where to walk away.", ar: "حجم الفقاعة = الجهد. الأرباع توضح أين تتقدم وأين تنسحب.", tr: "Baloncuk boyutu = çaba. Çeyrekler size nereye yükleneceğinizi ve nereden vazgeçeceğinizi söyler." })}
            </p>
            <UvrPortfolio useCases={result.useCases} color={def.brandColor} />
            <div className="mt-6 grid sm:grid-cols-2 gap-3">
              {result.useCases.map((uc, i) => (
                <div key={uc.id} className="border rounded-xl p-3 flex items-start gap-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0A1230] text-white text-sm font-bold flex items-center justify-center">{i + 1}</span>
                  <div>
                    <p className="font-semibold text-[#0A1230]">{uc.name || `${t({ en: "Use case", ar: "حالة استخدام", tr: "Kullanım senaryosu" })} ${i + 1}`}</p>
                    <p className="text-xs text-gray-500">
                      {uc.quadrant} · V {fmtScore(uc.valueScore)} · R {fmtScore(uc.readinessScore)} · E {fmtScore(uc.effort)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Strengths / Gaps */}
        <section className="mt-8 grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-8">
            <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-700 mb-3">
              {t(ui.results.leading)}
            </h3>
            {result.strengths.length === 0 ? (
              <p className="text-sm text-gray-500">{t({ en: "Nothing flagged as a clear strength.", ar: "لا توجد نقاط قوة بارزة.", tr: "Net bir güç olarak işaretlenmiş bir şey yok." })}</p>
            ) : (
              <ul className="space-y-2">
                {result.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700"><BadgeCheck className="text-emerald-600 flex-shrink-0 mt-0.5" size={18} />{s}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-8">
            <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">
              {t(ui.results.lagging)}
            </h3>
            {result.gaps.length === 0 ? (
              <p className="text-sm text-gray-500">{t({ en: "No critical gaps detected.", ar: "لم نكتشف ثغرات حرجة.", tr: "Kritik boşluk tespit edilmedi." })}</p>
            ) : (
              <ul className="space-y-2">
                {result.gaps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700"><AlertCircle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />{s}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Anti-patterns */}
        {result.antiPatterns.length > 0 && (
          <section className="mt-8 bg-white rounded-3xl shadow-lg border border-gray-100 p-8 sm:p-12">
            <h2 className="text-2xl font-extrabold text-[#0A1230] mb-2">
              {t(ui.results.antiPatternsTitle)}
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {t({ en: "Patterns we've seen kill engagements across the GCC. We name them, then tell you what to do.", ar: "أنماط رأيناها تقتل المشاريع في الخليج. نسميها ونخبرك ماذا تفعل.", tr: "Körfez genelinde çalışmaları öldürdüğünü gördüğümüz örüntüler. Önce isimlendiriyoruz, sonra ne yapacağınızı söylüyoruz." })}
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              {result.antiPatterns.map((ap, i) => (
                <div key={i} className="border-2 border-red-100 bg-red-50/40 rounded-2xl p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-red-700 mb-2">⚠ {t({ en: "Anti-pattern", ar: "نمط مضاد", tr: "Anti-örüntü" })}</p>
                  <h3 className="text-lg font-bold text-[#0A1230] mb-2">{t(ap.label)}</h3>
                  <p className="text-sm text-gray-600 mb-3">{t(ap.description)}</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 mt-3">{t({ en: "What to do", ar: "ماذا تفعل", tr: "Ne yapmalı" })}</p>
                  <p className="text-sm text-gray-800 leading-relaxed">{t(ap.fix)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Cost of inaction */}
        <section className="mt-8 bg-gradient-to-br from-[#0A1230] to-[#5B7CFF] rounded-3xl text-white p-8 sm:p-12">
          <p className="text-xs font-bold uppercase tracking-widest text-[#C45BB8] mb-2">
            {t(ui.results.costOfInactionTitle)}
          </p>
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-6">
            {t({ en: "What standing still costs you in the next 12 months", ar: "ما تكلفه التقاعس عليكم خلال 12 شهراً", tr: "Yerinde durmanın size önümüzdeki 12 ay içinde maliyeti" })}
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <CoIBlock label={t({ en: "EBIT lift forfeited", ar: "أرباح ضائعة", tr: "Vazgeçilen FAVÖK artışı" })} value={`$${fmtScore(result.costOfInaction.ebitDeltaUsd / 1_000_000)}M`} accent="#5B7CFF" />
            <CoIBlock label={t({ en: "Avoidable cost", ar: "كلفة قابلة للتجنب", tr: "Önlenebilir maliyet" })} value={`$${fmtScore(result.costOfInaction.costDeltaUsd / 1_000_000)}M`} accent="#C45BB8" />
            <CoIBlock label={t({ en: "Productivity recovered", ar: "إنتاجية مسترجعة", tr: "Geri kazanılan üretkenlik" })} value={`${fmtScore(productivityFte)} FTE`} accent="#FFFFFF" />
          </div>
          <p className="text-xs text-gray-300 mt-4 italic">
            {t({ en: "Conservative; calibrated to your tier and revenue band.", ar: "تقدير متحفظ؛ معاير لمستواك ونطاق إيراداتك.", tr: "Muhafazakâr; kademenize ve gelir bandınıza göre ayarlanmıştır." })}
          </p>
        </section>

        {/* Plans */}
        <section className="mt-8 bg-white rounded-3xl shadow-lg border border-gray-100 p-8 sm:p-12">
          <h2 className="text-2xl font-extrabold text-[#0A1230] mb-6">
            {t(ui.results.recommendationsTitle)}
          </h2>
          <div className="grid lg:grid-cols-3 gap-6">
            <RecCol title={t({ en: "Quick wins (90 days)", ar: "مكاسب سريعة (90 يوماً)", tr: "Hızlı kazanımlar (90 gün)" })} items={result.recommendations.quickWins90d.map((r) => t(r))} accent="#5B7CFF" />
            <RecCol title={t({ en: "Strategic moves (6–12 months)", ar: "تحركات استراتيجية (6–12 شهر)", tr: "Stratejik hamleler (6–12 ay)" })} items={result.recommendations.strategic12m.map((r) => t(r))} accent="#5B7CFF" />
            <RecCol title={t({ en: "6-month roadmap", ar: "خارطة طريق 6 أشهر", tr: "6 aylık yol haritası" })} items={sovereignSpecific.map((r) => t(r))} accent="#8A5BD6" />
          </div>
        </section>

        {/* Anti-vendor honesty */}
        <section className="mt-8 bg-amber-50 border-2 border-amber-200 rounded-3xl p-8 sm:p-12">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">
            {t(ui.results.antiVendor)}
          </p>
          <p className="text-lg sm:text-xl text-amber-900 leading-relaxed">
            "{antiVendorMessage}"
          </p>
          <p className="text-xs text-amber-700 mt-4 font-semibold">— {t({ en: "The Cognirise partnership", ar: "شراكة Cognirise", tr: "Cognirise ortaklığı" })}</p>
        </section>

        {/* Team */}
        <section className="mt-8 bg-white rounded-3xl shadow-lg border border-gray-100 p-8 sm:p-12">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#5B7CFF] mb-2">
                {t(ui.results.alignmentMode)}
              </p>
              <h2 className="text-2xl font-extrabold text-[#0A1230] mb-2">
                {t({ en: "Run this assessment with your full leadership team", ar: "شغّل هذا التقييم مع فريق القيادة كاملاً", tr: "Bu değerlendirmeyi tüm liderlik ekibinizle birlikte yürütün" })}
              </h2>
              <p className="text-gray-600 max-w-2xl">
                {t({
                  en: "Generate a private link, send it to up to 10 stakeholders, and unlock a stakeholder alignment heatmap that shows exactly where your leadership team disagrees.",
                  ar: "أنشئ رابطاً خاصاً، أرسله لـ 10 أصحاب مصلحة، وافتح خريطة المواءمة التي توضح أين يختلف فريق قيادتك.",
                  tr: "Özel bir bağlantı oluşturun, 10 paydaşa kadar gönderin ve liderlik ekibinizin tam olarak nerede ayrıştığını gösteren bir paydaş hizalama ısı haritasını açın.",
                })}
              </p>
            </div>
            <button
              onClick={handleTeam}
              className="inline-flex items-center gap-2 bg-[#5B7CFF] hover:bg-[#3A5BCC] text-white font-bold px-5 py-3 rounded-xl"
              data-testid="button-create-team-link"
            >
              <Users size={16} /> {t({ en: "Create team link", ar: "أنشئ رابط الفريق", tr: "Ekip bağlantısı oluştur" })}
            </button>
          </div>
          {showTeam && teamLink && (
            <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                {t({ en: "Share this link with your team", ar: "شارك هذا الرابط مع فريقك", tr: "Bu bağlantıyı ekibinizle paylaşın" })}
              </p>
              <div className="flex items-center gap-2">
                <input readOnly value={teamLink} className="flex-1 bg-white border rounded-lg px-3 py-2 text-sm" />
                <button
                  onClick={() => navigator.clipboard.writeText(teamLink)}
                  className="bg-[#0A1230] text-white px-4 py-2 rounded-lg text-sm font-semibold"
                >
                  {t({ en: "Copy", ar: "نسخ", tr: "Kopyala" })}
                </button>
              </div>
              {heatmap && !heatmap.ready && (
                <p className="mt-3 text-sm text-gray-500 inline-flex items-center gap-2">
                  <Lock size={14} /> {t({ en: "Heatmap unlocks after", ar: "تفتح الخريطة بعد", tr: "Isı haritası şundan sonra açılır:" })} {heatmap.needed} {t({ en: "responses (currently", ar: "ردود (حالياً", tr: "yanıt (şu an" })} {heatmap.count}{")"}
                </p>
              )}
              {heatmap && heatmap.ready && heatmap.dimensions && heatmap.respondents && heatmap.variance && (
                <div className="mt-6">
                  <h4 className="text-lg font-bold text-[#0A1230] mb-3">{t({ en: "Stakeholder alignment", ar: "مواءمة أصحاب المصلحة", tr: "Paydaş hizalaması" })}</h4>
                  <Heatmap dimensions={heatmap.dimensions} respondents={heatmap.respondents} variance={heatmap.variance} lang={assessmentLang} />
                </div>
              )}
            </div>
          )}
        </section>

        {/* Founders strip */}
        <section className="mt-8 bg-[#0A1230] text-white rounded-3xl p-8 sm:p-12">
          <p className="text-xs font-bold uppercase tracking-widest text-[#5B7CFF] mb-2">{t({ en: "Signed by the partnership", ar: "موقعة من الشركاء", tr: "Ortaklık tarafından imzalandı" })}</p>
          <h2 className="text-2xl font-extrabold mb-6">{t({ en: "The founders behind this report", ar: "المؤسسون وراء هذا التقرير", tr: "Bu raporun arkasındaki kurucular" })}</h2>
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {[
              { name: "Mounir Aris", title: { en: "Strategy", ar: "الاستراتيجية", tr: "Strateji" }, img: "/images/founder-mounir.png" },
              { name: "Gokhan Guney", title: { en: "Engineering", ar: "الهندسة", tr: "Mühendislik" }, img: "/images/founder-gokhan.png" },
            ].map((f) => (
              <div key={f.name} className="bg-white/5 rounded-2xl p-4 text-center">
                <img src={f.img} alt={f.name} className="w-20 h-20 rounded-full object-cover mx-auto mb-2" />
                <p className="font-bold text-sm">{f.name}</p>
                <p className="text-xs text-gray-400">{t(f.title)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Certificate */}
        <section className="mt-8 bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-3xl p-8 sm:p-12 text-center">
          <ShieldCheck className="mx-auto text-[#8A5BD6]" size={36} />
          <p className="text-xs font-bold uppercase tracking-widest text-[#8A5BD6] mt-3">
            {t({ en: "Verified diagnostic", ar: "تشخيص موثّق", tr: "Doğrulanmış teşhis" })}
          </p>
          <p className="text-lg text-[#0A1230] mt-2">
            {t({ en: "Reference", ar: "المرجع", tr: "Referans" })}: <span className="font-mono">{data.publicId}</span>
          </p>
          <p className="text-sm text-gray-600 mt-1">{t({ en: "Issued by Cognirise · Boutique MENAT AI advisory & engineering", ar: "صادر عن Cognirise · استشارات وهندسة AI لمنطقة الشرق الأوسط وشمال أفريقيا وتركيا", tr: "Cognirise tarafından düzenlendi · Butik MENAT AI danışmanlık ve mühendislik" })}</p>
        </section>

        {/* Reinvention CTA (for ARI/MVI/DAFI) */}
        {(def.slug === "ari" || def.slug === "mvi" || def.slug === "dafi") && (
          <section className="mt-8 bg-white border-2 border-dashed border-[#5B7CFF] rounded-3xl p-8 sm:p-12">
            <p className="text-xs font-bold uppercase tracking-widest text-[#5B7CFF] mb-2">
              {t({ en: "Reinvention Index", ar: "مؤشر إعادة الابتكار", tr: "Yeniden Keşif Endeksi" })}
            </p>
            <h2 className="text-2xl font-extrabold text-[#0A1230] mb-3">
              {t({ en: "Complete the other two assessments to unlock your composite Reinvention Index", ar: "أكمل التقييمين الآخرين لفتح مؤشر إعادة الابتكار", tr: "Bileşik Yeniden Keşif Endeksinizi açmak için diğer iki değerlendirmeyi tamamlayın" })}
            </h2>
            <div className="flex flex-wrap gap-3 mt-4">
              {(["ari", "mvi", "dafi"] as AssessmentSlug[])
                .filter((s) => s !== def.slug)
                .map((s) => {
                  const other = getAssessment(s);
                  return (
                    <Link key={s} href={`/assessments/${s}`} className="inline-flex items-center gap-2 bg-[#5B7CFF] hover:bg-[#3A5BCC] text-white font-semibold px-5 py-3 rounded-xl">
                      {other.code}: {tStr(other.title, lang)} <ArrowRight size={14} className="rtl:-scale-x-100" />
                    </Link>
                  );
                })}
            </div>
          </section>
        )}
      </div>

      {/* Booking modal */}
      {showBooking && (
        <BookingModal
          onClose={() => setShowBooking(false)}
          done={bookingDone}
          submissionId={data.publicId}
          defaultName={data.profile.name}
          defaultEmail={data.profile.email}
          defaultCompany={data.profile.company}
          lang={assessmentLang}
          onDone={() => setBookingDone(true)}
        />
      )}
    </div>
  );
}

function CoIBlock({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-gray-300 font-semibold mb-1">{label}</p>
      <p className="text-3xl sm:text-4xl font-extrabold" style={{ color: accent }}>{value}</p>
    </div>
  );
}

function RecCol({ title, items, accent }: { title: string; items: string[]; accent: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest font-bold mb-3" style={{ color: accent }}>{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">—</p>
      ) : (
        <ol className="space-y-3">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
              <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center" style={{ backgroundColor: accent }}>{i + 1}</span>
              {it}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function BookingModal({
  onClose,
  done,
  submissionId,
  defaultName,
  defaultEmail,
  defaultCompany,
  lang,
  onDone,
}: {
  onClose: () => void;
  done: boolean;
  submissionId: string;
  defaultName: string;
  defaultEmail: string;
  defaultCompany: string;
  lang: import("@/lib/lang").Lang;
  onDone: () => void;
}) {
  const t = (s: T) => tStr(s, lang);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [company, setCompany] = useState(defaultCompany);
  const [preferredTime, setPreferredTime] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await bookCall({
        submissionPublicId: submissionId,
        name,
        email,
        company,
        preferredTime,
        message,
        language: lang,
      });
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl max-w-lg w-full p-7">
        {done ? (
          <div className="text-center py-6">
            <BadgeCheck className="mx-auto text-emerald-600" size={48} />
            <h3 className="text-2xl font-bold text-[#0A1230] mt-4">{t({ en: "Got it.", ar: "تم.", tr: "Anlaşıldı." })}</h3>
            <p className="text-gray-600 mt-2">{t({ en: "One of the founders will reach out within 24 hours.", ar: "سيتواصل أحد المؤسسين خلال 24 ساعة.", tr: "Kuruculardan biri 24 saat içinde sizinle iletişime geçecek." })}</p>
            <button onClick={onClose} className="mt-6 bg-[#0A1230] text-white font-semibold px-5 py-2.5 rounded-lg">
              {t({ en: "Close", ar: "إغلاق", tr: "Kapat" })}
            </button>
          </div>
        ) : (
          <>
            <h3 className="text-2xl font-extrabold text-[#0A1230] mb-1">{t({ en: "Book a 30-min readout", ar: "احجز جلسة 30 دقيقة", tr: "30 dakikalık bir okuma seansı ayırtın" })}</h3>
            <p className="text-sm text-gray-500 mb-5">{t({ en: "A founder will walk you through your report. No sales pitch.", ar: "سيشرح أحد المؤسسين تقريركم. بدون عروض بيع.", tr: "Bir kurucu raporunuzu size baştan sona anlatacak. Satış konuşması yok." })}</p>
            <div className="space-y-3">
              <input className="w-full border rounded-lg px-3 py-2.5" value={name} onChange={(e) => setName(e.target.value)} placeholder={t({ en: "Name", ar: "الاسم", tr: "Ad" })} />
              <input className="w-full border rounded-lg px-3 py-2.5" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t({ en: "Email", ar: "البريد", tr: "E-posta" })} />
              <input className="w-full border rounded-lg px-3 py-2.5" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t({ en: "Company", ar: "الشركة", tr: "Şirket" })} />
              <input className="w-full border rounded-lg px-3 py-2.5" value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} placeholder={t({ en: "Preferred time (e.g. next Tue 10am Riyadh)", ar: "الوقت المفضّل", tr: "Tercih edilen zaman (örn. gelecek Salı 10:00 Riyad)" })} />
              <textarea className="w-full border rounded-lg px-3 py-2.5 h-24" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t({ en: "Anything specific you want covered?", ar: "هل ثمة شيء محدد؟", tr: "Ele alınmasını istediğiniz belirli bir şey var mı?" })} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-gray-600 font-semibold">{t({ en: "Cancel", ar: "إلغاء", tr: "İptal" })}</button>
              <button onClick={submit} disabled={submitting} className="bg-[#C45BB8] hover:bg-[#A04A99] text-white font-bold px-5 py-2.5 rounded-lg inline-flex items-center gap-2">
                {submitting && <Loader2 className="animate-spin" size={14} />}
                {t({ en: "Request the call", ar: "اطلب المكالمة", tr: "Aramayı talep et" })}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
