import { FileText, Table2, Grid3x3, ListChecks } from "lucide-react";
import type { SimState, WorkspaceWidget } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

const KIND_ICON = {
  doc: FileText,
  table: Table2,
  "metric-grid": Grid3x3,
  list: ListChecks,
} as const;

export default function WorkspaceTab({ state }: { state: SimState }) {
  const { lang } = useLang();
  if (state.workspace.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
        <FileText size={28} className="mx-auto mb-3 text-gray-300" />
        <p className="text-sm">
          {tStr(
            {
              en: "Workspace is empty. The agents will draft documents, tables, and metrics here as they work.",
              ar: "مساحة العمل فارغة. سيقوم الوكلاء بصياغة الوثائق والجداول والمقاييس هنا أثناء العمل.",
            },
            lang,
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {state.workspace.map((w) => (
        <Widget key={w.id} widget={w} />
      ))}
    </div>
  );
}

function Widget({ widget }: { widget: WorkspaceWidget }) {
  const { lang } = useLang();
  const Icon = KIND_ICON[widget.kind] ?? FileText;
  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-[#F8F9FA] flex items-center gap-2">
        <Icon size={14} className="text-[#156082]" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#0E2841]">
          {tStr(widget.title, lang)}
        </p>
      </div>
      <div className="p-4">
        {widget.kind === "doc" && (
          <div className="space-y-2 text-sm text-gray-700 leading-relaxed">
            {widget.rows.map((row, i) => (
              <p key={i}>{row.map((c) => tStr(c, lang)).join(" ")}</p>
            ))}
          </div>
        )}
        {widget.kind === "table" && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {widget.rows.map((row, i) => (
                  <tr key={i} className={i === 0 ? "bg-[#F8F9FA]" : ""}>
                    {row.map((c, j) => (
                      <td
                        key={j}
                        className={`px-2 py-1.5 border-b border-gray-100 ${
                          i === 0 ? "font-bold text-[#0E2841]" : "text-gray-700"
                        }`}
                      >
                        {tStr(c, lang)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {widget.kind === "metric-grid" && (
          <div className="grid grid-cols-2 gap-3">
            {widget.rows.map((row, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-100 p-3"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  {tStr(row[0] ?? { en: "", ar: "" }, lang)}
                </p>
                <p className="text-lg font-bold text-[#0E2841] mt-1">
                  {tStr(row[1] ?? { en: "—", ar: "—" }, lang)}
                </p>
                {row[2] && (
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {tStr(row[2], lang)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {widget.kind === "list" && (
          <ul className="space-y-2">
            {widget.rows.map((row, i) => (
              <li key={i} className="flex gap-2 items-start text-sm text-gray-700">
                <span className="w-1.5 h-1.5 rounded-full bg-[#156082] mt-2 flex-shrink-0" />
                <span>{row.map((c) => tStr(c, lang)).join(" — ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
