import { useParams, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import DemoExperience from "@/components/demo/DemoExperience";
import BusinessDashboard from "@/components/demo/arcelik/BusinessDashboard";
import DealerPortal from "@/components/demo/arcelik/DealerPortal";
import ClientPortalShell from "@/components/demo/tasama/ClientPortalShell";
import ManagerDashboardShell from "@/components/demo/tasama/ManagerDashboardShell";
import { TasamaDemoLangProvider } from "@/components/demo/tasama/DemoLangContext";
import Cockpit from "@/components/demo/personal-agent/Cockpit";
import Mind from "@/components/demo/personal-agent/Mind";
import ProgrammeWarRoomConsole from "@/components/demo/programme-war-room/Console";
import BenefitsCockpit from "@/components/demo/value-realization/BenefitsCockpit";
import { getScenario } from "@/lib/sim/scenarios";
import { useLocation } from "wouter";
import { useLang, tStr } from "@/lib/lang";
import { ArcelikDataProvider } from "@/hooks/useArcelikData";
import { TasamaDataProvider } from "@/hooks/useTasamaData";

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

  if (slug === "tasama-payroll-hub" && variant === "client") {
    return (
      <TasamaDemoLangProvider>
        <TasamaDataProvider variant="client">
          <ClientPortalShell />
        </TasamaDataProvider>
      </TasamaDemoLangProvider>
    );
  }

  if (slug === "tasama-payroll-hub" && variant === "manager") {
    return (
      <TasamaDemoLangProvider>
        <TasamaDataProvider variant="manager">
          <ManagerDashboardShell />
        </TasamaDataProvider>
      </TasamaDemoLangProvider>
    );
  }

  // Maven Personal Agent has two purpose-built demos that bypass the generic
  // scenario engine because they need a chat surface and a graph viz that
  // don't fit DemoExperience's "agent trace + workspace widgets" template.
  if (slug === "maven-personal-agent" && variant === "cockpit") {
    return <Cockpit />;
  }
  if (slug === "maven-personal-agent" && variant === "mind") {
    return <Mind />;
  }

  if (slug === "programme-war-room" && variant === "console") {
    return <ProgrammeWarRoomConsole />;
  }

  // Value Realization "CFO Benefits Cockpit" — second user-facing variant
  // alongside the "teknik" agent cockpit handled by the scenario engine.
  if (slug === "value-realization" && variant === "cockpit") {
    return <ValueRealizationCockpitRoute />;
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

function ValueRealizationCockpitRoute() {
  const [, navigate] = useLocation();
  return (
    <BenefitsCockpit
      marketplaceSlug="value-realization"
      onSwitchView={() => navigate("/demo/value-realization/teknik")}
    />
  );
}
