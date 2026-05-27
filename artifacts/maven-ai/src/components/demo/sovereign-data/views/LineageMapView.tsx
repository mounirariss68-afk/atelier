import { useState } from "react";
import { ZoomIn, RotateCcw } from "lucide-react";
import { useSdsLang, useSdsT } from "../DemoLangContext";
import { lineage } from "../sovereign-i18n";
import { ACTIVE_LINEAGE_NODES, ACTIVE_LINEAGE_EDGES } from "@/data/sovereign-data-seed";
import { BRAND, BRAND_INK } from "../tokens";

export default function LineageMapView({ focusProductId }: { focusProductId?: string }) {
  const { lang } = useSdsLang();
  const t = useSdsT();
  const isAr = lang === "ar";
  const [zoomed, setZoomed] = useState<boolean>(focusProductId === "citizen-sentiment-dashboard");

  const W = 880, H = 420;
  const NODE_W = 140, NODE_H = 36;

  function nodeFill(kind: "source" | "transform" | "sink", blocked?: boolean): string {
    if (blocked) return "#FEE2E2";
    if (kind === "source") return "#E0F2FE";
    if (kind === "transform") return "#FEF3C7";
    return "#DCFCE7";
  }
  function nodeStroke(kind: "source" | "transform" | "sink", blocked?: boolean): string {
    if (blocked) return "#D9534F";
    if (kind === "source") return "#0284C7";
    if (kind === "transform") return "#F59E0B";
    return "#8A5BD6";
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="p-6 space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: BRAND_INK }}>{t("title", lineage)}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", lineage)}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setZoomed(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white" style={{ background: BRAND }}>
            <ZoomIn size={12} /> {t("zoomToActive", lineage)}
          </button>
          {zoomed && (
            <button onClick={() => setZoomed(false)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-gray-700 bg-white border border-gray-200">
              <RotateCcw size={12} /> {t("resetZoom", lineage)}
            </button>
          )}
        </div>
      </header>

      <div className="bg-white border border-gray-200 rounded-2xl p-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 800 }}>
          <defs>
            <marker id="arrow-red-lin" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#D9534F" />
            </marker>
            <marker id="arrow-grey-lin" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#9CA3AF" />
            </marker>
          </defs>

          {ACTIVE_LINEAGE_EDGES.map((e, i) => {
            const from = ACTIVE_LINEAGE_NODES.find((n) => n.id === e.from)!;
            const to = ACTIVE_LINEAGE_NODES.find((n) => n.id === e.to)!;
            const blocked = e.blocked;
            return (
              <line
                key={i}
                x1={from.x + NODE_W} y1={from.y + NODE_H / 2}
                x2={to.x} y2={to.y + NODE_H / 2}
                stroke={blocked ? "#D9534F" : "#9CA3AF"}
                strokeWidth={blocked ? 2 : 1}
                strokeDasharray={blocked ? "4 3" : undefined}
                markerEnd={blocked ? "url(#arrow-red-lin)" : "url(#arrow-grey-lin)"}
                opacity={zoomed ? 1 : 0.7}
              />
            );
          })}

          {ACTIVE_LINEAGE_NODES.map((n) => (
            <g key={n.id}>
              <rect
                x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={6}
                fill={nodeFill(n.kind, n.blocked)}
                stroke={nodeStroke(n.kind, n.blocked)}
                strokeWidth={n.blocked ? 2 : 1.5}
              />
              {n.blocked && (
                <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={6} fill="none" stroke="#D9534F" strokeWidth={3} opacity="0.3">
                  <animate attributeName="opacity" values="0.3;0.05;0.3" dur="2s" repeatCount="indefinite" />
                </rect>
              )}
              <text x={n.x + 8} y={n.y + 22} fontSize="11" fontWeight="700" fill={BRAND_INK}>
                {n.label[lang].length > 22 ? n.label[lang].slice(0, 21) + "…" : n.label[lang]}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-gray-600 flex-wrap">
        <LegendDot color="#0284C7" label={t("legendSource", lineage)} />
        <LegendDot color="#F59E0B" label={t("legendTransform", lineage)} />
        <LegendDot color="#8A5BD6" label={t("legendSinkOk", lineage)} />
        <LegendDot color="#D9534F" label={t("legendSinkBlocked", lineage)} />
        <span className="flex items-center gap-1">
          <span className="block w-6 h-px bg-gray-400" /> {t("legendEdge", lineage)}
        </span>
      </div>

      {/* Blocked sink callout */}
      {ACTIVE_LINEAGE_NODES.filter((n) => n.blocked).map((n) => (
        <div key={n.id} className="bg-red-50 border border-red-200 rounded-xl p-3 text-[12px] text-red-900">
          <p className="font-bold mb-0.5">{n.label[lang]}</p>
          {n.blockedReason && <p className="text-[11px]">{n.blockedReason[lang]}</p>}
        </div>
      ))}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span className="block w-2 h-2 rounded-full" style={{ background: color }} />{label}</span>;
}
