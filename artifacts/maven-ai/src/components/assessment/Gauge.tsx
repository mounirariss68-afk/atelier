interface GaugeProps {
  score: number;
  max?: number;
  color: string;
  label?: string;
  size?: number;
}

export default function Gauge({ score, max = 5, color, label, size = 220 }: GaugeProps) {
  const pct = Math.max(0, Math.min(1, score / max));
  const r = size / 2 - 16;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = Math.PI * r;
  const dash = circumference * pct;

  return (
    <div className="relative inline-block" style={{ width: size, height: size / 1.6 }}>
      <svg width={size} height={size / 1.6} viewBox={`0 0 ${size} ${size / 1.6}`}>
        <path
          d={`M 16 ${cy} A ${r} ${r} 0 0 1 ${size - 16} ${cy}`}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={14}
          strokeLinecap="round"
        />
        <path
          d={`M 16 ${cy} A ${r} ${r} 0 0 1 ${size - 16} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray 1s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
        <p className="text-4xl font-extrabold" style={{ color }}>
          {score.toFixed(1)}
        </p>
        <p className="text-xs text-gray-500 font-medium">{label || `out of ${max}`}</p>
      </div>
    </div>
  );
}
