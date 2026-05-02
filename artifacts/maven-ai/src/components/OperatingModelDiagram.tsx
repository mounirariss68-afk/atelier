import { useState } from "react";
import { motion } from "framer-motion";
import { operatingModel } from "@/data/content";

const ringConfig = [
  { radius: 60, stroke: 0, fill: "#0E2841", labelColor: "#F5A623", textColor: "#FFFFFF" },
  { radius: 110, stroke: 30, fill: "#156082", labelColor: "#FFFFFF", textColor: "#FFFFFF" },
  { radius: 165, stroke: 30, fill: "#1f7aa5", labelColor: "#FFFFFF", textColor: "#FFFFFF" },
  { radius: 220, stroke: 30, fill: "#2d94c2", labelColor: "#FFFFFF", textColor: "#FFFFFF" },
];

export default function OperatingModelDiagram() {
  const [active, setActive] = useState(0);
  const rings = operatingModel.rings;
  const size = 480;
  const center = size / 2;

  return (
    <div className="grid lg:grid-cols-5 gap-10 items-center">
      {/* SVG Diagram */}
      <div className="lg:col-span-3 flex items-center justify-center">
        <div className="relative w-full max-w-[480px] aspect-square">
          <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
            <defs>
              <radialGradient id="coreGradient" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1a3a5c" />
                <stop offset="100%" stopColor="#0E2841" />
              </radialGradient>
              <filter id="ringShadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#000" floodOpacity="0.25" />
              </filter>
            </defs>

            {/* Outer rings — drawn from outside in so inner rings stack on top */}
            {[3, 2, 1].map((ringIdx) => {
              const cfg = ringConfig[ringIdx];
              const isActive = active === ringIdx;
              return (
                <motion.circle
                  key={ringIdx}
                  cx={center}
                  cy={center}
                  r={cfg.radius - cfg.stroke / 2}
                  fill="none"
                  stroke={cfg.fill}
                  strokeWidth={cfg.stroke}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{
                    opacity: isActive ? 1 : 0.65,
                    scale: 1,
                    strokeWidth: isActive ? cfg.stroke + 4 : cfg.stroke,
                  }}
                  whileHover={{ opacity: 1, strokeWidth: cfg.stroke + 4 }}
                  transition={{ duration: 0.4, delay: (3 - ringIdx) * 0.15 }}
                  style={{
                    cursor: "pointer",
                    transformOrigin: `${center}px ${center}px`,
                    filter: isActive ? "url(#ringShadow)" : undefined,
                  }}
                  onClick={() => setActive(ringIdx)}
                  onMouseEnter={() => setActive(ringIdx)}
                />
              );
            })}

            {/* Core — solid filled circle, drawn last so it sits on top */}
            <motion.circle
              cx={center}
              cy={center}
              r={ringConfig[0].radius}
              fill="url(#coreGradient)"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{
                opacity: 1,
                scale: 1,
                filter: active === 0 ? "drop-shadow(0 0 18px rgba(245,166,35,0.45))" : "none",
              }}
              transition={{ duration: 0.5, delay: 0.6 }}
              style={{
                cursor: "pointer",
                transformOrigin: `${center}px ${center}px`,
              }}
              stroke={active === 0 ? "#F5A623" : "transparent"}
              strokeWidth={active === 0 ? 3 : 0}
              onClick={() => setActive(0)}
              onMouseEnter={() => setActive(0)}
            />

            {/* Ring labels — placed at the top of each ring band, centered horizontally */}
            {rings.map((ring, i) => {
              const cfg = ringConfig[i];
              const isActive = active === i;
              // For outer rings: place label centered on the top of the stroke band.
              // The stroke is drawn at radius (cfg.radius - cfg.stroke/2), so the band's
              // mid-height is at y = center - (cfg.radius - cfg.stroke/2).
              const labelX = center;
              const labelY = i === 0 ? center - 4 : center - (cfg.radius - cfg.stroke / 2);
              return (
                <g key={ring.name} style={{ pointerEvents: "none" }}>
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={isActive ? "#F5A623" : cfg.labelColor}
                    style={{
                      fontFamily: "'Anton', 'Impact', sans-serif",
                      fontSize: i === 0 ? 26 : 14,
                      letterSpacing: "0.18em",
                      transition: "fill 0.3s",
                    }}
                  >
                    {ring.name}
                  </text>
                  {i === 0 && (
                    <text
                      x={center}
                      y={center + 20}
                      textAnchor="middle"
                      fill="#F5A623"
                      style={{
                        fontFamily: "'Anton', 'Impact', sans-serif",
                        fontSize: 11,
                        letterSpacing: "0.3em",
                      }}
                    >
                      MAVEN AI
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Description Panel */}
      <div className="lg:col-span-2">
        <div className="space-y-3 mb-6">
          {rings.map((ring, i) => (
            <button
              key={ring.name}
              type="button"
              onClick={() => setActive(i)}
              onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-all flex items-center justify-between ${
                active === i
                  ? "border-[#F5A623] bg-[#F5A623]/10"
                  : "border-white/10 bg-white/5 hover:border-white/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: ringConfig[i].fill }}
                />
                <span
                  className={`font-bold tracking-widest text-xs ${
                    active === i ? "text-[#F5A623]" : "text-white"
                  }`}
                >
                  {ring.name}
                </span>
              </div>
              <span
                className={`text-[11px] font-semibold ${
                  active === i ? "text-[#F5A623]" : "text-gray-400"
                }`}
              >
                {ring.headcount}
              </span>
            </button>
          ))}
        </div>

        <motion.div
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-xl p-6 border border-[#F5A623]/30 bg-[#F5A623]/10"
        >
          <div className="text-[11px] font-bold tracking-[0.25em] text-[#F5A623] mb-2">
            {rings[active].name}
          </div>
          <p className="text-white text-sm leading-relaxed">{rings[active].description}</p>
        </motion.div>
      </div>
    </div>
  );
}
