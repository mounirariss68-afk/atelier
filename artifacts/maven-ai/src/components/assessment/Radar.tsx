interface RadarProps {
  dimensions: { id: string; label: string }[];
  scores: Record<string, number>;
  benchmark: Record<string, number>;
  color: string;
  size?: number;
}

export default function Radar({ dimensions, scores, benchmark, color, size = 360 }: RadarProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 60;
  const n = dimensions.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

  const point = (val: number, i: number) => {
    const v = Math.max(0, Math.min(5, val)) / 5;
    return [cx + Math.cos(angle(i)) * r * v, cy + Math.sin(angle(i)) * r * v];
  };

  const polygon = (vals: number[]) => vals.map((v, i) => point(v, i).join(",")).join(" ");

  const scoreVals = dimensions.map((d) => scores[d.id] ?? 0);
  const benchVals = dimensions.map((d) => benchmark[d.id] ?? 0);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block mx-auto">
      {[1, 2, 3, 4, 5].map((ring) => (
        <polygon
          key={ring}
          points={polygon(dimensions.map(() => ring))}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={1}
        />
      ))}
      {dimensions.map((_, i) => {
        const [x, y] = point(5, i);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#E5E7EB" strokeWidth={1} />;
      })}
      <polygon
        points={polygon(benchVals)}
        fill="rgba(156, 163, 175, 0.15)"
        stroke="rgba(107, 114, 128, 0.6)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      <polygon
        points={polygon(scoreVals)}
        fill={color + "33"}
        stroke={color}
        strokeWidth={2}
      />
      {scoreVals.map((v, i) => {
        const [x, y] = point(v, i);
        return <circle key={i} cx={x} cy={y} r={4} fill={color} />;
      })}
      {dimensions.map((d, i) => {
        const [x, y] = point(5.7, i);
        return (
          <text
            key={d.id}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={11}
            fontWeight={600}
            fill="#374151"
          >
            {d.label.length > 22 ? d.label.slice(0, 20) + "…" : d.label}
          </text>
        );
      })}
    </svg>
  );
}
