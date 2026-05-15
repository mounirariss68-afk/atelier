import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { KpiStrip } from "./dashboard/KpiStrip";
import { LifecycleFunnel } from "./dashboard/LifecycleFunnel";
import { WorkforceComposition } from "./dashboard/WorkforceComposition";
import { PerformanceDevelopment } from "./dashboard/PerformanceDevelopment";
import { RetentionEngagement } from "./dashboard/RetentionEngagement";
import { CompensationRewards } from "./dashboard/CompensationRewards";
import { LearningCompliance } from "./dashboard/LearningCompliance";
import { ActionQueue } from "./dashboard/ActionQueue";

export default function PeopleHome() {
  return (
    <PeopleShell>
      <LensPageHeader
        headline="The CHRO morning briefing"
        lede="Headcount, pipeline, performance, engagement, comp, learning and compliance — every signal that tells you how the people function is running today, in one screen."
      />
      <div
        className="container-atelier py-8 space-y-10"
        data-testid="people-dashboard"
      >
        <KpiStrip />
        <LifecycleFunnel />
        <WorkforceComposition />
        <PerformanceDevelopment />
        <RetentionEngagement />
        <CompensationRewards />
        <LearningCompliance />
        <ActionQueue />
      </div>
    </PeopleShell>
  );
}
