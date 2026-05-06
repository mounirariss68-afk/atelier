import { motion } from "framer-motion";
import { useCareLang } from "../DemoLangContext";
import { supervisor, tDict } from "../care-i18n";
import { BRAND, CHANNEL_COLOR, ACCENT_AI } from "../tokens";
import { getQueueByChannel, getSlaPredictor, getOccupancy, getAiVsHumanMix, getDeflectionByIntent } from "@/data/customer-care-agent";
import { CHANNEL_LABEL, tBi } from "@/data/customer-care-seed";

export default function SupervisorStripView() {
  const { lang } = useCareLang();
  const t = tDict(supervisor, lang);
  const queues = getQueueByChannel();
  const sla = getSlaPredictor(lang);
  const occ = getOccupancy();
  const mix = getAiVsHumanMix(lang);
  const defl = getDeflectionByIntent(lang);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.sub}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={t.queuesTitle}>
          <div className="space-y-3">
            {queues.map((q) => (
              <div key={q.channel}>
                <div className="flex items-center justify-between mb-1 text-xs">
                  <span className="font-semibold" style={{ color: CHANNEL_COLOR[q.channel] }}>{tBi(CHANNEL_LABEL[q.channel], lang)}</span>
                  <span className="text-gray-500">{q.open} open · {q.agentsOnChannel} agents · oldest {q.oldestWaitMins}m</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, q.open)}%` }} transition={{ duration: 0.6 }} className="h-full" style={{ background: CHANNEL_COLOR[q.channel] }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t.slaTitle}>
          <div className="flex items-end gap-2 h-32 px-2 pt-2">
            {sla.map((s, i) => {
              const max = Math.max(...sla.map((x) => x.value));
              const h = (s.value / max) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <motion.div initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: i * 0.05 }} className="w-full rounded-t-md" style={{ background: i === sla.length - 1 ? "#E30613" : "#F59E0B" }} />
                  <span className="text-[10px] font-bold text-gray-700">{s.value}</span>
                  <span className="text-[9px] text-gray-400">{s.name}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title={t.occupancyTitle}>
          <div className="space-y-2">
            {occ.map((a) => (
              <div key={a.id} className={`flex items-center gap-2.5 ${a.isMe ? "bg-emerald-50/50 -mx-2 px-2 py-1 rounded" : ""}`}>
                <span className="text-[11px] font-semibold w-32 truncate">{lang === "en" ? a.nameEn : a.nameAr}{a.isMe && " ★"}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full" style={{ width: `${a.occupancy}%`, background: a.occupancy > 85 ? "#E30613" : a.occupancy > 65 ? "#F59E0B" : BRAND }} />
                </div>
                <span className="text-[10px] text-gray-500 w-8 text-end">{a.occupancy}%</span>
                <span className="text-[10px] text-gray-400 w-12 text-end">{a.fcr}% FCR</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title={t.aiMixTitle}>
          <div className="flex items-end gap-3 h-32 px-2 pt-2">
            {mix.map((m, i) => {
              const max = Math.max(...mix.map((x) => x.value));
              const h = (m.value / max) * 100;
              const color = i === 0 ? ACCENT_AI : i === 1 ? BRAND : "#6B7280";
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                  <span className="text-[11px] font-bold">{m.value}</span>
                  <motion.div initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: i * 0.08 }} className="w-full rounded-t-md" style={{ background: color }} />
                  <span className="text-[10px] text-gray-500 text-center leading-tight">{m.name}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title={t.deflectionTitle} colSpan>
          <div className="space-y-2">
            {defl.map((d, i) => {
              const max = Math.max(...defl.map((x) => x.value));
              return (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="text-[11px] font-semibold w-28 truncate">{d.name}</span>
                  <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${(d.value / max) * 100}%` }} transition={{ delay: i * 0.05 }} className="h-full rounded-full" style={{ background: ACCENT_AI }} />
                  </div>
                  <span className="text-[11px] font-bold w-10 text-end">{d.value}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children, colSpan }: { title: string; children: React.ReactNode; colSpan?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-100 shadow-sm ${colSpan ? "lg:col-span-2" : ""}`}>
      <div className="px-4 py-2.5 border-b border-gray-100">
        <h3 className="text-xs font-bold">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
