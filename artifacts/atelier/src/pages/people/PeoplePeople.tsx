import { PeopleShell } from "./PeopleShell";
import RosterPeople from "@/pages/roster/RosterPeople";

export default function PeoplePeople() {
  return (
    <PeopleShell module="people">
      <RosterPeople />
    </PeopleShell>
  );
}
