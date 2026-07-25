/**
 * MeHome — Task #50: the self-service "Me" lens.
 *
 * One page, section tabs (Overview · Profile · Time · Expenses ·
 * Pay & Benefits · Performance · Learning). Everything rendered here is
 * self-scope: the server's /me/* routes only ever answer for the caller's
 * own identity, so this page is safe for every persona — and it is the
 * ONLY page the self-only personas (employee / contractor) can use.
 */
import * as React from "react";
import { useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMyProfile,
  useAtelierGetMyApprovals,
  useAtelierListMyNotifications,
  useAtelierDismissMyNotification,
  getAtelierListMyNotificationsQueryKey,
  useAtelierListMyReviews,
  useAtelierListMyGoals,
  useAtelierGetMyPerformance,
  useAtelierListMyLearning,
  useAtelierCompleteMyTraining,
  getAtelierListMyLearningQueryKey,
  type AtelierSelfProfile,
} from "@workspace/api-client-react";
import {
  Card,
  MonoChip,
  TabNav,
  TabNavLink,
} from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import MePay from "./MePay";
// Task #53 — self-service Time (timesheet grid + leave) and Expenses tabs.
import MeTime from "./MeTime";
import type { TimesheetWeekMeta } from "@/pages/ledger/Timesheet";
import MeExpenses from "./MeExpenses";
// Task #51 — self-service profile section (edit details, docs, dependents…)
import MeProfileSection from "./MeProfileSection";
// Task #159 — self-scope contract records panel.
import { ContractsPanel } from "@/components/contracts/ContractsPanel";
import { MyMeetingsCard } from "@/components/ms/MsMeetings";
// Task #386 — EA delegation: partner "My delegates" + EA "Assist" tabs.
import MeDelegates from "./MeDelegates";
import MeAssist from "./MeAssist";

