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
  useAtelierListMyNotifications,
  useAtelierDismissMyNotification,
  getAtelierListMyNotificationsQueryKey,
  useAtelierListMyReviews,
  useAtelierListMyGoals,
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
import MeExpenses from "./MeExpenses";

const SECTIONS = [
  { id: "overview", label: "Overview", href: "/me" },
  { id: "profile", label: "Profile", href: "/me/profile" },
  { id: "time", label: "Time", href: "/me/time" },
  { id: "expenses", label: "Expenses", href: "/me/expenses" },
  { id: "pay", label: "Pay & Benefits", href: "/me/pay" },
  { id: "performance", label: "Performance", href: "/me/performance" },
  { id: "learning", label: "Learning", href: "/me/learning" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function MeHome() {
  const [, params] = useRoute("/me/:section");
  const section = (params?.section ?? "overview") as SectionId;
  const { data: profile, isLoading } = useAtelierGetMyProfile();

  const firstName = profile?.user?.name?.split(/\s+/)[0] ?? "";
  // Contractors have no performance section — reviews & goals are an
  // employee-only surface (the server 403s them too).
  const isContractor =
    profile?.person?.workerType === "contractor" ||
    profile?.user?.role === "contractor";
  const sections = SECTIONS.filter((s) => !(isContractor && s.id === "performance"));

  return (
    <div className="animate-in fade-in" data-testid="me-home">
      <LensPageHeader
        headline={firstName ? `Your workspace, ${firstName}` : "Your workspace"}
        lede="Your profile, time, expenses, pay, performance and learning — everything about you at the firm, in one place."
      />
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {sections.map((s) => (
            <TabNavLink key={s.id} href={s.href} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "overview" && <OverviewSection loading={isLoading} profile={profile} />}
          {section === "profile" && <ProfileSection loading={isLoading} profile={profile} />}
          {section === "time" && <MeTime />}
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
        </div>
      </div>
    </div>
  );
}

type Profile = AtelierSelfProfile | undefined;

function OverviewSection({ loading, profile }: { loading: boolean; profile: Profile }) {
  return (
    <div className="space-y-6">
      <NotificationCards />
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

function ProfileSection({ loading, profile }: { loading: boolean; profile: Profile }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <IdentityCard loading={loading} profile={profile} />
      <RosterCard loading={loading} profile={profile} />
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
  return (
    <div className="space-y-6" data-testid="me-performance">
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
