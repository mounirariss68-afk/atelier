import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Download, FileText, ArrowLeft, Package } from "lucide-react";

interface DemoDoc {
  filename: string;
  titleEn: string;
  titleAr: string;
  client: string;
  type: string;
  isNew?: boolean;
}

const DOCS: DemoDoc[] = [
  { filename: "payslip-april-2026-ahmed-alrashidi.pdf", titleEn: "April 2026 Payslip — Ahmed Al-Rashidi", titleAr: "كشف راتب أبريل 2026 — أحمد الرشيدي", client: "Al-Nakhla Construction Co.", type: "Payslip", isNew: true },
  { filename: "offer-letter-vertex-senior-engineer.pdf", titleEn: "Offer Letter — Senior Backend Engineer", titleAr: "عرض توظيف — مهندس برمجيات أول", client: "Vertex Tech Solutions", type: "Offer Letter", isNew: true },
  { filename: "leave-request-aisha-alharbi-maternity.pdf", titleEn: "Maternity Leave Request — Aisha Al-Harbi", titleAr: "طلب إجازة أمومة — عائشة الحربي", client: "Al-Nakhla Construction Co.", type: "Leave Request", isNew: true },
  { filename: "promotion-ahmed-alrashidi.pdf", titleEn: "Promotion Letter — Ahmed Al-Rashidi", titleAr: "خطاب ترقية — أحمد الرشيدي", client: "Al-Nakhla Construction Co.", type: "Promotion" },
  { filename: "salary-cert-ahmed-alrashidi.pdf", titleEn: "Salary Certificate — Ahmed Al-Rashidi", titleAr: "شهادة راتب — أحمد الرشيدي", client: "Al-Nakhla Construction Co.", type: "Salary Cert" },
  { filename: "termination-mohammad-alghamdi.pdf", titleEn: "Termination Letter — Mohammad Al-Ghamdi", titleAr: "خطاب إنهاء خدمة — محمد الغامدي", client: "Al-Nakhla Construction Co.", type: "Termination" },
  { filename: "experience-letter-mohammad-alghamdi.pdf", titleEn: "Experience Letter — Mohammad Al-Ghamdi", titleAr: "شهادة خبرة — محمد الغامدي", client: "Al-Nakhla Construction Co.", type: "Experience" },
  { filename: "final-settlement-mohammad-alghamdi.pdf", titleEn: "Final Settlement — Mohammad Al-Ghamdi", titleAr: "التسوية النهائية — محمد الغامدي", client: "Al-Nakhla Construction Co.", type: "EOSB" },
  { filename: "maternity-aisha-alharbi.pdf", titleEn: "Maternity Letter — Aisha Al-Harbi", titleAr: "خطاب أمومة — عائشة الحربي", client: "Al-Nakhla Construction Co.", type: "Maternity" },
  { filename: "contract-renewal-rajesh-kumar.pdf", titleEn: "Contract Renewal — Rajesh Kumar", titleAr: "تجديد عقد — راجيش كومار", client: "Al-Nakhla Construction Co.", type: "Renewal" },
  { filename: "employment-contract-khalid-alotaibi.pdf", titleEn: "Employment Contract — Khalid Al-Otaibi", titleAr: "عقد عمل — خالد العتيبي", client: "Luma Retail Group", type: "Contract" },
  { filename: "gosi-registration-khalid-alotaibi.pdf", titleEn: "GOSI Registration — Khalid Al-Otaibi", titleAr: "تسجيل التأمينات — خالد العتيبي", client: "Luma Retail Group", type: "GOSI" },
  { filename: "salary-increase-noura-alsalem.pdf", titleEn: "Salary Increase — Noura Al-Salem", titleAr: "زيادة راتب — نورة السالم", client: "Vertex Tech Solutions", type: "Salary Increase" },
  { filename: "bonus-sarah-johnson.pdf", titleEn: "Q1 Performance Bonus — Sarah Johnson", titleAr: "مكافأة أداء الربع الأول — سارة جونسون", client: "Vertex Tech Solutions", type: "Bonus" },
  { filename: "performance-review-fatima-alzahrani.pdf", titleEn: "Performance Review — Fatima Al-Zahrani", titleAr: "تقييم أداء — فاطمة الزهراني", client: "Vertex Tech Solutions", type: "Review" },
];

const KIT_BASE = "demo-kit/tasama";

export default function DemoKitTasama() {
  const [zipping, setZipping] = useState(false);
  const baseUrl = import.meta.env.BASE_URL;

  useEffect(() => {
    const prev = document.title;
    document.title = "Tasama Demo Kit — Sample HR Documents";
    return () => { document.title = prev; };
  }, []);
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
      alert(`Download failed: ${(err as Error).message}`);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <Link href="/marketplace/tasama-payroll-hub" className="inline-flex items-center gap-1.5 text-sm text-[#1E3A8A] hover:text-[#2563EB] mb-6">
          <ArrowLeft size={14} /> Back to Tasama Payroll Hub
        </Link>

        <header className="bg-gradient-to-br from-[#1E3A8A] to-[#2563EB] text-white rounded-2xl p-8 shadow-lg mb-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-sm">
                <img src={`${baseUrl}tasama-logo-transparent.png`} alt="Tasama" className="w-10 h-10 object-contain" />
              </div>
              <div>
                <p className="text-xs font-bold tracking-widest text-blue-100 uppercase">Tasama · Demo Kit</p>
                <h1 className="text-2xl sm:text-3xl font-bold mt-1">Sample HR &amp; Payroll Documents</h1>
                <p className="text-sm text-blue-100 mt-2 max-w-2xl">
                  15 sample Saudi-payroll PDFs — payslips, offer letters, leave requests, contracts, EOSB statements,
                  GOSI registrations, and more — that mirror the real documents the Tasama Payroll Hub agents process.
                </p>
              </div>
            </div>
            <button
              onClick={downloadZip}
              disabled={zipping}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-[#1E3A8A] font-bold text-sm hover:bg-blue-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
            >
              <Package size={16} />
              {zipping ? "Preparing zip…" : "Download all (.zip)"}
            </button>
          </div>
        </header>

        <div className="space-y-8">
          {Object.entries(groupedByClient).map(([client, docs]) => (
            <section key={client}>
              <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-5 bg-[#2563EB] rounded-full" />
                {client}
                <span className="text-xs font-normal text-slate-400">({docs.length} documents)</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {docs.map((d) => (
                  <a
                    key={d.filename}
                    href={docHref(d.filename)}
                    target="_blank"
                    rel="noreferrer"
                    className="group bg-white border border-slate-200 hover:border-[#2563EB] rounded-xl p-4 flex items-start gap-3 shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="w-10 h-10 rounded-lg bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <FileText size={18} className="text-[#1E3A8A]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold uppercase tracking-wide text-[#2563EB]">{d.type}</p>
                        {d.isNew && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">New</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{d.titleEn}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate" dir="rtl">{d.titleAr}</p>
                    </div>
                    <Download size={16} className="text-slate-300 group-hover:text-[#2563EB] flex-shrink-0 mt-1" />
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="text-xs text-slate-400 text-center mt-10">
          All documents are synthetic samples generated for demonstration purposes. No real employee data is included.
        </p>
      </div>
    </div>
  );
}
