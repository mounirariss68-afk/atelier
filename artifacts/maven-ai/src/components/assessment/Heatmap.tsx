interface Respondent {
  name: string;
  role: string;
  overall: number;
  dimensionScores: Record<string, number>;
}

interface Props {
  dimensions: { id: string; title: { en: string; ar: string } }[];
  respondents: Respondent[];
  variance: Record<string, number>;
  lang: import("@/lib/lang").Lang;
}

const cellColor = (v: number) => {
  if (v >= 4.5) return "bg-emerald-600 text-white";
  if (v >= 3.8) return "bg-emerald-400 text-white";
  if (v >= 3.0) return "bg-amber-300 text-gray-800";
  if (v >= 2.0) return "bg-[#F5A623] text-white";
  return "bg-red-500 text-white";
};

export default function Heatmap({ dimensions, respondents, variance, lang }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2">
              {lang === "ar" ? "المشارك" : "Respondent"}
            </th>
            {dimensions.map((d) => (
              <th key={d.id} className="text-xs font-semibold text-gray-500 px-2 py-2 align-bottom">
                <div className="rotate-[-30deg] origin-bottom-left whitespace-nowrap inline-block">
                  {d.title[lang === "ar" ? "ar" : "en"] || d.title.en}
                </div>
              </th>
            ))}
            <th className="text-xs font-semibold text-gray-500 px-2 py-2">
              {lang === "ar" ? "إجمالي" : "Overall"}
            </th>
          </tr>
        </thead>
        <tbody>
          {respondents.map((r, i) => (
            <tr key={i}>
              <td className="text-sm font-medium text-[#0E2841] px-3 py-2 whitespace-nowrap">
                {r.name}
                <div className="text-xs text-gray-500 font-normal">{r.role}</div>
              </td>
              {dimensions.map((d) => {
                const v = r.dimensionScores[d.id] ?? 0;
                return (
                  <td key={d.id} className={`text-center text-sm font-bold rounded-md px-3 py-3 ${cellColor(v)}`}>
                    {v.toFixed(1)}
                  </td>
                );
              })}
              <td className={`text-center text-sm font-bold rounded-md px-3 py-3 ${cellColor(r.overall)}`}>
                {r.overall.toFixed(1)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2">
            <td className="text-xs font-bold text-gray-600 uppercase px-3 py-2">
              {lang === "ar" ? "تباين" : "Variance"}
            </td>
            {dimensions.map((d) => {
              const v = variance[d.id] ?? 0;
              const cls = v > 0.6 ? "bg-red-100 text-red-700" : v > 0.3 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
              return (
                <td key={d.id} className={`text-center text-xs font-semibold rounded px-2 py-2 ${cls}`}>
                  {v.toFixed(2)}
                </td>
              );
            })}
            <td />
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs text-gray-500">
        {lang === "ar"
          ? "التباين الأعلى من 0.6 يدل على عدم توافق على مستوى أصحاب المصلحة."
          : "Variance >0.6 indicates stakeholder misalignment on that dimension."}
      </p>
    </div>
  );
}
