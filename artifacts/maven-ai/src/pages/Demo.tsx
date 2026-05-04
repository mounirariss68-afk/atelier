import { useParams, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import DemoExperience from "@/components/demo/DemoExperience";
import BusinessDashboard from "@/components/demo/arcelik/BusinessDashboard";
import DealerPortal from "@/components/demo/arcelik/DealerPortal";
import { getScenario } from "@/lib/sim/scenarios";
import { useLang, tStr } from "@/lib/lang";
import { ArcelikDataProvider } from "@/hooks/useArcelikData";

export default function Demo() {
  const params = useParams();
  const slug = (params as { slug?: string }).slug ?? "";
  const variant = (params as { variant?: string }).variant;

  if (slug === "arcelik-fiyat-istihbarati" && variant === "dashboard") {
    return (
      <ArcelikDataProvider>
        <BusinessDashboard />
      </ArcelikDataProvider>
    );
  }

  if (slug === "arcelik-fiyat-istihbarati" && variant === "bayi") {
    return (
      <ArcelikDataProvider variant="dealer">
        <DealerPortal />
      </ArcelikDataProvider>
    );
  }

  const scenario = getScenario(slug, variant);
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
