import { PeopleShell } from "./PeopleShell";
import RosterSkillGraph from "@/pages/roster/RosterSkillGraph";

export default function PeopleSkills() {
  return (
    <PeopleShell module="skills">
      <RosterSkillGraph />
    </PeopleShell>
  );
}
