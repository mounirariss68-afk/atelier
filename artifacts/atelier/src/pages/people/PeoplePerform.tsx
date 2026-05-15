import { useRoute, Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { PeopleShell } from "./PeopleShell";
import {
  useGoals, useCheckIns, useReviews, useCalibrationCohorts, useSuccession,
} from "./peopleSeed";
import { useCanSeeRewardAndSuccession } from "./peoplePerms";

const BASE_SUBS = [
  { id: "goals",       label: "Goals" },
  { id: "check-ins",   label: "Check-ins" },
  { id: "reviews",     label: "Reviews" },
  { id: "calibration", label: "Calibration" },
];
const SUCCESSION_SUB = { id: "succession",  label: "Succession" };

export default function PeoplePerform() {
  const [, params] = useRoute("/people/perform/:section");
  const section = params?.section ?? "goals";
  const { allowed: canSeeSuccession } = useCanSeeRewardAndSuccession();
  const SUBS = canSeeSuccession ? [...BASE_SUBS, SUCCESSION_SUB] : BASE_SUBS;

  return (
    <PeopleShell stage="perform">
      <PageHero>
        <SectionHead
          eyebrow={<MonoChip tone="gold">Perform</MonoChip>}
          headline="Goals, check-ins, reviews, calibration, succession"
          lede="The performance loop end-to-end — from goals set at the start of the cycle to calibrated ratings and succession depth at the end."
        />
      </PageHero>
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/perform/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "goals" && <GoalsView />}
          {section === "check-ins" && <CheckInsView />}
          {section === "reviews" && <ReviewsView />}
          {section === "calibration" && <CalibrationView />}
          {section === "succession" && (canSeeSuccession ? <SuccessionView /> : (
            <Card className="p-6 text-sm text-text-mute" data-testid="people-succession-restricted">
              <MonoChip tone="amber">Restricted</MonoChip>
              <div className="mt-2">Succession slates are visible to Partner and People-Ops Admin personas only.</div>
            </Card>
          ))}
        </div>
      </div>
    </PeopleShell>
  );
}

function GoalsView() {
  const rows = useGoals();
  return (
    <div className="space-y-2">
      {rows.map((g) => (
        <Card key={g.id} className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="text-text">{g.personName} <span className="text-text-faint text-xs">· {g.cycle}</span></div>
              <div className="text-sm text-text-mute mt-0.5">{g.goal}</div>
            </div>
            <MonoChip>{Math.round(g.weight * 100)}%</MonoChip>
            <MonoChip tone={g.status === "complete" ? "green" : g.status === "on-track" ? "gold" : g.status === "at-risk" ? "amber" : "red"}>
              {g.status}
            </MonoChip>
            <MonoChip>{g.evidenceCount} evid.</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function CheckInsView() {
  const rows = useCheckIns();
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-mute font-mono uppercase">
          <tr><th className="text-left py-2">Person</th><th className="text-left">Manager</th><th>When</th><th>Topics</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border-soft">
              <td className="py-2 text-text">{c.personName}</td>
              <td className="text-text-mute">{c.managerName}</td>
              <td className="text-center text-text">{c.scheduledFor}</td>
              <td className="text-center"><MonoChip>{c.topicCount}</MonoChip></td>
              <td className="text-center">
                <MonoChip tone={c.status === "completed" ? "green" : c.status === "scheduled" ? "gold" : "red"}>{c.status}</MonoChip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ReviewsView() {
  const rows = useReviews();
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-text">{r.personName} <span className="text-text-faint text-xs">· {r.cycle}</span></div>
              <div className="text-xs text-text-faint">due {r.dueOn}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <MonoChip>self · {r.selfRating ?? "—"}</MonoChip>
              <MonoChip tone={r.managerRating === "exceeds" ? "gold" : r.managerRating ? "green" : "default"}>
                mgr · {r.managerRating ?? "—"}
              </MonoChip>
              <MonoChip tone={r.status === "calibrated" ? "green" : r.status === "open" ? "amber" : "default"}>{r.status}</MonoChip>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function CalibrationView() {
  const rows = useCalibrationCohorts();
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-mute font-mono uppercase">
          <tr><th className="text-left py-2">Cohort</th><th>Pop.</th><th>Exceeds</th><th>Meets</th><th>Developing</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border-soft">
              <td className="py-2 text-text">{c.cohort}</td>
              <td className="text-center">{c.population}</td>
              <td className="text-center"><MonoChip tone="gold">{c.proposedExceeds}</MonoChip></td>
              <td className="text-center"><MonoChip tone="green">{c.proposedMeets}</MonoChip></td>
              <td className="text-center"><MonoChip tone="amber">{c.proposedDeveloping}</MonoChip></td>
              <td className="text-center">
                <MonoChip tone={c.status === "locked" ? "green" : c.status === "in-review" ? "gold" : "default"}>{c.status}</MonoChip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function SuccessionView() {
  const rows = useSuccession();
  return (
    <div className="space-y-3">
      {rows.map((s) => (
        <Card key={s.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text font-medium">{s.role}</div>
              <div className="text-xs text-text-faint">incumbent · {s.incumbent}</div>
            </div>
            <MonoChip tone={s.riskFlag === "low" ? "green" : s.riskFlag === "medium" ? "amber" : "red"}>
              risk · {s.riskFlag}
            </MonoChip>
          </div>
          <div className="grid gap-2 md:grid-cols-3 mt-3 text-sm">
            <div>
              <div className="text-xs font-mono uppercase text-text-faint">Ready now</div>
              <div className="text-text mt-1">{s.readyNow.join(", ") || "—"}</div>
            </div>
            <div>
              <div className="text-xs font-mono uppercase text-text-faint">1 year</div>
              <div className="text-text mt-1">{s.readyOneYear.join(", ") || "—"}</div>
            </div>
            <div>
              <div className="text-xs font-mono uppercase text-text-faint">2-3 years</div>
              <div className="text-text mt-1">{s.readyTwoToThreeYears.join(", ") || "—"}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
