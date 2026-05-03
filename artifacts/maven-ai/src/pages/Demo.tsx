import { useParams, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import DemoExperience from "@/components/demo/DemoExperience";
import { getScenario } from "@/lib/sim/scenarios";
import { useLang, tStr } from "@/lib/lang";

/**
 * /demo/:slug route — full-screen interactive demo experience.
 *
 * Looks up the scenario for the slug and mounts the shared DemoExperience
 * shell. Falls back to a friendly "scenario not found" panel rather than
 * a 404 so the rest of the site's chrome is still reachable.
 */
export default function Demo() {
  const params = useParams();
  const slug = (params as { slug?: string }).slug ?? "";
  const scenario = getScenario(slug);
  const { lang } = useLang();

  if (!scenario) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0E2841] text-white p-6">
        <div className="max-w-md text-center space-y-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
            {tStr({ en: "Demo not found", ar: "العرض غير موجود" }, lang)}
          </p>
          <h1 className="text-2xl font-extrabold">
            {tStr(
              {
                en: "We don't have an interactive scenario registered for that slug.",
                ar: "لا يوجد سيناريو تفاعلي مسجّل لهذا المعرّف.",
              },
              lang,
            )}
          </h1>
          <p className="text-sm text-gray-300">
            {tStr(
              {
                en: "It may have been renamed or retired. Browse the marketplace to find the current tool.",
                ar: "قد يكون أُعيد تسميته أو سُحب. تصفّح السوق للعثور على الأداة الحالية.",
              },
              lang,
            )}
          </p>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#F5A623] text-[#0E2841] font-bold text-sm"
          >
            <ArrowLeft size={14} className="rtl:rotate-180" />
            {tStr({ en: "Back to marketplace", ar: "العودة للسوق" }, lang)}
          </Link>
        </div>
      </div>
    );
  }

  return <DemoExperience scenario={scenario} />;
}
