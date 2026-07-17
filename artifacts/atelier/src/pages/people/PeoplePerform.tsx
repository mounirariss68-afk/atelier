import * as React from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListPerformanceReviews,
  useAtelierCreatePerformanceReview,
  useAtelierUpdatePerformanceReview,
  useAtelierReleasePerformanceReview,
  getAtelierListPerformanceReviewsQueryKey,
  useAtelierListPerformanceGoals,
  useAtelierCreatePerformanceGoal,
  useAtelierUpdatePerformanceGoal,
  getAtelierListPerformanceGoalsQueryKey,
} from "@workspace/api-client-react";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import {
  useGoals, useCheckIns, useReviews, useCalibrationCohorts, useSuccession,
} from "./peopleSeed";
import { useCanSeeRewardAndSuccession } from "./peoplePerms";
import { useEmployeeOptions } from "./useEmployeeOptions";

const BASE_SUBS = [
  { id: "goals",       label: "Goals" },
  { id: "check-ins",   label: "Check-ins" },
  { id: "reviews",     label: "Reviews" },
  { id: "releases",    label: "Releases" },
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
      <LensPageHeader
        headline="Goals, check-ins, reviews, calibration, succession"
        lede="The performance loop end-to-end — from goals set at the start of the cycle to calibrated ratings and succession depth at the end."
      />
      <div className="container-atelier py-6 space-y-6">
        <Card className="p-4 flex flex-wrap items-center gap-3" data-testid="perform-composition-entry">
          <div className="flex-1 min-w-[260px]">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">Composition</div>
            <div className="text-text mt-0.5">Team composition — who do we have?</div>
            <p className="text-xs text-text-mute mt-1">
              Demographics, languages, hard- and soft-skills, performance mix and tenure across the firm.
            </p>
          </div>
          <Link
            href="/people/composition"
            className="px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-gold text-bg hover:opacity-90"
            data-testid="link-composition"
          >
            Open dashboard →
          </Link>
        </Card>
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
          {section === "releases" && <ReleasesView />}
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

// ---------------------------------------------------------------
// Task #55 — Releases: the REAL review + goal records behind the Me lens.
// Draft reviews stay HR-side; releasing one makes it visible on the
// employee's own Performance page.
// ---------------------------------------------------------------
const inputCls =
  "w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold";
const btnCls =
  "px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-gold text-bg hover:opacity-90 disabled:opacity-50";

function ReleasesView() {
  const qc = useQueryClient();
  const { data: reviews, isLoading, error } = useAtelierListPerformanceReviews();
  const { data: goals } = useAtelierListPerformanceGoals();
  const { options: employees } = useEmployeeOptions();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListPerformanceReviewsQueryKey() });
    void qc.invalidateQueries({ queryKey: getAtelierListPerformanceGoalsQueryKey() });
  };
  const release = useAtelierReleasePerformanceReview({ mutation: { onSuccess: invalidate } });
  const updateGoal = useAtelierUpdatePerformanceGoal({ mutation: { onSuccess: invalidate } });

  if (error) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="releases-restricted">
        <MonoChip tone="amber">Restricted</MonoChip>
        <div className="mt-2">Review & goal records are managed by HR and partner-tier personas.</div>
      </Card>
    );
  }
  return (
    <div className="space-y-6" data-testid="perform-releases">
      <div className="grid gap-4 lg:grid-cols-2">
        <NewReviewForm employees={employees} onSaved={invalidate} />
        <NewGoalForm employees={employees} onSaved={invalidate} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">Review records</h3>
        {isLoading ? (
          <p className="text-sm text-text-faint">Loading…</p>
        ) : !reviews || reviews.length === 0 ? (
          <Card className="p-4 text-sm text-text-mute">No review records yet — draft one above.</Card>
        ) : (
          <div className="space-y-2">
            {reviews.map((r) => (
              <Card key={r.id} className="p-3" data-testid={`release-review-${r.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-text truncate">
                      {r.employeeName} <span className="text-text-faint text-xs">· {r.cycle}</span>
                    </div>
                    <div className="text-xs text-text-faint mt-0.5">
                      self · {r.selfRating ?? "—"} · mgr · {r.managerRating ?? "—"}
                      {r.hrNotes ? " · HR notes on file" : ""}
                    </div>
                  </div>
                  <MonoChip tone={r.status === "released" ? "green" : "amber"}>{r.status}</MonoChip>
                  <button
                    className={btnCls}
                    disabled={release.isPending}
                    onClick={() =>
                      release.mutate({ id: r.id, data: { released: r.status !== "released" } })
                    }
                    data-testid={`release-toggle-${r.id}`}
                  >
                    {r.status === "released" ? "Pull back" : "Release"}
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">Goal records</h3>
        {!goals || goals.length === 0 ? (
          <Card className="p-4 text-sm text-text-mute">No goal records yet.</Card>
        ) : (
          <div className="space-y-2">
            {goals.map((g) => (
              <Card key={g.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-text truncate">
                      {g.employeeName} <span className="text-text-faint text-xs">· {g.cycle}</span>
                    </div>
                    <div className="text-sm text-text-mute mt-0.5 truncate">{g.title}</div>
                  </div>
                  <MonoChip>{g.weightPct}%</MonoChip>
                  <select
                    className="rounded border border-border bg-transparent px-2 py-1 text-xs text-text"
                    value={g.status}
                    onChange={(e) =>
                      updateGoal.mutate({
                        id: g.id,
                        data: { status: e.target.value as "on_track" | "at_risk" | "complete" },
                      })
                    }
                    data-testid={`goal-status-${g.id}`}
                  >
                    <option value="on_track">on track</option>
                    <option value="at_risk">at risk</option>
                    <option value="complete">complete</option>
                  </select>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewReviewForm({
  employees,
  onSaved,
}: {
  employees: { id: string; fullName: string }[];
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = React.useState("");
  const [cycle, setCycle] = React.useState("");
  const [selfRating, setSelfRating] = React.useState("");
  const [managerRating, setManagerRating] = React.useState("");
  const [managerSummary, setManagerSummary] = React.useState("");
  const [strengths, setStrengths] = React.useState("");
  const [growthAreas, setGrowthAreas] = React.useState("");
  const [hrNotes, setHrNotes] = React.useState("");
  const create = useAtelierCreatePerformanceReview({
    mutation: {
      onSuccess: () => {
        setCycle(""); setSelfRating(""); setManagerRating("");
        setManagerSummary(""); setStrengths(""); setGrowthAreas(""); setHrNotes("");
        onSaved();
      },
    },
  });
  return (
    <Card className="p-4 space-y-2" data-testid="new-review-form">
      <h3 className="text-sm font-semibold text-text">Draft a review</h3>
      <select className={inputCls} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} data-testid="review-employee">
        <option value="">Select employee…</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
      </select>
      <input className={inputCls} placeholder="Cycle (e.g. FY26 H1)" value={cycle} onChange={(e) => setCycle(e.target.value)} data-testid="review-cycle" />
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Self rating" value={selfRating} onChange={(e) => setSelfRating(e.target.value)} />
        <input className={inputCls} placeholder="Manager rating" value={managerRating} onChange={(e) => setManagerRating(e.target.value)} />
      </div>
      <textarea className={inputCls} rows={2} placeholder="Manager summary (visible to the employee once released)" value={managerSummary} onChange={(e) => setManagerSummary(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <textarea className={inputCls} rows={2} placeholder="Strengths" value={strengths} onChange={(e) => setStrengths(e.target.value)} />
        <textarea className={inputCls} rows={2} placeholder="Growth areas" value={growthAreas} onChange={(e) => setGrowthAreas(e.target.value)} />
      </div>
      <textarea className={inputCls} rows={2} placeholder="HR notes (never shown to the employee)" value={hrNotes} onChange={(e) => setHrNotes(e.target.value)} data-testid="review-hr-notes" />
      <button
        className={btnCls}
        disabled={!employeeId || !cycle.trim() || create.isPending}
        onClick={() =>
          create.mutate({
            data: {
              employeeId, cycle: cycle.trim(),
              selfRating: selfRating.trim() || undefined,
              managerRating: managerRating.trim() || undefined,
              managerSummary: managerSummary.trim() || undefined,
              strengths: strengths.trim() || undefined,
              growthAreas: growthAreas.trim() || undefined,
              hrNotes: hrNotes.trim() || undefined,
            },
          })
        }
        data-testid="review-save"
      >
        Save draft
      </button>
      {create.error ? <p className="text-xs text-red-400">Could not save the review draft.</p> : null}
    </Card>
  );
}

function NewGoalForm({
  employees,
  onSaved,
}: {
  employees: { id: string; fullName: string }[];
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = React.useState("");
  const [cycle, setCycle] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [weightPct, setWeightPct] = React.useState("");
  const create = useAtelierCreatePerformanceGoal({
    mutation: {
      onSuccess: () => {
        setCycle(""); setTitle(""); setDescription(""); setWeightPct("");
        onSaved();
      },
    },
  });
  const weight = Number(weightPct);
  return (
    <Card className="p-4 space-y-2" data-testid="new-goal-form">
      <h3 className="text-sm font-semibold text-text">Set a goal</h3>
      <select className={inputCls} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} data-testid="goal-employee">
        <option value="">Select employee…</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
      </select>
      <input className={inputCls} placeholder="Cycle (e.g. FY26 H1)" value={cycle} onChange={(e) => setCycle(e.target.value)} />
      <input className={inputCls} placeholder="Goal title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="goal-title" />
      <textarea className={inputCls} rows={2} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <input className={inputCls} placeholder="Weight % (0–100)" value={weightPct} onChange={(e) => setWeightPct(e.target.value)} />
      <button
        className={btnCls}
        disabled={!employeeId || !cycle.trim() || !title.trim() || create.isPending}
        onClick={() =>
          create.mutate({
            data: {
              employeeId, cycle: cycle.trim(), title: title.trim(),
              description: description.trim() || undefined,
              weightPct: Number.isFinite(weight) && weight >= 0 && weight <= 100 ? weight : undefined,
            },
          })
        }
        data-testid="goal-save"
      >
        Save goal
      </button>
      {create.error ? <p className="text-xs text-red-400">Could not save the goal.</p> : null}
    </Card>
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
