import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { KpiStrip } from "./dashboard/KpiStrip";
import { WorkforceComposition } from "./dashboard/WorkforceComposition";

export default function PeopleHome() {
  return (
    <PeopleShell>
      <LensPageHeader
        backHref="/"
        backLabel="Home"
        headline="The CHRO morning briefing"
        lede="Headcount and workforce composition — the signals that tell you how the people function is running today, in one screen."
      />
      <div
        className="container-atelier py-8 space-y-10"
        data-testid="people-dashboard"
      >
        <KpiStrip />
        <WorkforceComposition />
      </div>
    </PeopleShell>
  );
}
