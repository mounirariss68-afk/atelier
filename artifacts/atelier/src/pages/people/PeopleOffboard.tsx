import { useRoute } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { PeopleShell } from "./PeopleShell";
import RosterOffboarding from "@/pages/roster/RosterOffboarding";

const SUBS = [
  { id: "queue",     label: "Offboarding queue" },
  { id: "knowledge", label: "Knowledge transfer" },
  { id: "access",    label: "Access revocation" },
  { id: "exit",      label: "Exit conversation" },
];

export default function PeopleOffboard() {
  const [, params] = useRoute("/people/offboard/:section");
  const section = params?.section ?? "queue";

  return (
    <PeopleShell stage="offboard">
      <PageHero>
        <SectionHead
          eyebrow={<MonoChip tone="gold">Offboard</MonoChip>}
          headline="Resignation through final access revocation"
          lede="The closing chapter — knowledge transfer, access revocation, exit conversation, alumni status."
        />
      </PageHero>
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/offboard/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "queue" && <RosterOffboarding />}
          {section === "knowledge" && <KnowledgeView />}
          {section === "access" && <AccessRevView />}
          {section === "exit" && <ExitView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function KnowledgeView() {
  const items = [
    { id: 1, label: "Active engagement handoffs",      detail: "Per-engagement transition memo + receiving owner." },
    { id: 2, label: "Repository ownership transfers",  detail: "Code, docs and dashboards reassigned in IP catalog." },
    { id: 3, label: "Client-relationship handoff",     detail: "Warm intros from departing partner." },
  ];
  return (
    <Card className="p-4">
      <ul className="divide-y divide-border-soft">
        {items.map((i) => (
          <li key={i.id} className="py-2">
            <div className="text-text">{i.label}</div>
            <div className="text-sm text-text-mute">{i.detail}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccessRevView() {
  return (
    <Card className="p-4 text-sm text-text-mute">
      Access revocation runs from the firm Access matrix on the configured last day. Final revocation is
      always partner-acknowledged.
    </Card>
  );
}

function ExitView() {
  return (
    <Card className="p-4 text-sm text-text-mute">
      Structured exit-conversation template lives here, with confidential summary visible only to the People Ops + Partner.
    </Card>
  );
}
