import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Filter, AlertTriangle, ChevronRight, Sparkles, Check, X, Edit3, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSamaComplianceData } from "@/hooks/useSamaComplianceData";
import {
  DOMAINS, DOMAIN_LABEL, BUSINESS_LINES, BUSINESS_LINE_LABEL,
  ragBg, type RagStatus, type ObligationDomain, type BusinessLine,
} from "@/data/sama-compliance-seed";
import { generateRecommendations } from "@/data/sama-compliance-agent";
import { useSamaDemoLang } from "../DemoLangContext";
import { register, useTrFactory } from "../sama-i18n";
import { BRAND, BRAND_INK } from "../tokens";

type Page = string;

export default function ObligationsRegisterView({ onNavigate }: { onNavigate?: (page: Page, id?: string) => void }) {
  const { obligations } = useSamaComplianceData();
  const { lang } = useSamaDemoLang();
  const t = useTrFactory(lang);
  const isAr = lang === "ar";
  const { toast } = useToast();

  const [domain, setDomain] = useState<"all" | ObligationDomain>("all");
  const [reg, setReg] = useState<"all" | "SAMA" | "PDPL" | "CMA">("all");
  const [rag, setRag] = useState<"all" | RagStatus>("all");
  const [q, setQ] = useState("");
  const [decisions, setDecisions] = useState<Record<string, "approved" | "rejected" | "edited">>({});
  type SortKey = "id" | "title" | "domain" | "owner" | "lastTested" | "regulator" | "rag";
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const RAG_RANK: Record<RagStatus, number> = { red: 0, amber: 1, green: 2 };

  const recs = useMemo(() => generateRecommendations().slice(0, 4), []);

  const filtered = useMemo(() => {
    const base = obligations.filter((o) => {
      if (domain !== "all" && o.domain !== domain) return false;
      if (reg !== "all" && o.regulator !== reg) return false;
      if (rag !== "all" && o.rag !== rag) return false;
      if (q.trim()) {
        const needle = q.toLowerCase();
        const hay = `${o.id} ${o.titleEn} ${o.titleAr} ${o.ownerName} ${o.paragraph}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...base].sort((a, b) => {
      switch (sortKey) {
        case "id": return a.id.localeCompare(b.id) * dir;
        case "title": {
          const av = isAr ? a.titleAr : a.titleEn;
          const bv = isAr ? b.titleAr : b.titleEn;
          return av.localeCompare(bv) * dir;
        }
        case "domain": return a.domain.localeCompare(b.domain) * dir;
        case "owner": return a.ownerName.localeCompare(b.ownerName) * dir;
        case "lastTested": return a.lastTested.localeCompare(b.lastTested) * dir;
        case "regulator": return a.regulator.localeCompare(b.regulator) * dir;
        case "rag": return (RAG_RANK[a.rag] - RAG_RANK[b.rag]) * dir;
      }
    });
    return sorted;
  }, [obligations, domain, reg, rag, q, sortKey, sortDir, isAr]);

  const heatRow = (dom: ObligationDomain) => BUSINESS_LINES.map((bl) => {
    const cell = obligations.filter((o) => o.domain === dom && o.businessLines.includes(bl));
    if (!cell.length) return { count: 0, rag: "green" as RagStatus };
    const red = cell.filter((c) => c.rag === "red").length;
    const amber = cell.filter((c) => c.rag === "amber").length;
    const ragOut: RagStatus = red > 0 ? "red" : amber > 0 ? "amber" : "green";
    return { count: cell.length, rag: ragOut };
  });

  const newOrChanged = obligations.filter((o) => o.newThisWeek || o.changedThisWeek);

  const decide = (id: string, action: "approved" | "rejected" | "edited", title: string) => {
    setDecisions((prev) => ({ ...prev, [id]: action }));
    const titleStr = action === "approved"
      ? (isAr ? "تمّ الاعتماد." : "Approved.")
      : action === "rejected"
        ? (isAr ? "تمّ الرفض." : "Rejected.")
        : (isAr ? "تمّ التعديل." : "Edited.");
    toast({ title: titleStr, description: title });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: BRAND_INK }}>
          <Filter size={18} style={{ color: BRAND }} />
          {t("title", register)}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", register)}</p>
      </div>

      {/* Hero widgets */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* What changed this week */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} style={{ color: BRAND }} />
            <h3 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("whatChanged", register)}</h3>
          </div>
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {newOrChanged.slice(0, 10).map((o) => (
              <li key={o.id} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 px-1.5 py-0.5 rounded font-bold text-[9px] ${o.newThisWeek ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                  {o.newThisWeek ? t("newPill", register) : t("changedPill", register)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" style={{ color: BRAND_INK }}>{isAr ? o.titleAr : o.titleEn}</p>
                  <p className="text-[10px] text-gray-500">{o.id} · {o.paragraph}</p>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${ragBg(o.rag)} font-bold`}>{o.rag.toUpperCase()}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => onNavigate?.("circular", "CRU-2026-04")}
            className="w-full mt-3 py-2 rounded-lg text-xs font-bold text-amber-700 hover:bg-amber-50 transition-colors flex items-center justify-center gap-1"
          >
            {t("openDetail", register)}
          </button>
        </div>

        {/* Heatmap */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: BRAND_INK }}>{t("heatmap", register)}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr>
                  <th className="text-left py-1 pr-2"></th>
                  {BUSINESS_LINES.map((bl) => (
                    <th key={bl} className="px-1 py-1 text-center text-gray-500 font-medium">
                      {(BUSINESS_LINE_LABEL[bl][lang] ?? BUSINESS_LINE_LABEL[bl].en).split(" ")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DOMAINS.map((dom) => {
                  const cells = heatRow(dom);
                  return (
                    <tr key={dom}>
                      <td className="py-1 pr-2 font-semibold text-gray-700">{DOMAIN_LABEL[dom][lang] ?? DOMAIN_LABEL[dom].en}</td>
                      {cells.map((c, i) => (
                        <td key={i} className="px-1 py-1 text-center">
                          <div
                            className={`mx-auto w-7 h-6 rounded flex items-center justify-center text-white text-[9px] font-bold ${c.count === 0 ? "bg-gray-100 text-gray-400" : c.rag === "red" ? "bg-red-500" : c.rag === "amber" ? "bg-amber-500" : "bg-emerald-500"}`}
                          >
                            {c.count || "—"}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recommendations stack */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} style={{ color: BRAND }} />
            <h3 className="text-sm font-bold" style={{ color: BRAND_INK }}>{t("recommendations", register)}</h3>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {recs.map((r) => {
              const decided = decisions[r.id];
              return (
                <div key={r.id} className="border border-gray-100 rounded-xl p-2.5">
                  <p className="text-xs font-semibold" style={{ color: BRAND_INK }}>{r.title[lang] ?? r.title.en}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{r.confidence}% {t("confidence", register)}</p>
                  {decided ? (
                    <p className="text-[10px] font-bold mt-1.5 text-emerald-600">{decided.toUpperCase()}</p>
                  ) : (
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => decide(r.id, "approved", r.title[lang] ?? r.title.en)} className="flex-1 py-1 rounded-lg text-[10px] font-bold text-white" style={{ background: BRAND }}>
                        <Check size={10} className="inline mr-1" />{t("approve", register)}
                      </button>
                      <button onClick={() => decide(r.id, "edited", r.title[lang] ?? r.title.en)} className="flex-1 py-1 rounded-lg text-[10px] font-bold border border-gray-200 hover:border-amber-300">
                        <Edit3 size={10} className="inline mr-1" />{t("edit", register)}
                      </button>
                      <button onClick={() => decide(r.id, "rejected", r.title[lang] ?? r.title.en)} className="flex-1 py-1 rounded-lg text-[10px] font-bold border border-gray-200 hover:border-red-300 text-red-600">
                        <X size={10} className="inline mr-1" />{t("dismiss", register)}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "right-3" : "left-3"} text-gray-400`} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search", register)}
            className={`w-full ${isAr ? "pr-9 pl-3" : "pl-9 pr-3"} py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400`}
          />
        </div>
        <FilterPill label={t("filterDomain", register)} value={domain} setValue={(v) => setDomain(v as typeof domain)} options={[["all", t("all", register)], ...DOMAINS.map((d) => [d, DOMAIN_LABEL[d][lang] ?? DOMAIN_LABEL[d].en] as [string, string])]} />
        <FilterPill label={t("filterRegulator", register)} value={reg} setValue={(v) => setReg(v as typeof reg)} options={[["all", t("all", register)], ["SAMA", "SAMA"], ["PDPL", "PDPL"], ["CMA", "CMA"]]} />
        <FilterPill label={t("filterRag", register)} value={rag} setValue={(v) => setRag(v as typeof rag)} options={[["all", t("all", register)], ["green", "Green"], ["amber", "Amber"], ["red", "Red"]]} />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <SortHeader label={t("colId", register)} k="id" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label={t("colTitle", register)} k="title" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label={t("colDomain", register)} k="domain" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label={t("colOwner", register)} k="owner" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label={t("colLastTested", register)} k="lastTested" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label={t("colRegulator", register)} k="regulator" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortHeader label={t("colRag", register)} k="rag" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.slice(0, 60).map((o) => (
                <motion.tr
                  key={o.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="hover:bg-amber-50/40 cursor-pointer"
                  onClick={() => onNavigate?.("circular", o.introducedBy)}
                >
                  <td className="px-3 py-2 font-mono text-[10px] text-gray-600">{o.id}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {o.newThisWeek && <span className="px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-bold text-[9px]">{t("newPill", register)}</span>}
                      {o.changedThisWeek && <span className="px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-bold text-[9px]">{t("changedPill", register)}</span>}
                      <span className="font-semibold" style={{ color: BRAND_INK }}>{isAr ? o.titleAr : o.titleEn}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-0.5">{o.paragraph}</p>
                  </td>
                  <td className="px-3 py-2">{DOMAIN_LABEL[o.domain][lang] ?? DOMAIN_LABEL[o.domain].en}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{o.ownerName}</p>
                    <p className="text-[10px] text-gray-500">{lang === "ar" ? o.ownerTitleAr : o.ownerTitleEn}</p>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{o.lastTested.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-gray-600">{o.regulator}</td>
                  <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ragBg(o.rag)}`}>{o.rag.toUpperCase()}</span></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
          <span>{t("showing", register)} {Math.min(60, filtered.length)} {t("of", register)} {filtered.length} {t("obligations", register)}</span>
          <span>240 {isAr ? "إجمالي" : "total"}</span>
        </div>
      </div>
    </div>
  );
}

function SortHeader<K extends string>({ label, k, sortKey, sortDir, onClick }: { label: string; k: K; sortKey: K; sortDir: "asc" | "desc"; onClick: (k: K) => void }) {
  const active = sortKey === k;
  return (
    <th className="px-3 py-2.5 text-left font-semibold">
      <button onClick={() => onClick(k)} className="inline-flex items-center gap-1 hover:text-amber-700">
        {label}
        {active ? (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} className="opacity-30" />}
      </button>
    </th>
  );
}

function FilterPill({ label, value, setValue, options }: { label: string; value: string; setValue: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-semibold text-gray-500">{label}:</span>
      <select value={value} onChange={(e) => setValue(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-amber-400">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
