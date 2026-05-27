import type { UvrUseCaseResult } from "@workspace/assessments";

interface Props {
  useCases: UvrUseCaseResult[];
  color: string;
}

export default function UvrPortfolio({ useCases, color }: Props) {
  const size = 480;
  const pad = 56;
  const inner = size - pad * 2;
  const sx = (v: number) => pad + ((v - 1) / 4) * inner;
  const sy = (v: number) => size - pad - ((v - 1) / 4) * inner;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block mx-auto">
      {/* quadrants */}
      <rect x={pad} y={pad} width={inner / 2} height={inner / 2} fill="#FFFAF0" />
      <rect x={pad + inner / 2} y={pad} width={inner / 2} height={inner / 2} fill="#ECFDF5" />
      <rect x={pad} y={pad + inner / 2} width={inner / 2} height={inner / 2} fill="#FEF2F2" />
      <rect x={pad + inner / 2} y={pad + inner / 2} width={inner / 2} height={inner / 2} fill="#FEFCE8" />
      <line x1={pad + inner / 2} y1={pad} x2={pad + inner / 2} y2={size - pad} stroke="#9CA3AF" strokeDasharray="4 4" />
      <line x1={pad} y1={pad + inner / 2} x2={size - pad} y2={pad + inner / 2} stroke="#9CA3AF" strokeDasharray="4 4" />
      {/* axes */}
      <line x1={pad} y1={size - pad} x2={size - pad} y2={size - pad} stroke="#374151" strokeWidth={2} />
      <line x1={pad} y1={pad} x2={pad} y2={size - pad} stroke="#374151" strokeWidth={2} />
      <text x={pad + inner / 4} y={pad + 16} textAnchor="middle" fontWeight={700} fontSize={11} fill="#92400e">
        STRATEGIC BETS
      </text>
      <text x={pad + (3 * inner) / 4} y={pad + 16} textAnchor="middle" fontWeight={700} fontSize={11} fill="#065F46">
        QUICK WINS
      </text>
      <text x={pad + inner / 4} y={size - pad - 8} textAnchor="middle" fontWeight={700} fontSize={11} fill="#7F1D1D">
        AVOID
      </text>
      <text x={pad + (3 * inner) / 4} y={size - pad - 8} textAnchor="middle" fontWeight={700} fontSize={11} fill="#854D0E">
        PARK
      </text>
      <text x={size / 2} y={size - 12} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">
        Readiness →
      </text>
      <text x={16} y={size / 2} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151" transform={`rotate(-90, 16, ${size / 2})`}>
        Value →
      </text>
      {useCases.map((uc, i) => {
        const x = sx(uc.readinessScore);
        const y = sy(uc.valueScore);
        const radius = 12 + uc.effort * 4;
        return (
          <g key={uc.id}>
            <circle cx={x} cy={y} r={radius} fill={color + "44"} stroke={color} strokeWidth={2} />
            <text x={x} y={y + 4} textAnchor="middle" fontWeight={700} fontSize={12} fill="#0A1230">
              {i + 1}
            </text>
            <text x={x} y={y + radius + 14} textAnchor="middle" fontSize={11} fontWeight={600} fill="#374151">
              {uc.name.length > 18 ? uc.name.slice(0, 16) + "…" : uc.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
