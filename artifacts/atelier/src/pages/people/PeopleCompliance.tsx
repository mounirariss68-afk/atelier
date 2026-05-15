import { PeopleShell } from "./PeopleShell";
import RosterCompliance from "@/pages/roster/RosterCompliance";

export default function PeopleCompliance() {
  return (
    <PeopleShell module="compliance">
      <RosterCompliance />
    </PeopleShell>
  );
}
