import { PeopleShell } from "./PeopleShell";
import RosterAccessMatrix from "@/pages/roster/RosterAccessMatrix";

export default function PeopleAccess() {
  return (
    <PeopleShell module="access">
      <RosterAccessMatrix />
    </PeopleShell>
  );
}
