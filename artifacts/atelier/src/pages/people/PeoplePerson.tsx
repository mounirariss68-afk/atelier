import { PeopleShell } from "./PeopleShell";
import RosterPerson from "@/pages/roster/RosterPerson";

export default function PeoplePerson() {
  return (
    <PeopleShell module="people">
      <RosterPerson />
    </PeopleShell>
  );
}