const SECTIONS = [
  { id: "overview", label: "Overview", href: "/me" },
  { id: "profile", label: "Profile", href: "/me/profile" },
  { id: "time", label: "Time", href: "/me/time" },
  { id: "expenses", label: "Expenses", href: "/me/expenses" },
  { id: "pay", label: "Pay & Benefits", href: "/me/pay" },
  { id: "performance", label: "Performance", href: "/me/performance" },
  { id: "learning", label: "Learning", href: "/me/learning" },
  { id: "delegates", label: "Delegates", href: "/me/delegates" },
  { id: "assist", label: "Assist", href: "/me/assist" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function MeHome() {
  const [, params] = useRoute("/me/:section");
  // Task #679 — chat cards historically linked to /me/documents, which is
  // not a tab; personal documents live inside Profile. Alias it so old
  // links (and any cached chat sessions) land on the right section.
  const rawSection = params?.section ?? "overview";
  const section = (rawSection === "documents" ? "profile" : rawSection) as SectionId;
  const { data: profile, isLoading } = useAtelierGetMyProfile();

  const firstName = profile?.user?.name?.split(/\s+/)[0] ?? "";
  // Contractors have no performance section — reviews & goals are an
  // employee-only surface (the server 403s them too).
  const isContractor =
    profile?.person?.workerType === "contractor" ||
    profile?.user?.role === "contractor";
  // Task #386 — Delegates is a partner-only surface (partners grant scoped
  // delegations to EAs); Assist is the EA workspace, shown to the self-only
  // personas (employees/contractors — the page explains itself when the
  // caller isn't a designated EA).
  const role = profile?.user?.role;
  const isPartnerRole = role === "partner" || role === "founding_partner";
  const isSelfOnlyRole = role === "employee" || role === "contractor";
  const sections = SECTIONS.filter((s) => {
    if (isContractor && s.id === "performance") return false;
    if (s.id === "delegates") return isPartnerRole;
    if (s.id === "assist") return isSelfOnlyRole;
    return true;
  });

  // Time tab: ONE header. The Timesheet grid reports its loaded week up
  // here so the page hero reads "Timesheet — 2026-W29" (instead of the
  // generic workspace hero plus a second navy band inside the tab).
  const [weekMeta, setWeekMeta] = React.useState<TimesheetWeekMeta | null>(null);
  const onWeekMeta = React.useCallback((m: TimesheetWeekMeta | null) => setWeekMeta(m), []);

  // ONE header per page: the headline names the current section (the
  // top-bar lens tabs are the single menu), never a generic greeting on
  // sub-pages. Time is special — the Timesheet grid reports its loaded
  // week up so the hero reads "Timesheet — 2026-W29".
  const hero = (() => {
    switch (section) {
      case "time":
        return {
          headline: weekMeta ? `Timesheet — ${weekMeta.weekIso}` : "Timesheet",
          lede: weekMeta
            ? `${weekMeta.personName} · week of ${weekMeta.weekStartDate}`
            : "Your hours this week, plus leave requests.",
        };
      case "profile":
        return {
          headline: "Profile",
          lede: "Your personal details, documents and dependents — keep them current.",
        };
      case "expenses":
        return {
          headline: "Expenses",
          lede: "Submit claims, attach receipts and track reimbursements.",
        };
      case "pay":
        return {
          headline: "Pay & Benefits",
          lede: "Your compensation, payslips and benefits at the firm.",
        };
      case "performance":
        return {
          headline: "Performance",
          lede: "Your reviews, goals and feedback across cycles.",
        };
      case "learning":
        return {
          headline: "Learning",
          lede: "Assigned training and your completion record.",
        };
      case "delegates":
        return {
          headline: "My delegates",
          lede: "Delegate timesheets, expenses and meeting notes to an Executive Assistant — and review what they entered on your behalf.",
        };
      case "assist":
        return {
          headline: "Assist",
          lede: "Enter timesheets, expenses and meeting notes on behalf of the partners who delegated to you.",
        };
      default:
        return {
          headline: firstName ? `Your workspace, ${firstName}` : "Your workspace",
          lede: "Your profile, time, expenses, pay, performance and learning — everything about you at the firm, in one place.",
        };
    }
  })();

  return (
    <div className="animate-in fade-in" data-testid="me-home">
      <LensPageHeader headline={hero.headline} lede={hero.lede} />
      <div className="container-atelier py-6 space-y-6">
        {/* The top navy bar's lens-section tabs are the ONE Me menu on
            desktop. They're hidden below lg, so this in-page strip stays
            as the small-screen fallback only. */}
        <div className="lg:hidden">
          <TabNav>
            {sections.map((s) => (
              <TabNavLink key={s.id} href={s.href} active={section === s.id}>
                {s.label}
              </TabNavLink>
            ))}
          </TabNav>
        </div>
        <div className="mt-4">
          {section === "overview" && <OverviewSection loading={isLoading} profile={profile} />}
          {section === "profile" && <MeProfileSection loading={isLoading} profile={profile} />}
          {section === "time" && <MeTime onWeekMeta={onWeekMeta} />}
          {section === "expenses" && <MeExpenses />}
          {section === "pay" && <MePay />}
          {section === "performance" &&
            (isContractor ? (
              <Card className="p-6 text-sm text-text-mute" data-testid="me-performance-restricted">
                Performance reviews are an employee-only section.
              </Card>
            ) : (
              <PerformanceSection />
            ))}
          {section === "learning" && <LearningSection />}
          {section === "delegates" && <MeDelegates />}
          {section === "assist" && <MeAssist />}
        </div>
      </div>
    </div>
  );
}

type Profile = AtelierSelfProfile | undefined;

function OverviewSection({ loading, profile }: { loading: boolean; profile: Profile }) {
  return (
    <div className="space-y-6">
      <PendingApprovalsCard />
      <NotificationCards />
      {/* Task #327 — the viewer's Microsoft 365 meetings, also on Home. */}
      <MyMeetingsCard />
      {/* Task #159 — the caller's own contract records (NDA, employment…).
          Uses the /me/contracts route: employee/contractor personas are
          server-gated to /me/*, so the generic list endpoint would 403. */}
      <ContractsPanel mine title="My contracts" emptyText="No contracts on file for you." />
      <div className="grid gap-4 md:grid-cols-2">
        <IdentityCard loading={loading} profile={profile} compact />
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-text mb-2">Quick actions</h3>
          <ul className="space-y-2 text-sm text-text-mute">
            <li>· Review your <a className="text-gold hover:underline" href="/me/profile">profile</a> and check your details are current.</li>
            <li>· Track your hours in <a className="text-gold hover:underline" href="/me/time">Time</a>.</li>
            <li>· Submit a claim in <a className="text-gold hover:underline" href="/me/expenses">Expenses</a>.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/**
 * PendingApprovalsCard — Task #78. Surfaces items waiting on the SIGNED-IN
 * user's approval (timesheets, leave, expenses) so requests don't stall
 * while approvers wait for someone to visit the queue pages. The server
 * answers strictly for the caller's approval scope; non-approvers get
 * total=0 and see nothing.
 */
function PendingApprovalsCard() {
  const { data, isLoading } = useAtelierGetMyApprovals();
  if (isLoading || !data || data.total === 0) return null;
  const stale = data.items.filter((i) => i.stale);
  const fresh = data.items.filter((i) => !i.stale);
  const catLine = [
    data.categories.timesheets.count > 0 ? `${data.categories.timesheets.count} timesheet${data.categories.timesheets.count === 1 ? "" : "s"}` : null,
    data.categories.leave.count > 0 ? `${data.categories.leave.count} leave request${data.categories.leave.count === 1 ? "" : "s"}` : null,
    data.categories.expenses.count > 0 ? `${data.categories.expenses.count} expense claim${data.categories.expenses.count === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  const ItemRow = ({ item, staleRow }: { item: (typeof data.items)[number]; staleRow?: boolean }) => (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0 flex items-center gap-2">
        <MonoChip tone={staleRow ? "red" : "gold"}>{item.kind}</MonoChip>
        <span className="truncate text-text">{item.title}</span>
        <span className="shrink-0 text-text-faint">— {item.personName}</span>
      </div>
      <div className="shrink-0 flex items-center gap-3">
        <span className={`font-mono text-[10px] uppercase tracking-wider ${staleRow ? "text-red-400" : "text-text-faint"}`}>
          {item.ageDays === 0 ? "today" : `${item.ageDays}d waiting`}
        </span>
        <a href={item.href} className="text-xs text-gold hover:underline">
          Review →
        </a>
      </div>
    </li>
  );

  return (
    <Card className="p-4 border-gold/40" data-testid="me-pending-approvals">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text">Waiting on your approval</h3>
          <span
            className="inline-flex items-center justify-center rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-gold"
            data-testid="me-pending-approvals-count"
          >
            {data.total}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-faint">{catLine}</span>
      </div>
      {stale.length > 0 ? (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3" data-testid="me-pending-approvals-stale">
          <p className="font-mono text-[10px] uppercase tracking-wider text-red-400">
            {stale.length} item{stale.length === 1 ? "" : "s"} waiting more than {data.staleAfterDays} days
          </p>
          <ul className="mt-1 divide-y divide-border-soft">
            {stale.map((i) => (
              <ItemRow key={`${i.kind}-${i.id}`} item={i} staleRow />
            ))}
          </ul>
        </div>
      ) : null}
      {fresh.length > 0 ? (
        <ul className="mt-2 divide-y divide-border-soft">
          {fresh.map((i) => (
            <ItemRow key={`${i.kind}-${i.id}`} item={i} />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function NotificationCards() {
  const qc = useQueryClient();
  const { data: notifications, isLoading } = useAtelierListMyNotifications();
  const dismiss = useAtelierDismissMyNotification({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAtelierListMyNotificationsQueryKey() });
      },
    },
  });

  if (isLoading) return null;
  if (!notifications || notifications.length === 0) {
    return (
      <Card className="p-4 text-sm text-text-mute" data-testid="me-notifications-empty">
        You're all caught up — nothing needs your attention right now.
      </Card>
    );
  }
  return (
    <div className="space-y-3" data-testid="me-notifications">
      {notifications.map((n) => (
        <Card key={n.id} className="p-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MonoChip tone="gold">{n.kind}</MonoChip>
              <h4 className="text-sm font-semibold text-text truncate">{n.title}</h4>
            </div>
            {n.body ? <p className="mt-1 text-sm text-text-mute">{n.body}</p> : null}
            {n.href ? (
              <a href={n.href} className="mt-1 inline-block text-xs text-gold hover:underline">
                Open →
              </a>
            ) : null}
          </div>
          <button
            className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text transition-colors"
            onClick={() => dismiss.mutate({ id: n.id })}
            disabled={dismiss.isPending}
            data-testid={`dismiss-${n.id}`}
          >
            Dismiss
          </button>
        </Card>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-faint">{label}</span>
      <span className="text-text">{value ?? "—"}</span>
    </div>
  );
}

function IdentityCard({ loading, profile, compact }: { loading: boolean; profile: Profile; compact?: boolean }) {
  const u = profile?.user;
  return (
    <Card className="p-4" data-testid="me-identity-card">
      <h3 className="text-sm font-semibold text-text mb-2">Identity</h3>
      {loading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : u ? (
        <div className="divide-y divide-border-soft">
          <Field label="Name" value={u.name} />
          <Field label="Email" value={u.email} />
          <Field label="Role" value={u.roleLabel} />
          {!compact && <Field label="Title" value={u.title} />}
        </div>
      ) : (
        <p className="text-sm text-text-mute">Could not load your identity.</p>
      )}
    </Card>
  );
}

function RosterCard({ loading, profile }: { loading: boolean; profile: Profile }) {
  const p = profile?.person;
  return (
    <Card className="p-4" data-testid="me-roster-card">
      <h3 className="text-sm font-semibold text-text mb-2">Employment</h3>
      {loading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : p ? (
        <div className="divide-y divide-border-soft">
          <Field label="Worker type" value={<MonoChip tone="gold">{p.workerType}</MonoChip>} />
          <Field label="Title" value={p.title} />
          <Field label="Start date" value={p.startDate} />
          <Field label="Type" value={p.employmentType} />
          <Field label="Office" value={p.homeOffice} />
          <Field label="Country" value={p.country} />
          <Field label="Status" value={p.status} />
        </div>
      ) : (
        <p className="text-sm text-text-mute">
          No roster record is linked to your login yet. Ask HR to link your
          profile from the People lens.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------
// Task #55 — My Performance (released reviews + goals, employees only)
// ---------------------------------------------------------------
function PerformanceSection() {
  const { data: reviews, isLoading: loadingReviews } = useAtelierListMyReviews();
  const { data: goals, isLoading: loadingGoals } = useAtelierListMyGoals();
  const { data: perf, isLoading: loadingPerf } = useAtelierGetMyPerformance();
  return (
    <div className="space-y-6" data-testid="me-performance">
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">Utilization</h3>
        {loadingPerf ? (
          <p className="text-sm text-text-faint">Loading…</p>
        ) : !perf || perf.weeksTracked === 0 ? (
          <Card className="p-4 text-sm text-text-mute" data-testid="me-performance-metrics-empty">
            No tracked weeks yet — utilization appears once your timesheets are in.
          </Card>
        ) : (
          <Card className="p-4" data-testid="me-performance-metrics">
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">Utilization (12w)</div>
                <div className="text-text text-lg font-medium mt-0.5">
                  {perf.utilizationPct != null ? `${perf.utilizationPct}%` : "—"}
                  {perf.utilizationTargetPct != null ? (
                    <span className="text-xs text-text-faint"> / target {perf.utilizationTargetPct}%</span>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">Billable hours (12w)</div>
                <div className="text-text text-lg font-medium mt-0.5">{perf.billableHours12w}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">Total hours (12w)</div>
                <div className="text-text text-lg font-medium mt-0.5">{perf.totalHours12w}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">Seniority</div>
                <div className="text-text text-lg font-medium mt-0.5">{perf.seniority ?? "—"}</div>
              </div>
            </div>
          </Card>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">Released reviews</h3>
        {loadingReviews ? (
          <p className="text-sm text-text-faint">Loading…</p>
        ) : !reviews || reviews.length === 0 ? (
          <Card className="p-4 text-sm text-text-mute" data-testid="me-reviews-empty">
            No released reviews yet. Reviews appear here once HR releases them
            to you at the end of a cycle.
          </Card>
        ) : (
          <div className="space-y-3" data-testid="me-reviews">
            {reviews.map((r) => (
              <Card key={r.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-text font-medium">{r.cycle}</div>
                  <div className="flex items-center gap-1.5">
                    <MonoChip>self · {r.selfRating ?? "—"}</MonoChip>
                    <MonoChip tone="gold">mgr · {r.managerRating ?? "—"}</MonoChip>
                  </div>
                </div>
                {r.reviewedOn ? (
                  <div className="text-xs text-text-faint">reviewed {r.reviewedOn}</div>
                ) : null}
                {r.managerSummary ? (
                  <p className="text-sm text-text-mute">{r.managerSummary}</p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2 text-sm">
                  {r.strengths ? (
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">Strengths</div>
                      <p className="text-text-mute mt-1">{r.strengths}</p>
                    </div>
                  ) : null}
                  {r.growthAreas ? (
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-text-faint">Growth areas</div>
                      <p className="text-text-mute mt-1">{r.growthAreas}</p>
                    </div>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">Goals</h3>
        {loadingGoals ? (
          <p className="text-sm text-text-faint">Loading…</p>
        ) : !goals || goals.length === 0 ? (
          <Card className="p-4 text-sm text-text-mute" data-testid="me-goals-empty">
            No goals set for you yet.
          </Card>
        ) : (
          <div className="space-y-2" data-testid="me-goals">
            {goals.map((g) => (
              <Card key={g.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-text">
                      {g.title} <span className="text-text-faint text-xs">· {g.cycle}</span>
                    </div>
                    {g.description ? (
                      <div className="text-sm text-text-mute mt-0.5">{g.description}</div>
                    ) : null}
                  </div>
                  <MonoChip>{g.weightPct}%</MonoChip>
                  <MonoChip
                    tone={
                      g.status === "complete" ? "green" : g.status === "on_track" ? "gold" : "amber"
                    }
                  >
                    {g.status.replace("_", " ")}
                  </MonoChip>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Task #55 — My Learning (audience-targeted training library)
// ---------------------------------------------------------------
function LearningSection() {
  const qc = useQueryClient();
  const { data: materials, isLoading } = useAtelierListMyLearning();
  const complete = useAtelierCompleteMyTraining({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAtelierListMyLearningQueryKey() });
      },
    },
  });

  if (isLoading) return <p className="text-sm text-text-faint">Loading…</p>;
  if (!materials || materials.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="me-learning-empty">
        No training materials have been shared with you yet. HR curates the
        library — new items will show up here automatically.
      </Card>
    );
  }
  return (
    <div className="space-y-2" data-testid="me-learning">
      {materials.map((m) => (
        <Card key={m.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-text font-medium truncate">{m.title}</span>
                {m.topic ? <MonoChip>{m.topic}</MonoChip> : null}
                {m.completed ? <MonoChip tone="green">completed</MonoChip> : null}
              </div>
              {m.description ? (
                <p className="mt-1 text-sm text-text-mute">{m.description}</p>
              ) : null}
              <div className="mt-2 flex items-center gap-3">
                {m.kind === "link" && m.url ? (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gold hover:underline"
                    data-testid={`learning-open-${m.id}`}
                  >
                    Open link →
                  </a>
                ) : null}
                {m.kind === "file" ? (
                  <a
                    href={`/api/atelier/me/learning/${m.id}/download`}
                    className="text-xs text-gold hover:underline"
                    data-testid={`learning-download-${m.id}`}
                  >
                    Download {m.fileName ?? "file"} →
                  </a>
                ) : null}
              </div>
            </div>
            {!m.completed ? (
              <button
                className="shrink-0 px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider border border-border text-text-mute hover:text-text hover:border-gold transition-colors"
                onClick={() => complete.mutate({ id: m.id })}
                disabled={complete.isPending}
                data-testid={`learning-complete-${m.id}`}
              >
                Mark complete
              </button>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

function PlaceholderSection({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-6" data-testid={`me-section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <h3 className="text-sm font-semibold text-text mb-2">{title}</h3>
      <p className="text-sm text-text-mute max-w-prose">{body}</p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-text-faint">
        Coming soon — this space is reserved for your self-service {title.toLowerCase()} tools.
      </p>
    </Card>
  );
}
