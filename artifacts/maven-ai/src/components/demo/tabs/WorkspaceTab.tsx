import { FileText, Table2, Grid3x3, ListChecks, Users, ArrowRight } from "lucide-react";
import type { BiText, SimState, WorkspaceWidget } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  const Icon = KIND_ICON[widget.kind] ?? FileText;

  // Special case: april-status — render as a 3-card client status row,
  // spanning the full grid width. Skips the standard wrapper for a richer layout.
  if (widget.id === "april-status" && widget.kind === "metric-grid") {
    return (
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden lg:col-span-2">
        <div className="px-4 py-3 border-b border-gray-100 bg-[#F8F9FA] flex items-center gap-2">
          <Users size={14} className="text-[#156082]" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#0E2841]">
            {tStr(widget.title, lang)}
          </p>
        </div>
        <div className="p-4 grid sm:grid-cols-3 gap-3">
          {widget.rows.slice(1).map((row, i) => (
            <ClientStatusCard
              key={i}
              name={row[0]}
              count={row[1]}
              status={row[2]}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-[#F8F9FA] flex items-center gap-2">
        <Icon size={14} className="text-[#156082]" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#0E2841] flex-1">
          {tStr(widget.title, lang)}
        </p>
        {widget.id === "pending-changes" && widget.kind === "table" && (
          <button
            type="button"
            onClick={() =>
              toast({
                title: tStr(
                  {
                    en: "Bulk approval requires Payroll Manager authentication.",
                    ar: "يتطلّب الاعتماد الجماعي مصادقة مدير الرواتب.",
                  },
                  lang,
                ),
              })
            }
            className="text-[10px] font-bold uppercase tracking-widest text-[#196B24] hover:bg-[#196B24]/10 px-2.5 py-1 rounded border border-[#196B24]/40"
          >
            {tStr(
              {
                en: `Bulk Approve (${Math.max(0, widget.rows.length - 1)})`,
                ar: `اعتماد جماعي (${Math.max(0, widget.rows.length - 1)})`,
              },
              lang,
            )}
          </button>
        )}
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
                    {widget.id === "pending-changes" && (
                      <td className="px-2 py-1.5 border-b border-gray-100 text-end">
                        {i === 0 ? (
                          <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
                            {tStr({ en: "Action", ar: "إجراء" }, lang)}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              toast({
                                title: tStr(
                                  {
                                    en: "Opening employee record…",
                                    ar: "جارٍ فتح سجل الموظف…",
                                  },
                                  lang,
                                ),
                                description: tStr(row[0] ?? { en: "Item", ar: "عنصر" }, lang),
                              })
                            }
                            className="text-[11px] font-semibold text-[#156082] hover:text-[#0E2841] inline-flex items-center gap-1 hover:underline"
                          >
                            {tStr({ en: "Review", ar: "مراجعة" }, lang)}
                            <ArrowRight size={11} className="rtl:rotate-180" />
                          </button>
                        )}
                      </td>
                    )}
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

function ClientStatusCard({
  name,
  count,
  status,
}: {
  name?: BiText;
  count?: BiText;
  status?: BiText;
}) {
  const { lang } = useLang();
  return (
    <div className="rounded-lg border border-gray-200 p-4 bg-white">
      <p className="text-sm font-bold text-[#0E2841] leading-snug">
        {name ? tStr(name, lang) : "—"}
      </p>
      <div className="mt-3 flex items-baseline gap-2">
        <p className="text-2xl font-extrabold text-[#0E2841] tabular-nums">
          {count ? tStr(count, lang) : "0"}
        </p>
        <p className="text-[10px] uppercase tracking-widest text-gray-500">
          {tStr({ en: "employees", ar: "موظف" }, lang)}
        </p>
      </div>
      {status && (
        <div className="mt-3">
          <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
            {tStr(status, lang)}
          </span>
        </div>
      )}
    </div>
  );
}
