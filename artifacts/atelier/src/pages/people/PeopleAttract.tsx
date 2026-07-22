import { useRoute, Link } from "wouter";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { UserPlus } from "lucide-react";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { useReferrals } from "@/lib/v5-hooks";
import { useAtelierListHireRoles } from "@workspace/api-client-react";

const SUBS = [
  { id: "plan",      label: "Workforce plan" },
  { id: "referrals", label: "Referrals" },
];

export default function PeopleAttract() {
  const [, params] = useRoute("/people/attract/:section");
  const section = params?.section ?? "plan";

  return (
    <PeopleShell stage="attract">
      <LensPageHeader
        headline="Workforce plan and referrals"
        lede="The top of the funnel: where the firm decides what it needs and surfaces candidates the recruiting workspace can act on."
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
          {section === "referrals" && <ReferralsView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function PlanView() {
  const { data, isLoading, error } = useAtelierListHireRoles();
  if (error) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="workforce-plan-restricted">
        The workforce plan is visible to HR and partner-tier personas.
      </Card>
    );
  }
  if (isLoading) return <p className="text-sm text-text-faint">Loading…</p>;

  const roles = data?.items ?? [];
  const openRoles = roles.filter((r) => r.status === "open");

  if (openRoles.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="workforce-plan-empty">
        No open positions yet. Open roles in the Hire workspace and the headcount gap per practice appears here.
        <Link href="/people/hire/roles" className="mt-3 inline-block text-gold hover:underline">Open Hire →</Link>
      </Card>
    );
  }

  // Minimal workforce plan: headcount gap per practice (grouped by level as
  // the closest available dimension on hire roles) vs open roles.
  const byPractice = new Map<string, { open: number; candidates: number }>();
  for (const r of openRoles) {
    const key = r.level?.trim() || "Unspecified";
    const cur = byPractice.get(key) ?? { open: 0, candidates: 0 };
    cur.open += 1;
    cur.candidates += r.activeCandidates ?? 0;
    byPractice.set(key, cur);
  }
  const rows = Array.from(byPractice.entries()).sort((a, b) => b[1].open - a[1].open);

  return (
    <div className="space-y-4" data-testid="workforce-plan">
      <p className="text-sm text-text-mute">
        {openRoles.length} open position(s) across {rows.length} practice group(s). The gap is the number of
        open roles still to be filled per practice.
      </p>
      <Card className="p-4">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-mute font-mono uppercase">
            <tr>
              <th className="text-left py-2">Practice</th>
              <th>Open roles (gap)</th>
              <th>Active candidates</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([practice, stat]) => (
              <tr key={practice} className="border-t border-border-soft" data-testid={`workforce-plan-row-${practice}`}>
                <td className="py-2 text-text">{practice}</td>
                <td className="text-center"><MonoChip tone={stat.open > 0 ? "gold" : "default"}>{stat.open}</MonoChip></td>
                <td className="text-center text-text-mute">{stat.candidates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Link href="/people/hire/candidates" className="inline-block text-gold hover:underline">Open Candidates →</Link>
    </div>
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
