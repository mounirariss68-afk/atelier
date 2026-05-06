import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Download, FileText, ArrowLeft, Package } from "lucide-react";
import { useLang, tStr, type T } from "@/lib/lang";

const COPY = {
  back: { en: "Back to Tasama Payroll Hub", ar: "العودة إلى مركز رواتب تسامي", tr: "Tasama Payroll Hub'a dön" },
  eyebrow: { en: "Demo Kit", ar: "حزمة عرض", tr: "Demo Kiti" },
  title: { en: "Sample HR & Payroll Documents", ar: "وثائق نموذجية للموارد البشرية والرواتب", tr: "Örnek İK ve Bordro Belgeleri" },
  intro: { en: "15 sample Saudi-payroll PDFs — payslips, offer letters, leave requests, contracts, EOSB statements, GOSI registrations, and more — that mirror the real documents the Tasama Payroll Hub agents process.", ar: "15 ملف PDF نموذجي للرواتب السعودية — كشوف رواتب، عروض عمل، طلبات إجازة، عقود، كشوف نهاية الخدمة، تسجيلات التأمينات، وغيرها — تحاكي الوثائق الفعلية التي تعالجها وكلاء مركز رواتب تسامي.", tr: "15 örnek Suudi bordro PDF'i — bordrolar, teklif mektupları, izin talepleri, sözleşmeler, EOSB beyannameleri, GOSI kayıtları ve daha fazlası — Tasama Payroll Hub ajanlarının işlediği gerçek belgeleri yansıtır." },
  zipping: { en: "Preparing zip…", ar: "جاري تحضير الملف المضغوط…", tr: "Zip hazırlanıyor…" },
  download: { en: "Download all (.zip)", ar: "تنزيل الكل (.zip)", tr: "Tümünü indir (.zip)" },
  documents: { en: "documents", ar: "وثيقة", tr: "belge" },
  footer: { en: "All documents are synthetic samples generated for demonstration purposes. No real employee data is included.", ar: "جميع الوثائق عيّنات اصطناعية تم إنشاؤها لأغراض العرض. لا تتضمن أي بيانات موظفين حقيقية.", tr: "Tüm belgeler gösterim amacıyla üretilmiş sentetik örneklerdir. Hiçbir gerçek çalışan verisi içermez." },
  pageTitle: { en: "Tasama Demo Kit — Sample HR Documents", ar: "حزمة عرض تسامي — وثائق موارد بشرية نموذجية", tr: "Tasama Demo Kiti — Örnek İK Belgeleri" },
  logoAlt: { en: "Tasama · Business Services", ar: "تسامي لخدمات الأعمال", tr: "Tasama · İş Hizmetleri" },
  newBadge: { en: "New", ar: "جديد", tr: "Yeni" },
  downloadFailed: { en: "Download failed", ar: "فشل التنزيل", tr: "İndirme başarısız" },
};

const TYPE_LABEL: Record<string, T> = {
  Payslip: { en: "Payslip", ar: "كشف راتب", tr: "Bordro" },
  "Offer Letter": { en: "Offer Letter", ar: "عرض توظيف", tr: "Teklif Mektubu" },
  "Leave Request": { en: "Leave Request", ar: "طلب إجازة", tr: "İzin Talebi" },
  Promotion: { en: "Promotion", ar: "ترقية", tr: "Terfi" },
  "Salary Cert": { en: "Salary Cert", ar: "شهادة راتب", tr: "Maaş Belgesi" },
  Termination: { en: "Termination", ar: "إنهاء خدمة", tr: "Fesih" },
  Experience: { en: "Experience", ar: "شهادة خبرة", tr: "Deneyim Belgesi" },
  EOSB: { en: "EOSB", ar: "نهاية الخدمة", tr: "Hizmet Sonu Tazminatı" },
  Maternity: { en: "Maternity", ar: "أمومة", tr: "Doğum İzni" },
  Renewal: { en: "Renewal", ar: "تجديد عقد", tr: "Sözleşme Yenileme" },
  Contract: { en: "Contract", ar: "عقد عمل", tr: "İş Sözleşmesi" },
  GOSI: { en: "GOSI", ar: "تسجيل التأمينات", tr: "GOSI Kaydı" },
  "Salary Increase": { en: "Salary Increase", ar: "زيادة راتب", tr: "Maaş Artışı" },
  Bonus: { en: "Bonus", ar: "مكافأة", tr: "Prim" },
  Review: { en: "Review", ar: "تقييم أداء", tr: "Performans Değerlendirmesi" },
};

interface DemoDoc {
  filename: string;
  title: T;
  client: string;
  type: string;
  isNew?: boolean;
}

