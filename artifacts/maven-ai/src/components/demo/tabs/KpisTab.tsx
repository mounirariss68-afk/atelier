import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { SimState } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

export default function KpisTab({ state }: { state: SimState }) {
  const { lang } = useLang();
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {state.kpis.map((k) => {
        const direction = k.delta?.startsWith("-")
          ? "down"
          : k.delta?.startsWith("+") || k.delta?.startsWith("↑")
            ? "up"
            : "flat";
        const Icon =
          direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
        const color =
          direction === "up" ? "#196B24" : direction === "down" ? "#D9534F" : "#666";
        return (
          <div
            key={k.id}
            className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">
              {tStr(k.label, lang)}
            </p>
            <p className="text-3xl font-extrabold text-[#0E2841] tabular-nums">
              {k.value}
            </p>
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
      })}
    </div>
  );
}
