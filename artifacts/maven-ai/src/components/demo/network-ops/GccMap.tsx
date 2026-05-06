import { memo } from "react";
import { SITES, LINKS, type Site, type NetLink } from "@/data/network-ops-seed";
import { BRAND } from "./tokens";

const VIEW_W = 720;
const VIEW_H = 540;

// Bounding box across the GCC (lng, lat)
const BBOX = { minLng: 34.0, maxLng: 60.0, minLat: 16.0, maxLat: 31.0 };

function project(lat: number, lng: number) {
  const x = ((lng - BBOX.minLng) / (BBOX.maxLng - BBOX.minLng)) * VIEW_W;
  // invert y because lat grows north and svg y grows south
  const y = VIEW_H - ((lat - BBOX.minLat) / (BBOX.maxLat - BBOX.minLat)) * VIEW_H;
  return { x, y };
}

// Stylised polygon outlines for the GCC + Saudi Arabia. These are
// hand-traced approximations — illustrative, not cartographic.
const COUNTRY_PATHS: { id: string; d: string; label: string; cx: number; cy: number }[] = [
  // Saudi Arabia — large central polygon
  {
    id: "SA",
    label: "Saudi Arabia",
    cx: 305,
    cy: 280,
    d: "M120,80 L210,55 L310,40 L380,60 L460,80 L495,140 L520,200 L520,260 L500,310 L470,360 L430,410 L370,455 L290,470 L240,440 L210,400 L180,355 L160,310 L140,255 L120,200 L105,150 L120,80 Z",
  },
  // UAE
  {
    id: "AE",
    label: "UAE",
    cx: 555,
    cy: 285,
    d: "M520,255 L560,250 L595,260 L605,290 L585,310 L555,318 L525,305 L520,280 Z",
  },
  // Qatar
  {
    id: "QA",
    label: "Qatar",
    cx: 478,
    cy: 245,
    d: "M470,225 L488,225 L495,250 L488,275 L470,275 L463,250 Z",
  },
  // Bahrain (small)
  {
    id: "BH",
    label: "Bahrain",
    cx: 460,
    cy: 230,
    d: "M455,225 L468,225 L470,238 L460,245 L452,238 Z",
  },
  // Kuwait
  {
    id: "KW",
    label: "Kuwait",
    cx: 380,
    cy: 145,
    d: "M360,130 L400,125 L410,150 L390,165 L365,160 L355,145 Z",
  },
  // Oman
  {
    id: "OM",
    label: "Oman",
    cx: 615,
    cy: 365,
    d: "M580,310 L630,305 L660,330 L668,375 L645,420 L605,440 L570,415 L555,380 L555,340 Z",
  },
];

const STATUS_FILL: Record<Site["status"], string> = {
  ok: "#5BA98A",
  degraded: "#F5A623",
  down: "#D9534F",
};
const LINK_STROKE: Record<NetLink["status"], string> = {
  ok: "#94A3B8",
  degraded: "#F5A623",
  down: "#D9534F",
};

interface Props {
  selectedSiteId?: string;
  onSelectSite?: (id: string) => void;
  highlightedSiteIds?: string[];
  isAr?: boolean;
}

function GccMapInner({ selectedSiteId, onSelectSite, highlightedSiteIds, isAr }: Props) {
  const highlight = new Set(highlightedSiteIds ?? []);
  return (
    <div className="w-full h-full bg-gradient-to-br from-[#EAF2F6] to-white rounded-2xl overflow-hidden border border-gray-200">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-full">
        {/* Sea background */}
        <rect width={VIEW_W} height={VIEW_H} fill="#EAF2F6" />

        {/* Country outlines */}
        <g>
          {COUNTRY_PATHS.map((c) => (
            <g key={c.id}>
              <path d={c.d} fill="#F5F1E8" stroke="#C7D2DB" strokeWidth={1.2} />
              <text
                x={c.cx}
                y={c.cy}
                textAnchor="middle"
                fontSize={11}
                fill="#94A3B8"
                fontWeight={600}
                style={{ letterSpacing: 0.5, pointerEvents: "none" }}
              >
                {c.label}
              </text>
            </g>
          ))}
        </g>

        {/* Links */}
        <g>
          {LINKS.map((l) => {
            const a = SITES.find((s) => s.id === l.fromId);
            const b = SITES.find((s) => s.id === l.toId);
            if (!a || !b) return null;
            const p1 = project(a.lat, a.lng);
            const p2 = project(b.lat, b.lng);
            const stroke = LINK_STROKE[l.status];
            const dashed = l.kind === "microwave";
            const w = l.status === "down" ? 2.2 : l.status === "degraded" ? 1.8 : 1;
            return (
              <line
                key={l.id}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={stroke}
                strokeWidth={w}
                strokeOpacity={l.status === "ok" ? 0.55 : 0.85}
                strokeDasharray={dashed ? "4 3" : undefined}
              />
            );
          })}
        </g>

        {/* Sites */}
        <g>
          {SITES.map((s) => {
            const p = project(s.lat, s.lng);
            const r = s.type === "core" ? 7 : s.type === "datacenter" ? 6 : s.type === "aggregation" ? 5 : 4;
            const fill = STATUS_FILL[s.status];
            const isHighlighted = highlight.has(s.id) || s.id === selectedSiteId;
            return (
              <g key={s.id} style={{ cursor: onSelectSite ? "pointer" : "default" }} onClick={() => onSelectSite?.(s.id)}>
                {isHighlighted && (
                  <circle cx={p.x} cy={p.y} r={r + 6} fill={fill} fillOpacity={0.18}>
                    <animate attributeName="r" from={r + 4} to={r + 12} dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="fill-opacity" from={0.35} to={0} dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke="#fff" strokeWidth={1.5} />
                {s.type === "core" && (
                  <circle cx={p.x} cy={p.y} r={r - 2.5} fill="#fff" fillOpacity={0.75} />
                )}
              </g>
            );
          })}
        </g>

        {/* City labels for the most prominent cities */}
        <g>
          {SITES.filter((s) => s.type === "core" || s.id === "SHJ-EDGE-04" || s.id === "DMM-AGG-02").map((s) => {
            const p = project(s.lat, s.lng);
            return (
              <text
                key={`lbl-${s.id}`}
                x={p.x + 9}
                y={p.y + 3}
                fontSize={9.5}
                fill="#0E2841"
                fontWeight={600}
                style={{ pointerEvents: "none" }}
              >
                {isAr ? s.city.ar : s.city.en}
              </text>
            );
          })}
        </g>

        {/* Brand watermark */}
        <text
          x={VIEW_W - 12}
          y={VIEW_H - 10}
          textAnchor="end"
          fontSize={9}
          fill={BRAND}
          fontWeight={700}
          opacity={0.6}
        >
          Sahara Telecom · GCC topology
        </text>
      </svg>
    </div>
  );
}

export default memo(GccMapInner);