const DOCS: DemoDoc[] = [
  { filename: "payslip-april-2026-ahmed-alrashidi.pdf", title: { en: "April 2026 Payslip — Ahmed Al-Rashidi", ar: "كشف راتب أبريل 2026 — أحمد الرشيدي", tr: "Nisan 2026 Bordrosu — Ahmed Al-Rashidi" }, client: "Al-Nakhla Construction Co.", type: "Payslip", isNew: true },
  { filename: "offer-letter-vertex-senior-engineer.pdf", title: { en: "Offer Letter — Senior Backend Engineer", ar: "عرض توظيف — مهندس برمجيات أول", tr: "Teklif Mektubu — Kıdemli Backend Mühendisi" }, client: "Vertex Tech Solutions", type: "Offer Letter", isNew: true },
  { filename: "leave-request-aisha-alharbi-maternity.pdf", title: { en: "Maternity Leave Request — Aisha Al-Harbi", ar: "طلب إجازة أمومة — عائشة الحربي", tr: "Doğum İzni Talebi — Aisha Al-Harbi" }, client: "Al-Nakhla Construction Co.", type: "Leave Request", isNew: true },
  { filename: "promotion-ahmed-alrashidi.pdf", title: { en: "Promotion Letter — Ahmed Al-Rashidi", ar: "خطاب ترقية — أحمد الرشيدي", tr: "Terfi Mektubu — Ahmed Al-Rashidi" }, client: "Al-Nakhla Construction Co.", type: "Promotion" },
  { filename: "salary-cert-ahmed-alrashidi.pdf", title: { en: "Salary Certificate — Ahmed Al-Rashidi", ar: "شهادة راتب — أحمد الرشيدي", tr: "Maaş Belgesi — Ahmed Al-Rashidi" }, client: "Al-Nakhla Construction Co.", type: "Salary Cert" },
  { filename: "termination-mohammad-alghamdi.pdf", title: { en: "Termination Letter — Mohammad Al-Ghamdi", ar: "خطاب إنهاء خدمة — محمد الغامدي", tr: "Fesih Mektubu — Mohammad Al-Ghamdi" }, client: "Al-Nakhla Construction Co.", type: "Termination" },
  { filename: "experience-letter-mohammad-alghamdi.pdf", title: { en: "Experience Letter — Mohammad Al-Ghamdi", ar: "شهادة خبرة — محمد الغامدي", tr: "Deneyim Belgesi — Mohammad Al-Ghamdi" }, client: "Al-Nakhla Construction Co.", type: "Experience" },
  { filename: "final-settlement-mohammad-alghamdi.pdf", title: { en: "Final Settlement — Mohammad Al-Ghamdi", ar: "التسوية النهائية — محمد الغامدي", tr: "Nihai Hesaplaşma — Mohammad Al-Ghamdi" }, client: "Al-Nakhla Construction Co.", type: "EOSB" },
  { filename: "maternity-aisha-alharbi.pdf", title: { en: "Maternity Letter — Aisha Al-Harbi", ar: "خطاب أمومة — عائشة الحربي", tr: "Doğum İzni Mektubu — Aisha Al-Harbi" }, client: "Al-Nakhla Construction Co.", type: "Maternity" },
  { filename: "contract-renewal-rajesh-kumar.pdf", title: { en: "Contract Renewal — Rajesh Kumar", ar: "تجديد عقد — راجيش كومار", tr: "Sözleşme Yenileme — Rajesh Kumar" }, client: "Al-Nakhla Construction Co.", type: "Renewal" },
  { filename: "employment-contract-khalid-alotaibi.pdf", title: { en: "Employment Contract — Khalid Al-Otaibi", ar: "عقد عمل — خالد العتيبي", tr: "İş Sözleşmesi — Khalid Al-Otaibi" }, client: "Luma Retail Group", type: "Contract" },
  { filename: "gosi-registration-khalid-alotaibi.pdf", title: { en: "GOSI Registration — Khalid Al-Otaibi", ar: "تسجيل التأمينات — خالد العتيبي", tr: "GOSI Kaydı — Khalid Al-Otaibi" }, client: "Luma Retail Group", type: "GOSI" },
  { filename: "salary-increase-noura-alsalem.pdf", title: { en: "Salary Increase — Noura Al-Salem", ar: "زيادة راتب — نورة السالم", tr: "Maaş Artışı — Noura Al-Salem" }, client: "Vertex Tech Solutions", type: "Salary Increase" },
  { filename: "bonus-sarah-johnson.pdf", title: { en: "Q1 Performance Bonus — Sarah Johnson", ar: "مكافأة أداء الربع الأول — سارة جونسون", tr: "1. Çeyrek Performans Primi — Sarah Johnson" }, client: "Vertex Tech Solutions", type: "Bonus" },
  { filename: "performance-review-fatima-alzahrani.pdf", title: { en: "Performance Review — Fatima Al-Zahrani", ar: "تقييم أداء — فاطمة الزهراني", tr: "Performans Değerlendirmesi — Fatima Al-Zahrani" }, client: "Vertex Tech Solutions", type: "Review" },
];

