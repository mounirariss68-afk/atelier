import { useRoute } from "wouter";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { useEngagementSurveys, useFlightRisk, useInternalMobility, useStayInterviews } from "./peopleSeed";

const SUBS = [
  { id: "engagement", label: "Engagement" },
  { id: "flight-risk", label: "Flight risk" },
  { id: "mobility",   label: "Internal mobility" },
  { id: "stay",       label: "Stay interviews" },
];

export default function PeopleRetain() {
  const [, params] = useRoute("/people/retain/:section");
  const section = params?.section ?? "engagement";

  return (
    <PeopleShell stage="retain">
      <LensPageHeader
        headline="Engagement, flight risk, internal mobility, stay interviews"
        lede="The data and the conversations that keep the people the firm wants to keep."
      />
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/retain/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "engagement" && <EngagementView />}
          {section === "flight-risk" && <FlightRiskView />}
          {section === "mobility" && <MobilityView />}
          {section === "stay" && <StayView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function EngagementView() {
  const rows = useEngagementSurveys();
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((s) => (
        <Card key={s.id} className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-text font-medium">{s.cohort}</div>
            <MonoChip tone={s.enpsScore > 40 ? "green" : s.enpsScore > 20 ? "gold" : "amber"}>
              eNPS {s.enpsScore}
            </MonoChip>
          </div>
          <div className="text-xs text-text-faint mt-1">{s.participants} respondents · {s.capturedOn}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {s.topThemes.map((t) => <MonoChip key={t}>{t}</MonoChip>)}
          </div>
        </Card>
      ))}
    </div>
  );
}

function FlightRiskView() {
  const rows = useFlightRisk();
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <div className="text-text">{r.personName} <span className="text-text-faint text-xs">· {r.level}</span></div>
              <div className="text-xs text-text-mute mt-0.5">Signals: {r.signals.join(", ")}</div>
              <div className="text-xs text-text-faint mt-0.5">
                Owner · {r.ownerName} · last 1:1 {r.lastConversation ?? "—"}
              </div>
            </div>
            <MonoChip tone={r.riskScore > 0.6 ? "red" : r.riskScore > 0.4 ? "amber" : "default"}>
              {Math.round(r.riskScore * 100)}%
            </MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function MobilityView() {
  const rows = useInternalMobility();
  return (
    <div className="space-y-2">
      {rows.map((m) => (
        <Card key={m.id} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <div className="text-text">{m.personName}</div>
              <div className="text-xs text-text-mute mt-0.5">{m.fromRole} → <span className="text-text">{m.toRole}</span></div>
            </div>
            <MonoChip tone={m.status === "moved" ? "green" : m.status === "approved" ? "gold" : "default"}>{m.status}</MonoChip>
            {m.proposedStart && <span className="text-xs text-text-faint">start {m.proposedStart}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}

function StayView() {
  const rows = useStayInterviews();
  return (
    <div className="space-y-3">
      {rows.map((s) => (
        <Card key={s.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text font-medium">{s.personName}</div>
              <div className="text-xs text-text-faint">by {s.conductedBy} · {s.conductedOn}</div>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 mt-3 text-sm">
            <div>
              <div className="text-xs font-mono uppercase text-text-faint">Themes</div>
              <ul className="mt-1 text-text-mute list-disc pl-4">
                {s.themes.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-xs font-mono uppercase text-text-faint">Commitments</div>
              <ul className="mt-1 text-text-mute list-disc pl-4">
                {s.commitments.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
