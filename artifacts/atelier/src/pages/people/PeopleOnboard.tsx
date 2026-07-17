import * as React from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListJoiners,
  useAtelierAddJoiner,
  useAtelierDeactivateJoiner,
  useAtelierReactivateJoiner,
  getAtelierListJoinersQueryKey,
} from "@workspace/api-client-react";
import { TabNav, TabNavLink, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { useToast } from "@/hooks/use-toast";
import { PeopleShell } from "./PeopleShell";
import RosterInvitations from "@/pages/roster/RosterInvitations";
import RosterOnboarding from "@/pages/roster/RosterOnboarding";

const SUBS = [
  { id: "preboard",     label: "Pre-boarding" },
  { id: "invitations",  label: "Invitations" },
  { id: "joiners",      label: "Joiners & access" },
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
          {section === "joiners" && <JoinersView />}
          {section === "day-one" && <DayOneView />}
          {section === "equipment" && <EquipmentView />}
          {section === "attestations" && <AttestationsView />}
        </div>
      </div>
    </PeopleShell>
  );
}

/**
 * Task #50 — HR "Joiners & access" panel: add a joiner (creates roster
 * record + login with a one-time temporary password shown exactly once),
 * and deactivate / reactivate leaver logins.
 */
function JoinersView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: joiners, isLoading, error } = useAtelierListJoiners();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListJoinersQueryKey() });

  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [workerType, setWorkerType] = React.useState<"employee" | "contractor">("employee");
  const [startDate, setStartDate] = React.useState("");
  const [tempPassword, setTempPassword] = React.useState<{ email: string; password: string } | null>(null);

  const addJoiner = useAtelierAddJoiner({
    mutation: {
      onSuccess: (res) => {
        setTempPassword({ email: res.user.email, password: res.tempPassword });
        setFullName(""); setEmail(""); setTitle(""); setStartDate("");
        invalidate();
        toast({ title: "Joiner added", description: `${res.user.name} can now sign in with the one-time password below.` });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { message?: string } })?.data?.message ?? "Could not add the joiner.";
        toast({ title: "Add joiner failed", description: msg, variant: "destructive" });
      },
    },
  });
  const deactivate = useAtelierDeactivateJoiner({
    mutation: {
      onSuccess: (j) => { invalidate(); toast({ title: "Login deactivated", description: `${j.name} can no longer sign in; all sessions were revoked.` }); },
      onError: (err: unknown) => {
        const msg = (err as { data?: { message?: string } })?.data?.message ?? "Could not deactivate.";
        toast({ title: "Deactivate failed", description: msg, variant: "destructive" });
      },
    },
  });
  const reactivate = useAtelierReactivateJoiner({
    mutation: {
      onSuccess: (j) => { invalidate(); toast({ title: "Login reactivated", description: `${j.name} can sign in again.` }); },
      onError: () => toast({ title: "Reactivate failed", variant: "destructive" }),
    },
  });

  const inputCls =
    "w-full rounded border border-border bg-bg-elevate px-3 py-2 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold";

  return (
    <div className="space-y-6" data-testid="joiners-view">
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-text mb-3">Add a joiner</h3>
        <p className="text-xs text-text-mute mb-4 max-w-prose">
          Creates the roster record and a login in one step. You'll get a
          one-time temporary password to hand to the joiner — they must
          change it at first sign-in.
        </p>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fullName.trim() || !email.trim()) return;
            addJoiner.mutate({ data: { fullName: fullName.trim(), email: email.trim(), workerType, title: title.trim() || undefined, startDate: startDate || undefined } });
          }}
        >
          <input className={inputCls} placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="joiner-name" />
          <input className={inputCls} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="joiner-email" />
          <input className={inputCls} placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="joiner-title" />
          <select className={inputCls} value={workerType} onChange={(e) => setWorkerType(e.target.value as "employee" | "contractor")} data-testid="joiner-worker-type">
            <option value="employee">Employee</option>
            <option value="contractor">Contractor</option>
          </select>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-faint">Start date (optional)</span>
            <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="joiner-start-date" />
          </label>
          <div className="md:col-span-2">
            <PillButton type="submit" disabled={addJoiner.isPending || !fullName.trim() || !email.trim()} data-testid="joiner-submit">
              {addJoiner.isPending ? "Adding…" : "Add joiner"}
            </PillButton>
          </div>
        </form>
        {tempPassword ? (
          <div className="mt-4 rounded border border-gold/40 bg-gold/10 p-3" data-testid="joiner-temp-password">
            <p className="text-xs text-text-mute">
              One-time temporary password for <span className="text-text font-medium">{tempPassword.email}</span> — shown once, never again. They must change it at first sign-in.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <code className="font-mono text-sm text-gold select-all">{tempPassword.password}</code>
              <button
                type="button"
                className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text"
                onClick={() => { void navigator.clipboard?.writeText(tempPassword.password); toast({ title: "Copied" }); }}
              >
                Copy
              </button>
              <button
                type="button"
                className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text"
                onClick={() => setTempPassword(null)}
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-text mb-3">Logins</h3>
        {isLoading ? (
          <p className="text-sm text-text-faint">Loading…</p>
        ) : error ? (
          <p className="text-sm text-text-mute">Only HR or a founding partner can view this panel.</p>
        ) : !joiners || joiners.length === 0 ? (
          <p className="text-sm text-text-mute">No logins yet.</p>
        ) : (
          <ul className="divide-y divide-border-soft">
            {joiners.map((j) => (
              <li key={j.userId} className="flex items-center justify-between gap-4 py-2.5 text-sm" data-testid={`joiner-row-${j.userId}`}>
                <div className="min-w-0">
                  <span className="text-text font-medium">{j.name}</span>
                  <span className="ml-2 text-text-faint">{j.email}</span>
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-text-faint">{j.roleLabel}</span>
                  {j.mustChangePassword ? <MonoChip tone="amber" className="ml-2">temp password</MonoChip> : null}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <MonoChip tone={j.status === "active" ? "green" : "red"}>{j.status}</MonoChip>
                  {j.status === "active" ? (
                    <button
                      className="font-mono text-[10px] uppercase tracking-wider text-red-400/80 hover:text-red-400"
                      onClick={() => deactivate.mutate({ userId: j.userId })}
                      disabled={deactivate.isPending}
                      data-testid={`deactivate-${j.userId}`}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text"
                      onClick={() => reactivate.mutate({ userId: j.userId })}
                      disabled={reactivate.isPending}
                      data-testid={`reactivate-${j.userId}`}
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
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
