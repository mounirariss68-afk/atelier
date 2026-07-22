import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import RosterOffboarding from "@/pages/roster/RosterOffboarding";

export default function PeopleOffboard() {
  return (
    <PeopleShell stage="offboard">
      <LensPageHeader
        headline="Offboarding queue"
        lede="The closing chapter — people in offboarding, their last day and the tasks that must clear before access is revoked."
      />
      <div className="container-atelier py-6 space-y-6">
        <RosterOffboarding />
      </div>
    </PeopleShell>
  );
}
