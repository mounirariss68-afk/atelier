import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { KpiValue, SimState } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

export default function KpisTab({ state }: { state: SimState }) {
  const { lang } = useLang();
  return (
    <section className="space-y-4">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#0E2841]">
          {tStr(
            {
              en: "Performance Metrics — April 2026",
              ar: "مؤشرات الأداء — أبريل 2026",
            },
            lang,
          )}
        </p>
      </header>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {state.kpis.map((k) => (
          <KpiCard key={k.id} kpi={k} />
        ))}
      </div>
    </section>
  );
}

function KpiCard({ kpi }: { kpi: KpiValue }) {
  const { lang } = useLang();
  const k = kpi;
  // Movement direction (sign of delta) — independent of "what's good".
  const movement: "up" | "down" | "flat" = !k.delta
    ? "flat"
    : k.delta.startsWith("-")
      ? "down"
      : k.delta.startsWith("+") || k.delta.startsWith("↑")
        ? "up"
        : "flat";
  const Icon =
    movement === "up" ? TrendingUp : movement === "down" ? TrendingDown : Minus;

  // Colour: improvement direction tells us whether "up" is good. When unset,
  // fall back to the legacy heuristic (up=good, down=bad).
  const direction = k.improvementDirection ?? "up";
  let color = "#666";
  if (movement !== "flat") {
    if (direction === "neutral") {
      color = "#666";
    } else {
      const good =
        (direction === "up" && movement === "up") ||
        (direction === "down" && movement === "down");
      color = good ? "#196B24" : "#D9534F";
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">
        {tStr(k.label, lang)}
      </p>
      <p className="text-3xl font-extrabold text-[#0E2841] tabular-nums">{k.value}</p>
      {k.delta && (
        <div
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold w-fit"
          style={{ color }}
        >
          <Icon size={12} />
          <span>{k.delta}</span>
        </div>
      )}
      {k.source && (
        <p className="mt-3 pt-3 border-t border-gray-100 text-[10px] text-gray-500 leading-relaxed">
          {tStr(k.source, lang)}
        </p>
      )}
    </div>
  );
}
