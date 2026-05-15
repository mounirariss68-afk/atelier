import { useRoute, Link } from "wouter";
import { TabNav, TabNavLink, Card, MonoChip } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import RosterInvitations from "@/pages/roster/RosterInvitations";
import RosterOnboarding from "@/pages/roster/RosterOnboarding";

const SUBS = [
  { id: "preboard",     label: "Pre-boarding" },
  { id: "invitations",  label: "Invitations" },
  { id: "day-one",      label: "Day-1 plan" },
  { id: "equipment",    label: "Equipment" },
  { id: "attestations", label: "Attestations" },
];

export default function PeopleOnboard() {
  const [, params] = useRoute("/people/onboard/:section");
  const section = params?.section ?? "preboard";

  return (
    <PeopleShell stage="onboard">
      <LensPageHeader
        headline="Pre-boarding through day-one + first-week"
        lede="From accepted offer through equipment, day-1 plan, attestations and the first 90-day milestones."
      />
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/onboard/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "preboard" && <RosterOnboarding />}
          {section === "invitations" && <RosterInvitations />}
          {section === "day-one" && <DayOneView />}
          {section === "equipment" && <EquipmentView />}
          {section === "attestations" && <AttestationsView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function DayOneView() {
  const items = [
    { id: 1, label: "Welcome message + manager intro", owner: "Manager",   eta: "Day 0" },
    { id: 2, label: "Identity & SSO provisioned",      owner: "IT",        eta: "Day 0" },
    { id: 3, label: "Calendar holds: 1:1, all-hands",  owner: "Ops",       eta: "Day 1" },
    { id: 4, label: "Buddy assignment",                owner: "Manager",   eta: "Day 1" },
    { id: 5, label: "First read-out: practice playbook", owner: "Manager", eta: "Day 5" },
  ];
  return (
    <Card className="p-4">
      <ul className="divide-y divide-border-soft">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-text">{i.label}</span>
            <span className="font-mono text-xs text-text-faint">{i.owner} · {i.eta}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EquipmentView() {
  return (
    <Card className="p-4 text-sm text-text-mute">
      Laptop, YubiKey, and standard SaaS access kits are issued from the Operations bench.{" "}
      <Link href="/people/access" className="text-gold hover:underline">Open the Access matrix →</Link>
    </Card>
  );
}

function AttestationsView() {
  const list = [
    { id: "att-1", title: "Code of conduct",           required: true },
    { id: "att-2", title: "Confidentiality & IP",      required: true },
    { id: "att-3", title: "Data handling (UAE PDPL)", required: true },
    { id: "att-4", title: "AI usage guidelines",       required: false },
  ];
  return (
    <Card className="p-4">
      <ul className="space-y-2 text-sm">
        {list.map((a) => (
          <li key={a.id} className="flex items-center justify-between">
            <span className="text-text">{a.title}</span>
            <MonoChip tone={a.required ? "amber" : "default"}>{a.required ? "required" : "optional"}</MonoChip>
          </li>
        ))}
      </ul>
    </Card>
  );
}
