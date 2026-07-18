import { useRoute, Link } from "wouter";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { UserPlus } from "lucide-react";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { useReferrals } from "@/lib/v5-hooks";

const SUBS = [
  { id: "plan",      label: "Workforce plan" },
  { id: "brand",     label: "Employer brand" },
  { id: "sourcing",  label: "Sourcing" },
  { id: "referrals", label: "Referrals" },
];

export default function PeopleAttract() {
  const [, params] = useRoute("/people/attract/:section");
  const section = params?.section ?? "plan";

  return (
    <PeopleShell stage="attract">
      <LensPageHeader
        headline="Workforce plan, employer brand, sourcing, referrals"
        lede="The top of the funnel: where the firm decides what it needs, makes itself known, and surfaces candidates the recruiting workspace can act on."
      />
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/attract/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "plan" && <PlanView />}
          {section === "brand" && <BrandView />}
          {section === "sourcing" && <SourcingView />}
          {section === "referrals" && <ReferralsView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function PlanView() {
  const rows = [
    { practice: "Pricing",         openRoles: 3, planned: 5, gap: 2 },
    { practice: "Research",        openRoles: 1, planned: 2, gap: 1 },
    { practice: "Platform & AI",   openRoles: 2, planned: 4, gap: 2 },
    { practice: "Operations",      openRoles: 0, planned: 1, gap: 1 },
  ];
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-mute font-mono uppercase">
          <tr><th className="text-left py-2">Practice</th><th>Open</th><th>Plan</th><th>Gap</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.practice} className="border-t border-border-soft">
              <td className="py-2 text-text">{r.practice}</td>
              <td className="text-center text-text">{r.openRoles}</td>
              <td className="text-center text-text">{r.planned}</td>
              <td className="text-center"><MonoChip tone={r.gap > 1 ? "amber" : "default"}>{r.gap}</MonoChip></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function BrandView() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card className="p-4">
        <div className="text-xs font-mono uppercase text-text-mute">Careers site</div>
        <div className="mt-1 text-text">cognirise.work/careers — 1,284 visits / 30d</div>
        <div className="mt-2 text-sm text-text-mute">Last edited 2026-04-29 by Yara H.</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs font-mono uppercase text-text-mute">Press & content</div>
        <Link href="/press" className="mt-1 inline-block text-gold hover:underline">Open The Press →</Link>
        <div className="mt-2 text-sm text-text-mute">Editorial calendar drives top-of-funnel signal.</div>
      </Card>
    </div>
  );
}

function SourcingView() {
  return (
    <Card className="p-4 text-sm text-text-mute">
      <div className="text-text font-medium">Pursuit Scout — recruiting mode</div>
      <p className="mt-2">Sourced candidates land in the Hire workspace under Candidate CRM. Scout runs nightly across configured channels (LinkedIn, alumni, referrals, partner-firm bench).</p>
      <Link href="/people/hire/candidates" className="mt-3 inline-block text-gold hover:underline">Open Candidate CRM →</Link>
    </Card>
  );
}

function ReferralsView() {
  const REFERRALS = useReferrals();
  if (REFERRALS.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="referrals-empty">
        No referrals recorded yet.
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2"><UserPlus className="w-4 h-4" />Internal referrals.</p>
      {REFERRALS.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-text">{r.referrer} → {r.candidate}</div>
              <div className="text-xs text-text-faint">{r.via} · for {r.roleTitle}</div>
            </div>
            <MonoChip tone={r.status === "hired" ? "gold" : r.status === "interviewing" ? "green" : "default"}>{r.status}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}