const KIT_BASE = "demo-kit/tasama";

export default function DemoKitTasama() {
  const { lang, dir } = useLang();
  const [zipping, setZipping] = useState(false);
  const baseUrl = import.meta.env.BASE_URL;

  useEffect(() => {
    const prev = document.title;
    document.title = tStr(COPY.pageTitle, lang);
    return () => { document.title = prev; };
  }, [lang]);
  const docHref = (filename: string) => `${baseUrl}${KIT_BASE}/${filename}`;

  const groupedByClient = useMemo(() => {
    const out: Record<string, DemoDoc[]> = {};
    for (const d of DOCS) {
      if (!out[d.client]) out[d.client] = [];
      out[d.client]!.push(d);
    }
    return out;
  }, []);

  const downloadZip = async () => {
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder("tasama-demo-kit")!;
      const fetched = await Promise.all(
        DOCS.map(async (d) => {
          const res = await fetch(docHref(d.filename));
          if (!res.ok) throw new Error(`Failed to fetch ${d.filename}: ${res.status}`);
          return { name: d.filename, blob: await res.blob() };
        }),
      );
      for (const f of fetched) folder.file(f.name, f.blob);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tasama-demo-kit.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[demo-kit] zip download failed:", err);
      alert(`${tStr(COPY.downloadFailed, lang)}: ${(err as Error).message}`);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/40" dir={dir}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/marketplace/tasama-payroll-hub" className="inline-flex items-center gap-1.5 text-sm text-[#0F0698] hover:text-[#3B30E0] mb-6">
          <ArrowLeft size={14} className="rtl:-scale-x-100" /> {tStr(COPY.back, lang)}
        </Link>

        <header className="bg-gradient-to-br from-[#0F0698] to-[#3B30E0] text-white rounded-2xl p-8 shadow-lg mb-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex items-start gap-4">
              <img
                src={`${baseUrl}tasama-logo-light.png`}
                alt={tStr(COPY.logoAlt, lang)}
                className="h-12 w-auto object-contain flex-shrink-0"
              />
              <div>
                <p className="text-xs font-bold tracking-widest text-blue-100 uppercase">{tStr(COPY.eyebrow, lang)}</p>
                <h1 className="text-2xl sm:text-3xl font-bold mt-1">{tStr(COPY.title, lang)}</h1>
                <p className="text-sm text-blue-100 mt-2 max-w-2xl">
                  {tStr(COPY.intro, lang)}
                </p>
              </div>
            </div>
            <button
              onClick={downloadZip}
              disabled={zipping}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-[#0F0698] font-bold text-sm hover:bg-blue-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
            >
              <Package size={16} />
              {zipping ? tStr(COPY.zipping, lang) : tStr(COPY.download, lang)}
            </button>
          </div>
        </header>

        <div className="space-y-8">
          {Object.entries(groupedByClient).map(([client, docs]) => (
            <section key={client}>
              <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-5 bg-[#3B30E0] rounded-full" />
                {client}
                <span className="text-xs font-normal text-slate-400">({docs.length} {tStr(COPY.documents, lang)})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {docs.map((d) => {
                  const typeLabel = TYPE_LABEL[d.type] ?? { en: d.type };
                  return (
                  <a
                    key={d.filename}
                    href={docHref(d.filename)}
                    target="_blank"
                    rel="noreferrer"
                    className="group bg-white border border-slate-200 hover:border-[#3B30E0] rounded-xl p-4 flex items-start gap-3 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="w-10 h-10 rounded-lg bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <FileText size={18} className="text-[#0F0698]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold uppercase tracking-wide text-[#3B30E0]">{tStr(typeLabel, lang)}</p>
                        {d.isNew && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{tStr(COPY.newBadge, lang)}</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{tStr(d.title, lang)}</p>
                    </div>
                    <Download size={16} className="text-slate-300 group-hover:text-[#3B30E0] flex-shrink-0 mt-1" />
                  </a>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <p className="text-xs text-slate-400 text-center mt-10">
          {tStr(COPY.footer, lang)}
        </p>
      </div>
    </div>
  );
}
