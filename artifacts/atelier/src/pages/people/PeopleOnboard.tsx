import * as React from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListJoiners,
  useAtelierAddJoiner,
  useAtelierDeactivateJoiner,
  useAtelierReactivateJoiner,
  useAtelierListUsers,
  useAtelierGetLeaverHandover,
  useAtelierReassignLeaverItems,
  useAtelierUpdateHireOffer,
  getAtelierListJoinersQueryKey,
  getAtelierGetLeaverHandoverQueryKey,
  getAtelierListHireOffersQueryKey,
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
];

export default function PeopleOnboard() {
  const [, params] = useRoute("/people/onboard/:section");
  const section = params?.section ?? "preboard";

  return (
    <PeopleShell stage="onboard">
      <LensPageHeader
        headline="Pre-boarding, invitations, joiners & access"
        lede="From accepted offer to a working login: pre-boarding checklist, invitations, and joiner accounts."
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

  // Task #125 — offer→joiner continuation: /people/onboard/joiners can be
  // opened from an accepted offer with ?fromOffer=<id>&name=&email=&title=&start=
  // to prefill the form; after the joiner is created we link the offer to the
  // new login (joinerUserId) so the Offers tab shows "login created".
  const prefill = React.useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return {
      fromOffer: q.get("fromOffer") ?? "",
      name: q.get("name") ?? "",
      email: q.get("email") ?? "",
      title: q.get("title") ?? "",
      start: q.get("start") ?? "",
    };
  }, []);

  const [fullName, setFullName] = React.useState(prefill.name);
  const [email, setEmail] = React.useState(prefill.email);
  const [title, setTitle] = React.useState(prefill.title);
  const [workerType, setWorkerType] = React.useState<"employee" | "contractor">("employee");
  const [startDate, setStartDate] = React.useState(prefill.start);
  const [tempPassword, setTempPassword] = React.useState<{ email: string; password: string } | null>(null);

  const linkOffer = useAtelierUpdateHireOffer({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAtelierListHireOffersQueryKey() });
        toast({ title: "Offer linked", description: "The offer now shows the login was created." });
      },
      onError: () =>
        toast({ title: "Could not link the offer", description: "The login was created, but the offer wasn't updated. You can leave it — the offer stays accepted.", variant: "destructive" }),
    },
  });

  const addJoiner = useAtelierAddJoiner({
    mutation: {
      onSuccess: (res) => {
        setTempPassword({ email: res.user.email, password: res.tempPassword });
        setFullName(""); setEmail(""); setTitle(""); setStartDate("");
        invalidate();
        toast({ title: "Joiner added", description: `${res.user.name} can now sign in with the one-time password below.` });
        if (prefill.fromOffer) {
          linkOffer.mutate({ id: prefill.fromOffer, data: { joinerUserId: res.user.id } });
          window.history.replaceState(null, "", window.location.pathname);
        }
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { message?: string } })?.data?.message ?? "Could not add the joiner.";
        toast({ title: "Add joiner failed", description: msg, variant: "destructive" });
      },
    },
  });
  const [confirmingUserId, setConfirmingUserId] = React.useState<string | null>(null);
  const [markLeaver, setMarkLeaver] = React.useState(true);
  const [leaverEndDate, setLeaverEndDate] = React.useState("");
  const [handoverUserId, setHandoverUserId] = React.useState<string | null>(null);

  const deactivate = useAtelierDeactivateJoiner({
    mutation: {
      onSuccess: (j) => { setConfirmingUserId(null); setHandoverUserId(j.userId); invalidate(); toast({ title: "Login deactivated", description: `${j.name} can no longer sign in; all sessions were revoked. Review the handover checklist below.` }); },
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
              <li key={j.userId} className="py-2.5 text-sm" data-testid={`joiner-row-${j.userId}`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span className="text-text font-medium">{j.name}</span>
                    <span className="ml-2 text-text-faint">{j.email}</span>
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-text-faint">{j.roleLabel}</span>
                    {j.mustChangePassword ? <MonoChip tone="amber" className="ml-2">temp password</MonoChip> : null}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <MonoChip tone={j.status === "active" ? "green" : "red"}>{j.status}</MonoChip>
                    <button
                      className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text"
                      onClick={() => setHandoverUserId(handoverUserId === j.userId ? null : j.userId)}
                      data-testid={`handover-${j.userId}`}
                    >
                      {handoverUserId === j.userId ? "Hide handover" : "Handover"}
                    </button>
                    {j.status === "active" ? (
                      <button
                        className="font-mono text-[10px] uppercase tracking-wider text-red-400/80 hover:text-red-400"
                        onClick={() => {
                          setConfirmingUserId(confirmingUserId === j.userId ? null : j.userId);
                          setMarkLeaver(true);
                          setLeaverEndDate(new Date().toISOString().slice(0, 10));
                        }}
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
                </div>
                {confirmingUserId === j.userId && j.status === "active" ? (
                  <div className="mt-2 rounded border border-red-400/30 bg-red-400/5 p-3 space-y-2" data-testid={`deactivate-confirm-${j.userId}`}>
                    <p className="text-xs text-text-mute">
                      This disables {j.name}'s login and revokes all sessions immediately.
                    </p>
                    <label className="flex items-center gap-2 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={markLeaver}
                        onChange={(e) => setMarkLeaver(e.target.checked)}
                        data-testid={`mark-leaver-${j.userId}`}
                      />
                      Also mark the roster record as a leaver (status + end date)
                    </label>
                    {markLeaver ? (
                      <label className="block text-xs text-text-mute">
                        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-text-faint">End date</span>
                        <input
                          className="rounded border border-border bg-bg-elevate px-2 py-1 text-xs text-text"
                          type="date"
                          value={leaverEndDate}
                          onChange={(e) => setLeaverEndDate(e.target.value)}
                          data-testid={`leaver-end-date-${j.userId}`}
                        />
                      </label>
                    ) : null}
                    <div className="flex items-center gap-3">
                      <button
                        className="font-mono text-[10px] uppercase tracking-wider text-red-400/80 hover:text-red-400"
                        onClick={() =>
                          deactivate.mutate({
                            userId: j.userId,
                            data: markLeaver ? { markLeaver: true, endDate: leaverEndDate || undefined } : {},
                          })
                        }
                        disabled={deactivate.isPending}
                        data-testid={`confirm-deactivate-${j.userId}`}
                      >
                        {deactivate.isPending ? "Deactivating…" : "Confirm deactivate"}
                      </button>
                      <button
                        className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text"
                        onClick={() => setConfirmingUserId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                {handoverUserId === j.userId ? (
                  <HandoverPanel userId={j.userId} selfExcludeName={j.name} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * Task #60 — HR leaver handover checklist: everything a user still owns
 * (accounts, live opportunities, open tasks) with quick reassign actions.
 */
function HandoverPanel({ userId, selfExcludeName }: { userId: string; selfExcludeName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useAtelierGetLeaverHandover(userId);
  const { data: users } = useAtelierListUsers();
  const [toUserId, setToUserId] = React.useState("");

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: getAtelierGetLeaverHandoverQueryKey(userId) });

  const reassign = useAtelierReassignLeaverItems({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({ title: "Reassigned", description: "Ownership was handed over." });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { message?: string } })?.data?.message ?? "Could not reassign.";
        toast({ title: "Reassign failed", description: msg, variant: "destructive" });
      },
    },
  });

  const candidates = (users ?? []).filter((u) => u.id !== userId);
  const doReassign = (items: { accountIds?: string[]; opportunityIds?: string[]; taskIds?: string[]; all?: boolean }) => {
    if (!toUserId) {
      toast({ title: "Pick a person first", description: "Choose who takes over before reassigning.", variant: "destructive" });
      return;
    }
    reassign.mutate({ userId, data: { toUserId, ...items } });
  };

  const rowCls = "flex items-center justify-between gap-3 py-1.5 text-xs";
  const btnCls = "font-mono text-[10px] uppercase tracking-wider text-gold/80 hover:text-gold shrink-0 disabled:opacity-50";

  return (
    <div className="mt-2 rounded border border-border bg-bg-elevate/50 p-3 space-y-3" data-testid={`handover-panel-${userId}`}>
      {isLoading ? (
        <p className="text-xs text-text-faint">Loading handover checklist…</p>
      ) : error || !data ? (
        <p className="text-xs text-text-mute">Could not load the handover checklist.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-text-mute">
              {data.totalOwned === 0
                ? `${selfExcludeName} owns nothing that needs a handover.`
                : `${selfExcludeName} still owns ${data.accounts.length} account(s), ${data.opportunities.length} live opportunity(ies) and ${data.tasks.length} open task(s).`}
              {data.roster ? (
                <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-text-faint">
                  roster: {data.roster.status}
                  {data.roster.endDate ? ` · ends ${data.roster.endDate}` : ""}
                </span>
              ) : null}
            </p>
            {data.totalOwned > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  className="rounded border border-border bg-bg-elevate px-2 py-1 text-xs text-text"
                  value={toUserId}
                  onChange={(e) => setToUserId(e.target.value)}
                  data-testid={`handover-target-${userId}`}
                >
                  <option value="">Reassign to…</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.roleLabel}</option>
                  ))}
                </select>
                <button
                  className={btnCls}
                  onClick={() => doReassign({ all: true })}
                  disabled={reassign.isPending}
                  data-testid={`reassign-all-${userId}`}
                >
                  {reassign.isPending ? "Reassigning…" : "Reassign everything"}
                </button>
              </div>
            ) : null}
          </div>
          {data.accounts.length > 0 ? (
            <div>
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-text-faint mb-1">Accounts (partner owner)</h4>
              <ul className="divide-y divide-border-soft">
                {data.accounts.map((a) => (
                  <li key={a.id} className={rowCls} data-testid={`handover-account-${a.id}`}>
                    <span className="text-text truncate">{a.name} <span className="text-text-faint">· {a.status}</span></span>
                    <button className={btnCls} onClick={() => doReassign({ accountIds: [a.id] })} disabled={reassign.isPending}>
                      Reassign
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.opportunities.length > 0 ? (
            <div>
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-text-faint mb-1">Live opportunities</h4>
              <ul className="divide-y divide-border-soft">
                {data.opportunities.map((o) => (
                  <li key={o.id} className={rowCls} data-testid={`handover-opp-${o.id}`}>
                    <span className="text-text truncate">
                      {o.name} <span className="text-text-faint">· {o.accountName} · {o.salesStage} · {o.roles.join(" + ")}</span>
                    </span>
                    <button className={btnCls} onClick={() => doReassign({ opportunityIds: [o.id] })} disabled={reassign.isPending}>
                      Reassign
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.tasks.length > 0 ? (
            <div>
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-text-faint mb-1">Open tasks</h4>
              <ul className="divide-y divide-border-soft">
                {data.tasks.map((t) => (
                  <li key={t.id} className={rowCls} data-testid={`handover-task-${t.id}`}>
                    <span className="text-text truncate">
                      {t.title} <span className="text-text-faint">· {t.accountName}{t.dueDate ? ` · due ${t.dueDate}` : ""}</span>
                    </span>
                    <button className={btnCls} onClick={() => doReassign({ taskIds: [t.id] })} disabled={reassign.isPending}>
                      Reassign
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
