import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { useCscLang } from "../DemoLangContext";
import { director, tDict } from "../citizen-i18n";
import { tt, getMinistry } from "@/data/citizen-services-seed";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { BRAND, NAVY } from "../tokens";

export default function DirectorView() {
  const { lang } = useCscLang();
  const t = tDict(director, lang);
  const { heatmap, ministryVolume, services, regions, director: dir } = useCitizenServicesData();

  const max = Math.max(1, ...heatmap.map((c) => c.volume));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t.subtitle}</p>
        </div>
        <div className="text-end">
          <p className="text-[10px] uppercase font-bold tracking-widest text-gray-400">{lang === "en" ? "Director" : "المديرة"}</p>
          <p className="text-sm font-semibold" style={{ color: NAVY }}>{tt(dir.name, lang)}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Heatmap */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">{t.heat_volume} · {t.heat_ttr}</p>
          <div className="overflow-x-auto">
            <table className="text-[11px] border-separate border-spacing-1 min-w-full">
              <thead>
                <tr>
                  <th></th>
                  {regions.map((r) => (
                    <th key={r.id} className="text-[10px] font-semibold text-gray-500 px-1.5 py-1 text-start">{tt(r.name, lang)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id}>
                    <td className="text-[11px] font-semibold text-gray-700 pe-2 py-1.5">{tt(s.name, lang)}</td>
                    {regions.map((r) => {
                      const cell = heatmap.find((h) => h.serviceId === s.id && h.regionId === r.id);
                      const intensity = cell ? cell.volume / max : 0;
                      const bg = `rgba(91, 169, 138, ${0.1 + intensity * 0.85})`;
                      return (
                        <td key={r.id} className="px-2 py-1.5 rounded text-center" style={{ background: bg, minWidth: 80 }}>
                          <p className="text-[12px] font-bold" style={{ color: intensity > 0.5 ? "white" : NAVY }}>{cell?.volume ?? 0}</p>
                          <p className="text-[9px]" style={{ color: intensity > 0.5 ? "rgba(255,255,255,0.85)" : "#6B7280" }}>{cell?.ttrHours ?? 0}h</p>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Ministry volume bar */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">{t.ministry_today}</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ministryVolume.map((v) => ({ name: getMinistry(v.ministryId)?.short[lang] ?? v.ministryId, value: v.volume, color: v.color }))}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} width={28} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={22}>
                  {ministryVolume.map((v, i) => <Cell key={i} fill={v.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">{lang === "en" ? `Brand accent ${BRAND} • all 4 regions, 8 services` : `لون الهوية ${BRAND} • جميع المناطق الأربع و8 خدمات`}</p>
        </div>
      </div>
    </div>
  );
}
