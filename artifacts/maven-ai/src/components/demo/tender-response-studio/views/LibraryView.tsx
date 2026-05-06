import { useMemo, useState } from "react";
import { Search, FileText, Scale, Plus, Eye } from "lucide-react";
import { useTenderResponseData } from "@/hooks/useTenderResponseData";
import { useTenderDemoLang, useTenderDemoT } from "../DemoLangContext";
import { library as i18n } from "../tender-i18n";
import { BRAND, BRAND_DARK, BRAND_MUTED, NAVY } from "../tokens";
import { getSme } from "@/data/tender-response-seed";
import { useToast } from "@/hooks/use-toast";

export default function LibraryView() {
  const { lang } = useTenderDemoLang();
  const t = useTenderDemoT();
  const { library } = useTenderResponseData();
  const { toast } = useToast();
  const [type, setType] = useState<"all" | "answer" | "clause">("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return library.filter((l) =>
      (type === "all" || l.type === type) &&
      (!q || l.title.en.toLowerCase().includes(q.toLowerCase()) || l.title.ar.includes(q) || l.category.en.toLowerCase().includes(q.toLowerCase()))
    ).sort((a, b) => b.winRate - a.winRate);
  }, [library, type, q]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${BRAND_DARK})` }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#A6E2AF" }}>
          {library.length} {lang === "ar" ? "كتلة" : "blocks"}
        </p>
        <h2 className="mt-1 text-xl font-extrabold">{t("title", i18n)}</h2>
        <p className="mt-1 text-[12px] text-gray-200 max-w-3xl">{t("subtitle", i18n)}</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={13} className="absolute top-1/2 -translate-y-1/2 ms-2.5 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPh", i18n)}
            className="w-full ps-8 pe-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(["all", "answer", "clause"] as const).map((tt) => {
            const active = type === tt;
            const key = tt === "all" ? "typeAll" : tt === "answer" ? "typeAnswer" : "typeClause";
            return (
              <button
                key={tt}
                onClick={() => setType(tt)}
                className={`text-[11px] font-bold px-3 py-1 rounded-md transition-colors ${active ? "bg-white shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                style={active ? { color: BRAND_DARK } : undefined}
              >
                {t(key, i18n)}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] text-gray-500 ms-auto">{filtered.length} {lang === "ar" ? "نتيجة" : "results"}</span>
      </div>

      {/* Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((l) => {
          const owner = getSme(l.ownerSme);
          const Icon = l.type === "answer" ? FileText : Scale;
          return (
            <div key={l.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: BRAND_MUTED, color: BRAND_DARK }}>
                  <Icon size={16} />
                </div>
                <span className="text-[9px] uppercase tracking-widest font-extrabold px-2 py-0.5 rounded-full" style={{ background: BRAND_MUTED, color: BRAND_DARK }}>
                  {l.id}
                </span>
              </div>
              <p className="mt-2 text-[10px] uppercase tracking-widest font-bold text-gray-500">{l.category[lang]}</p>
              <p className="mt-0.5 text-[13px] font-extrabold leading-snug" style={{ color: NAVY }}>{l.title[lang]}</p>
              <p className="mt-1 text-[11px] text-gray-600 leading-snug line-clamp-2">{l.summary[lang]}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-gray-400 uppercase font-bold tracking-widest">{t("reused", i18n)}</p>
                  <p className="text-sm font-extrabold" style={{ color: NAVY }}>{l.reusedCount}×</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-gray-400 uppercase font-bold tracking-widest">{t("winRate", i18n)}</p>
                  <p className="text-sm font-extrabold" style={{ color: BRAND }}>{l.winRate}%</p>
                </div>
              </div>
              {owner && (
                <div className="mt-3 flex items-center gap-2 text-[10px] text-gray-500">
                  <span className="w-5 h-5 rounded-full text-white text-[8px] font-extrabold inline-flex items-center justify-center" style={{ background: owner.color }}>{owner.initials}</span>
                  <span>{t("ownedBy", i18n)} <b style={{ color: NAVY }}>{owner.name[lang]}</b></span>
                </div>
              )}
              <div className="mt-3 flex gap-1.5">
                <button
                  onClick={() => toast({ title: t("inserted", i18n), description: l.title[lang] })}
                  className="flex-1 text-[10px] font-bold px-2.5 py-1.5 rounded-md text-white inline-flex items-center justify-center gap-1"
                  style={{ background: BRAND }}
                >
                  <Plus size={11} />{t("insertIntoActive", i18n)}
                </button>
                <button
                  onClick={() => toast({ title: lang === "ar" ? "معاينة" : "Preview", description: l.summary[lang] })}
                  className="text-[10px] font-bold px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1"
                >
                  <Eye size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
