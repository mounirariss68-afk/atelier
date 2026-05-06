import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useEkcLang, useEkcT } from "../DemoLangContext";
import { ops } from "../knowledge-i18n";
import { BRAND, BRAND_INK } from "../tokens";
import { topQuestions, refusalRateByPersona, topCitedSources, staleSources } from "@/data/enterprise-knowledge-agent";
import { personaById, sourceById } from "@/data/enterprise-knowledge-seed";

export default function KnowledgeOpsView() {
  const { lang } = useEkcLang();
  const t = useEkcT();

  const top = topQuestions();
  const refusal = refusalRateByPersona();
  const cited = topCitedSources();
  const stale = staleSources();

  const refusalChart = refusal.map((r) => ({
    name: personaById(r.personaId).role[lang].split(" ").slice(0, 2).join(" "),
    value: r.rate,
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", ops)}</h1>
        <p className="text-[12px] text-gray-600 mt-0.5">{t("subtitle", ops)}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Top questions */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-[12px] font-extrabold mb-3" style={{ color: BRAND_INK }}>{t("topQuestionsTitle", ops)}</p>
          <ul className="space-y-2">
            {top.map((q, i) => (
              <li key={i} className="flex items-center justify-between text-[12px]">
                <span className="text-gray-700 flex-1 truncate">{(q as any)[lang]}</span>
                <span className="font-bold ms-2" style={{ color: BRAND }}>{q.count} {t("asks", ops)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Refusal rate */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-[12px] font-extrabold mb-3" style={{ color: BRAND_INK }}>{t("refusalRateTitle", ops)}</p>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={refusalChart} margin={{ left: 0, right: 5, top: 5, bottom: 30 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" />
                <YAxis tick={{ fontSize: 10 }} width={30} unit="%" />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={28}>
                  {refusalChart.map((_, i) => (
                    <Cell key={i} fill={refusalChart[i].value > 30 ? "#E30613" : refusalChart[i].value > 10 ? "#F59E0B" : BRAND} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top cited sources */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-[12px] font-extrabold mb-3" style={{ color: BRAND_INK }}>{t("topCitedTitle", ops)}</p>
          <ul className="space-y-2">
            {cited.map((c) => {
              const s = sourceById(c.id);
              if (!s) return null;
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-gray-700 flex-1 truncate font-bold">{s.title[lang]}</span>
                  <span className="font-bold flex-shrink-0" style={{ color: BRAND }}>{c.citations} {t("citations", ops)}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Stale sources */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-[12px] font-extrabold mb-3" style={{ color: BRAND_INK }}>{t("staleTitle", ops)}</p>
          {stale.length === 0 ? (
            <p className="text-[12px] text-gray-500">—</p>
          ) : (
            <ul className="space-y-2">
              {stale.map((s) => {
                const src = sourceById(s.id);
                if (!src) return null;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-gray-700 flex-1 truncate font-bold">{src.title[lang]}</span>
                    <span className="font-bold flex-shrink-0" style={{ color: "#E30613" }}>{s.daysOld} {t("daysOld", ops)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
