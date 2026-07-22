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
  useAtelierListCheckIns,
  useAtelierCreateCheckIn,
  useAtelierUpdateCheckIn,
  getAtelierListCheckInsQueryKey,
} from "@workspace/api-client-react";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { PeopleEmptyState } from "./PeopleEmptyState";
import { useEmployeeOptions } from "./useEmployeeOptions";

const SUBS = [
  { id: "goals",       label: "Goals" },
  { id: "check-ins",   label: "Check-ins" },
  { id: "reviews",     label: "Reviews" },
  { id: "releases",    label: "Releases" },
];

export default function PeoplePerform() {
  const [, params] = useRoute("/people/perform/:section");
  const section = params?.section ?? "goals";

  return (
    <PeopleShell stage="perform">
      <LensPageHeader
        headline="Goals, check-ins, reviews"
        lede="The performance loop end-to-end — from goals set at the start of the cycle through check-ins to released reviews."
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
        </div>
      </div>
    </PeopleShell>
  );
}

function RestrictedCard({ testid, message }: { testid: string; message: string }) {
  return (
    <Card className="p-6 text-sm text-text-mute" data-testid={testid}>
      <MonoChip tone="amber">Restricted</MonoChip>
      <div className="mt-2">{message}</div>
    </Card>
  );
}

function GoalsView() {
  const { data: rows, isLoading, error } = useAtelierListPerformanceGoals();
  if (error) {
    return <RestrictedCard testid="goals-restricted" message="Goal records are managed by HR and partner-tier personas." />;
  }
  if (isLoading) return <p className="text-sm text-text-faint">Loading…</p>;
  if (!rows || rows.length === 0) {
    return <PeopleEmptyState message="No goals recorded yet. Set goals under the Releases tab to see them here." />;
  }
  return (
    <div className="space-y-2" data-testid="perform-goals-live">
      {rows.map((g) => (
        <Card key={g.id} className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-text">{g.employeeName} <span className="text-text-faint text-xs">· {g.cycle}</span></div>
              <div className="text-sm text-text-mute mt-0.5">{g.title}</div>
              {g.description ? <div className="text-xs text-text-faint mt-0.5 truncate">{g.description}</div> : null}
            </div>
            <MonoChip>{g.weightPct}%</MonoChip>
            <MonoChip tone={g.status === "complete" ? "green" : g.status === "on_track" ? "gold" : "amber"}>
              {g.status.replace("_", " ")}
            </MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function CheckInsView() {
  const qc = useQueryClient();
  const { data: rows, isLoading, error } = useAtelierListCheckIns();
  const { options: employees } = useEmployeeOptions();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListCheckInsQueryKey() });
  };
  const update = useAtelierUpdateCheckIn({ mutation: { onSuccess: invalidate } });
  if (error) {
    return <RestrictedCard testid="check-ins-restricted" message="Check-in records are managed by HR and partner-tier personas." />;
  }
  return (
    <div className="space-y-6" data-testid="perform-check-ins">
      <NewCheckInForm employees={employees} onSaved={invalidate} />
      {isLoading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <PeopleEmptyState message="No check-ins logged yet — schedule one above." />
      ) : (
        <Card className="p-4">
          <table className="w-full text-sm">
            <thead className="text-xs text-text-mute font-mono uppercase">
              <tr><th className="text-left py-2">Person</th><th className="text-left">Manager</th><th>When</th><th className="text-left">Notes</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-border-soft" data-testid={`check-in-${c.id}`}>
                  <td className="py-2 text-text">{c.employeeName}</td>
                  <td className="text-text-mute">{c.managerName || "—"}</td>
                  <td className="text-center text-text whitespace-nowrap px-2">{c.scheduledFor}</td>
                  <td className="text-text-mute text-xs max-w-[240px] truncate">{c.notes || "—"}</td>
                  <td className="text-center">
                    <select
                      className="rounded border border-border bg-transparent px-2 py-1 text-xs text-text"
                      value={c.status}
                      onChange={(e) =>
                        update.mutate({
                          id: c.id,
                          data: { status: e.target.value as "scheduled" | "completed" | "missed" },
                        })
                      }
                      data-testid={`check-in-status-${c.id}`}
                    >
                      <option value="scheduled">scheduled</option>
                      <option value="completed">completed</option>
                      <option value="missed">missed</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function NewCheckInForm({
  employees,
  onSaved,
}: {
  employees: { id: string; fullName: string }[];
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = React.useState("");
  const [managerName, setManagerName] = React.useState("");
  const [scheduledFor, setScheduledFor] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const create = useAtelierCreateCheckIn({
    mutation: {
      onSuccess: () => {
        setManagerName(""); setScheduledFor(""); setNotes("");
        onSaved();
      },
    },
  });
  return (
    <Card className="p-4 space-y-2" data-testid="new-check-in-form">
      <h3 className="text-sm font-semibold text-text">Log a check-in</h3>
      <div className="grid grid-cols-2 gap-2">
        <select className={inputCls} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} data-testid="check-in-employee">
          <option value="">Select employee…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
        </select>
        <input className={inputCls} type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} data-testid="check-in-date" />
      </div>
      <select className={inputCls} value={managerName} onChange={(e) => setManagerName(e.target.value)} data-testid="check-in-manager">
        <option value="">Run by (manager / partner)…</option>
        {employees.map((e) => <option key={e.id} value={e.fullName}>{e.fullName}</option>)}
      </select>
      <textarea className={inputCls} rows={2} placeholder="Topics / notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button
        className={btnCls}
        disabled={!employeeId || !scheduledFor || create.isPending}
        onClick={() =>
          create.mutate({
            data: {
              employeeId,
              scheduledFor,
              managerName: managerName.trim() || undefined,
              notes: notes.trim() || undefined,
            },
          })
        }
        data-testid="check-in-save"
      >
        Save check-in
      </button>
      {create.error ? <p className="text-xs text-red-400">Could not save the check-in.</p> : null}
    </Card>
  );
}

function ReviewsView() {
  const { data: rows, isLoading, error } = useAtelierListPerformanceReviews();
  if (error) {
    return <RestrictedCard testid="reviews-restricted" message="Review records are managed by HR and partner-tier personas." />;
  }
  if (isLoading) return <p className="text-sm text-text-faint">Loading…</p>;
  if (!rows || rows.length === 0) {
    return <PeopleEmptyState message="No review cycles yet. Draft and release reviews from the Releases tab." />;
  }
  return (
    <div className="space-y-2" data-testid="perform-reviews-live">
      {rows.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-text">{r.employeeName} <span className="text-text-faint text-xs">· {r.cycle}</span></div>
              {r.reviewedOn ? <div className="text-xs text-text-faint">reviewed {r.reviewedOn}</div> : null}
            </div>
            <div className="flex items-center gap-1.5">
              <MonoChip>self · {r.selfRating ?? "—"}</MonoChip>
              <MonoChip tone={r.managerRating === "exceeds" ? "gold" : r.managerRating ? "green" : "default"}>
                mgr · {r.managerRating ?? "—"}
              </MonoChip>
              <MonoChip tone={r.status === "released" ? "green" : "amber"}>{r.status}</MonoChip>
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

