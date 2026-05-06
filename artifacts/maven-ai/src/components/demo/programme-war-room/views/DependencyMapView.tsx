import { useState } from "react";
import { ZoomIn, RotateCcw } from "lucide-react";
import { usePwrLang, usePwrT } from "../DemoLangContext";
import { dependency } from "../programme-i18n";
import { usePwrData } from "@/hooks/useProgrammeWarRoomData";
import { DEPENDENCY_NODE_POSITIONS, programmeById } from "@/data/programme-war-room-seed";
import { ragColor } from "@/data/programme-war-room-agent";
import { BRAND, BRAND_INK } from "../tokens";

export default function DependencyMapView({ focusProgrammeId }: { focusProgrammeId?: string }) {
  const { lang } = usePwrLang();
  const t = usePwrT();
  const isAr = lang === "ar";
  const { programmes, dependencies } = usePwrData();
  const [zoomTo, setZoomTo] = useState<string | null>(focusProgrammeId ?? null);

  const W = 920, H = 520;

  const focusedNeighbours = (() => {
    if (!zoomTo) return null;
    const ids = new Set<string>([zoomTo]);
    dependencies.forEach((d) => {
      if (d.fromId === zoomTo) ids.add(d.toId);
      if (d.toId === zoomTo) ids.add(d.fromId);
    });
    return ids;
  })();

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", dependency)}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", dependency)}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setZoomTo("erp-oracle")} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white" style={{ background: BRAND }}>
            <ZoomIn size={12} /> {t("zoomToErp", dependency)}
          </button>
          {zoomTo && (
            <button onClick={() => setZoomTo(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-gray-700 bg-white border border-gray-200">
              <RotateCcw size={12} /> {t("resetZoom", dependency)}
            </button>
          )}
        </div>
      </header>

      <div className="bg-white border border-gray-200 rounded-2xl p-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 800 }}>
          <defs>
            <marker id="arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#E30613" />
            </marker>
            <marker id="arrow-grey" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#9CA3AF" />
            </marker>
          </defs>

          {dependencies.map((d, i) => {
            const from = DEPENDENCY_NODE_POSITIONS[d.fromId];
            const to = DEPENDENCY_NODE_POSITIONS[d.toId];
            if (!from || !to) return null;
            const fromP = programmeById(d.fromId);
            const toP = programmeById(d.toId);
            const isHot = (fromP?.rag === "red" || toP?.rag === "red") && d.critical;
            const dim = focusedNeighbours && !(focusedNeighbours.has(d.fromId) && focusedNeighbours.has(d.toId));
            return (
              <line
                key={i}
                x1={from.x + 70} y1={from.y + 22}
                x2={to.x} y2={to.y + 22}
                stroke={isHot ? "#E30613" : "#9CA3AF"}
                strokeWidth={isHot ? 2 : 1}
                strokeDasharray={d.critical ? undefined : "3 3"}
                markerEnd={isHot ? "url(#arrow-red)" : "url(#arrow-grey)"}
                opacity={dim ? 0.15 : 0.7}
              />
            );
          })}

          {programmes.map((p) => {
            const pos = DEPENDENCY_NODE_POSITIONS[p.id];
            if (!pos) return null;
            const dim = focusedNeighbours && !focusedNeighbours.has(p.id);
            return (
              <g key={p.id} opacity={dim ? 0.2 : 1} style={{ cursor: "pointer" }} onClick={() => setZoomTo(p.id)}>
                <rect x={pos.x} y={pos.y} width={140} height={44} rx={8} fill="white" stroke={ragColor(p.rag)} strokeWidth={2} />
                {p.rag === "red" && (
                  <rect x={pos.x} y={pos.y} width={140} height={44} rx={8} fill="none" stroke={ragColor(p.rag)} strokeWidth={4} opacity="0.3">
                    <animate attributeName="opacity" values="0.3;0.05;0.3" dur="2s" repeatCount="indefinite" />
                  </rect>
                )}
                <circle cx={pos.x + 12} cy={pos.y + 14} r={4} fill={ragColor(p.rag)} />
                <text x={pos.x + 22} y={pos.y + 17} fontSize="10" fontWeight="700" fill={BRAND_INK}>
                  {p.name[lang].length > 18 ? p.name[lang].slice(0, 17) + "…" : p.name[lang]}
                </text>
                <text x={pos.x + 12} y={pos.y + 32} fontSize="9" fill="#6B7280">
                  {p.slipDays > 0 ? `${p.slipDays}d slip` : "—"} · {p.pctComplete}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-gray-600">
        <LegendDot color="#E30613" label={t("legendRed", dependency)} />
        <LegendDot color="#F59E0B" label={t("legendAmber", dependency)} />
        <LegendDot color="#10B981" label={t("legendGreen", dependency)} />
        <span className="flex items-center gap-1">
          <span className="block w-6 h-px bg-gray-400" /> {t("legendEdge", dependency)}
        </span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span className="block w-2 h-2 rounded-full" style={{ background: color }} />{label}</span>;
}
