import { PeopleShell } from "./PeopleShell";
import Timesheet from "@/pages/ledger/Timesheet";

export default function PeopleTime() {
  return (
    <PeopleShell module="time">
      <Timesheet />
    </PeopleShell>
  );
}
