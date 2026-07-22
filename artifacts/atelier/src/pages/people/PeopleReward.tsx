import { useRoute } from "wouter";
import { Card, TabNav, TabNavLink } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { useCanSeeReward } from "./peoplePerms";
import { PayDocsAdminView, BankChangesAdminView } from "./PeoplePayAdmin";

const SUBS = [
  { id: "paydocs",      label: "Pay documents" },
  { id: "bankchanges",  label: "Bank changes" },
];

export default function PeopleReward() {
  const [, params] = useRoute("/people/reward/:section");
  const section = params?.section ?? "paydocs";
  const { allowed, loading } = useCanSeeReward();

  if (loading) {
    return <PeopleShell stage="reward"><div className="container-atelier py-12 text-text-mute">Loading…</div></PeopleShell>;
  }

  if (!allowed) {
    return (
      <PeopleShell stage="reward">
        <LensPageHeader
          eyebrow="Manage · People · Reward · Restricted"
          headline="Reward is Partner/Admin only"
          lede="Pay documents and bank-detail changes are visible to Partner and People-Ops Admin personas only."
        />
        <div className="container-atelier py-6">
          <Card className="p-6 text-sm text-text-mute" data-testid="people-reward-restricted">
            Ask your People Ops partner if you need a specific pay record reviewed.
          </Card>
        </div>
      </PeopleShell>
    );
  }

  return (
    <PeopleShell stage="reward">
      <LensPageHeader
        headline="Pay documents and bank changes"
        lede="Payslips and pay documents issued to each person, and the bank-detail changes awaiting review."
      />
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/reward/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "paydocs" && <PayDocsAdminView />}
          {section === "bankchanges" && <BankChangesAdminView />}
        </div>
      </div>
    </PeopleShell>
  );
}
