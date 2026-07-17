import { useRoute } from "wouter";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { useCompBands, useCompReview, useRecognition } from "./peopleSeed";
import { useCanSeeRewardAndSuccession } from "./peoplePerms";
import { PayDocsAdminView, BankChangesAdminView } from "./PeoplePayAdmin";

const SUBS = [
  { id: "bands",        label: "Comp bands" },
  { id: "review",       label: "Comp review" },
  { id: "rewards",      label: "Total rewards" },
  { id: "recognition",  label: "Recognition" },
  { id: "paydocs",      label: "Pay documents" },
  { id: "bankchanges",  label: "Bank changes" },
];

export default function PeopleReward() {
  const [, params] = useRoute("/people/reward/:section");
  const section = params?.section ?? "bands";
  const { allowed, loading } = useCanSeeRewardAndSuccession();

  if (loading) {
    return <PeopleShell stage="reward"><div className="container-atelier py-12 text-text-mute">Loading…</div></PeopleShell>;
  }

  if (!allowed) {
    return (
      <PeopleShell stage="reward">
        <LensPageHeader
          eyebrow="Manage · People · Reward · Restricted"
          headline="Reward is Partner/Admin only"
          lede="Compensation bands, comp-review pipelines and total-rewards detail are visible to Partner and People-Ops Admin personas only. Recognition flows visible to your role live on the home stream."
        />
        <div className="container-atelier py-6">
          <Card className="p-6 text-sm text-text-mute" data-testid="people-reward-restricted">
            Ask your People Ops partner if you need a specific comp record reviewed.
          </Card>
        </div>
      </PeopleShell>
    );
  }

  return (
    <PeopleShell stage="reward">
      <LensPageHeader
        headline="Comp bands, comp review, total rewards, recognition"
        lede="Compensation policy applied: who's in band, who's drifting, and where carry/bonus and recognition land in the cycle."
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
          {section === "bands" && <BandsView />}
          {section === "review" && <ReviewView />}
          {section === "rewards" && <TotalRewardsView />}
          {section === "recognition" && <RecognitionView />}
          {section === "paydocs" && <PayDocsAdminView />}
          {section === "bankchanges" && <BankChangesAdminView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function BandsView() {
  const rows = useCompBands();
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-mute font-mono uppercase">
          <tr>
            <th className="text-left py-2">Level</th>
            <th>Jurisdiction</th><th>p25</th><th>p50</th><th>p75</th><th>Bonus</th><th>Carry</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className="border-t border-border-soft">
              <td className="py-2 text-text">{b.level}</td>
              <td className="text-center text-text-mute">{b.jurisdiction}</td>
              <td className="text-center text-text">${b.baseP25K}K</td>
              <td className="text-center text-text">${b.baseP50K}K</td>
              <td className="text-center text-text">${b.baseP75K}K</td>
              <td className="text-center text-text-mute">{b.bonusTargetPct}%</td>
              <td className="text-center">
                <MonoChip tone={b.carryEligible ? "gold" : "default"}>{b.carryEligible ? "yes" : "—"}</MonoChip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ReviewView() {
  const rows = useCompReview();
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="text-text">{r.personName}</div>
              <div className="text-xs text-text-mute mt-0.5">{r.rationale}</div>
            </div>
            <MonoChip>${r.currentBaseK}K → ${r.proposedBaseK}K</MonoChip>
            <MonoChip tone={r.deltaPct > 10 ? "gold" : "default"}>+{r.deltaPct.toFixed(1)}%</MonoChip>
            <MonoChip>{r.bandPosition}</MonoChip>
            <MonoChip tone={r.status === "approved" ? "green" : r.status === "submitted" ? "gold" : "default"}>{r.status}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function TotalRewardsView() {
  const cards = [
    { id: "tr-1", label: "Base + bonus + carry",     desc: "Cash + equity-style upside in one summary." },
    { id: "tr-2", label: "Healthcare & wellbeing",   desc: "Family cover, mental-health budget." },
    { id: "tr-3", label: "Learning budget",          desc: "$3,000/yr per person, plus conference travel." },
    { id: "tr-4", label: "Sabbatical",               desc: "Unpaid 4-12 weeks after 4 years." },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.map((c) => (
        <Card key={c.id} className="p-4">
          <div className="text-text font-medium">{c.label}</div>
          <div className="mt-1 text-sm text-text-mute">{c.desc}</div>
        </Card>
      ))}
    </div>
  );
}

function RecognitionView() {
  const rows = useRecognition();
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1">
              <div className="text-text">{r.givenBy} → {r.givenTo}</div>
              <div className="text-sm text-text-mute mt-0.5 italic">"{r.citation}"</div>
            </div>
            <MonoChip tone="gold">{r.category}</MonoChip>
            <span className="text-xs text-text-faint">{r.awardedOn}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
