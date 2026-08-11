import * as React from "react";
import { useAtelierGetHome, useAtelierGetMe, useAtelierGetMyOpenTasks, getAtelierGetHomeQueryKey } from "@workspace/api-client-react";
import { SectionHead, Card, MonoChip, PillButton, SectionLabel, HeroStat } from "@/components/ui/primitives";
import { Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Clock, FileText, ArrowRight, Download, ChevronDown, ChevronUp, Check, X, Users, Wallet, PenLine, ClipboardList, Store, ListTodo, CheckSquare, Phone, Mail, CalendarClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { isSelfOnlyRole } from "@/lib/lens";
import { MyMeetingsCard } from "@/components/ms/MsMeetings";
import { SALES_STAGE_LABEL } from "@/lib/sales-stages";

interface ApprovalEntry {
  id: string;
  hours: number;
  billable: boolean;
}
interface ApprovalWeek {
  id: string;
  personId: string;
  personName: string;
  weekIso: string;
  status: string;
  totalHours: number;
  billableHours: number;
  suspiciousFlags: string[];
  engagementEntries: ApprovalEntry[];
}
interface ApprovalGroup {
  engagementId: string | null;
  engagementName: string;
  weeks: ApprovalWeek[];
}
interface ApprovalsResp {
  stage: string;
  groups: ApprovalGroup[];
}

// What stage of the approval ladder this persona is the next approver for.
function nextStageFor(role: string | undefined): { stage: "submitted" | "lead_approved"; role: "lead" | "partner"; label: string } | null {
  // Task #292 — 9-persona model. senior_manager + finance perform lead
  // approve; founding_partner + partner perform partner approve. Founding
  // partners can also lead-approve when there's no senior_manager queue.
  if (role === "senior_manager" || role === "finance") {
    return { stage: "submitted", role: "lead", label: "Lead approve" };
  }
  if (role === "partner" || role === "founding_partner") {
    return { stage: "lead_approved", role: "partner", label: "Partner approve" };
  }
  return null;
}

interface AwaitingSignatureContract {
  id: string;
  title: string;
  contractType: string;
  status: string;
  counterpartyLabel: string | null;
  signingEntityLabel: string | null;
  requestedAt: string | null;
  requestedByLabel: string | null;
}

// Task #346 — contracts where the viewer is an authorised firm signatory and
// a colleague has requested their signature. Surfaces the request on Home so
// it can't sit unnoticed in a notification list nobody visits.
function PendingSignaturesCard() {
  const [contracts, setContracts] = React.useState<AwaitingSignatureContract[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [, setLocation] = useLocation();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/atelier/contracts/awaiting-my-signature", { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: { contracts?: AwaitingSignatureContract[] } = await r.json();
        if (!cancelled) setContracts(data.contracts ?? []);
      } catch {
        if (!cancelled) setContracts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || contracts.length === 0) return null;

  return (
    <Card className="p-5 space-y-4 border-gold/40" data-testid="pending-signatures-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PenLine className="w-4 h-4 text-gold" />
          <h4 className="font-semibold text-lg text-text">Contracts awaiting your signature</h4>
        </div>
        <MonoChip tone="gold">{contracts.length}</MonoChip>
      </div>
      <div className="space-y-3">
        {contracts.map((c) => (
          <div
            key={c.id}
            className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between border-t border-border-soft pt-3 first:border-t-0 first:pt-0"
            data-testid={`pending-signature-${c.id}`}
          >
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium text-text truncate">{c.title}</div>
              <div className="text-xs text-text-mute">
                {c.requestedByLabel ? `${c.requestedByLabel} asked you to sign` : "Signature requested"}
                {c.counterpartyLabel ? ` · ${c.counterpartyLabel}` : ""}
                {c.signingEntityLabel ? ` · ${c.signingEntityLabel}` : ""}
                {c.requestedAt ? ` · ${new Date(c.requestedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
              </div>
            </div>
            <PillButton
              variant="ghost"
              className="shrink-0 w-full sm:w-auto"
              onClick={() => setLocation(`/contracts/${c.id}`)}
            >
              Review & sign <ArrowRight className="w-4 h-4 ml-1" />
            </PillButton>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TimesheetApprovalsCard({ role }: { role: string }) {
  // `nextStageFor` returns a fresh object literal every call. Memoize on the
  // primitive `role` so `next` is reference-stable across renders — otherwise
  // the `load` callback below gets a new identity every render and the
  // `useEffect([load])` re-fires forever, flipping `loading` and causing the
  // priority card to flicker between skeleton/null and content.
  const next = React.useMemo(() => nextStageFor(role), [role]);
  const [groups, setGroups] = React.useState<ApprovalGroup[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);
  // Optimistic hidden set so approve/reject removes a row immediately
  // without waiting for the next fetch round-trip.
  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(new Set());
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [rejectFor, setRejectFor] = React.useState<{ week: ApprovalWeek; engagementId: string | null } | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const load = React.useCallback(async () => {
    if (!next) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/atelier/ledger/approvals?stage=${next.stage}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: ApprovalsResp = await r.json();
      setGroups(data.groups ?? []);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [next]);

  React.useEffect(() => { void load(); }, [load]);

  const visibleRows = React.useMemo(() => {
    const rows: Array<{ engagementId: string | null; engagementName: string; week: ApprovalWeek }> = [];
    for (const g of groups) {
      for (const w of g.weeks) {
        if (hiddenIds.has(w.id)) continue;
        rows.push({ engagementId: g.engagementId, engagementName: g.engagementName, week: w });
      }
    }
    return rows;
  }, [groups, hiddenIds]);

  const totalHours = visibleRows.reduce((s, r) => s + Number(r.week.totalHours || 0), 0);
  const flaggedCount = visibleRows.filter((r) => r.week.suspiciousFlags.length > 0).length;
  const count = visibleRows.length;

  if (!next || loading || count === 0) return null;

  const approve = async (row: { engagementId: string | null; week: ApprovalWeek }) => {
    setBusyId(row.week.id);
    setHiddenIds((prev) => new Set([...prev, row.week.id])); // optimistic
    try {
      const r = await fetch(`/api/atelier/ledger/approvals/${row.week.id}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next.role, engagementId: row.engagementId ?? "__internal__" }),
      });
      if (!r.ok) {
        // roll back optimistic hide
        setHiddenIds((prev) => { const n = new Set(prev); n.delete(row.week.id); return n; });
        toast({ title: "Approve failed", variant: "destructive" });
        return;
      }
      toast({
        title: `Approved ${row.week.personName} · ${row.week.weekIso}`,
        description: next.role === "lead" ? "Routed to Partner for sign-off." : "Locked for billing.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectFor || !rejectReason.trim()) return;
    const week = rejectFor.week;
    setBusyId(week.id);
    setHiddenIds((prev) => new Set([...prev, week.id]));
    try {
      const r = await fetch(`/api/atelier/ledger/approvals/${week.id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (!r.ok) {
        setHiddenIds((prev) => { const n = new Set(prev); n.delete(week.id); return n; });
        toast({ title: "Reject failed", variant: "destructive" });
        return;
      }
      toast({ title: `Sent back to ${week.personName}` });
      setRejectFor(null);
      setRejectReason("");
    } finally {
      setBusyId(null);
    }
  };

  const summary = `${count} timesheet${count === 1 ? "" : "s"} awaiting your approval — ${totalHours.toFixed(0)}h total${flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ""}`;

  return (
    <Card hover className="p-5 group" data-testid="card-home-approvals">
      <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <MonoChip tone={flaggedCount > 0 ? "amber" : "gold"}>
              {flaggedCount > 0 ? "review" : "approve"}
            </MonoChip>
            <h4 className="font-semibold text-lg text-text group-hover:text-gold transition-colors">
              Timesheet approvals
            </h4>
          </div>
          <p className="text-text-mute text-sm leading-relaxed">{summary}</p>
          <div className="flex items-center gap-2 text-xs font-mono text-text-faint">
            <Clock className="w-3.5 h-3.5" />
            Tue 12:00 GST cutoff · {next.role === "lead" ? "you → Partner" : "you → locked"}
          </div>
        </div>
        <div className="shrink-0 w-full sm:w-auto flex flex-col sm:flex-row gap-2">
          <PillButton
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={() => setExpanded((v) => !v)}
            data-testid="button-toggle-approvals"
          >
            {expanded ? "Hide" : "Review"} {expanded ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
          </PillButton>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border-soft space-y-2">
          {visibleRows.map((row) => (
            <div
              key={row.week.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border-soft bg-bg-elevate/40 p-3"
              data-testid={`row-approval-${row.week.id}`}
            >
              <div className="min-w-[140px] flex-1">
                <button
                  type="button"
                  onClick={() => setLocation(`/people/time/${row.week.personId}/${row.week.weekIso}`)}
                  className="font-medium text-text hover:text-gold text-sm text-left"
                >
                  {row.week.personName}
                </button>
                <div className="text-[11px] font-mono text-text-faint">
                  {row.week.weekIso} · {row.engagementName}
                </div>
              </div>
              <MonoChip>{Number(row.week.totalHours).toFixed(1)}h</MonoChip>
              {row.week.suspiciousFlags.length > 0 && (
                <MonoChip tone="amber" title={row.week.suspiciousFlags.join(", ")}>
                  {row.week.suspiciousFlags.length} flag
                </MonoChip>
              )}
              <div className="flex gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={() => approve(row)}
                  disabled={busyId === row.week.id}
                  className="inline-flex items-center gap-1 rounded border border-gold/40 bg-gold/10 hover:bg-gold/20 text-gold text-xs font-mono px-2.5 py-1.5 disabled:opacity-50"
                  data-testid={`button-approve-${row.week.id}`}
                >
                  <Check className="w-3 h-3" /> {next.label}
                </button>
                <button
                  type="button"
                  onClick={() => setRejectFor({ week: row.week, engagementId: row.engagementId })}
                  disabled={busyId === row.week.id}
                  className="inline-flex items-center gap-1 rounded border border-border hover:border-danger/50 hover:text-danger text-text-mute text-xs font-mono px-2.5 py-1.5"
                  data-testid={`button-reject-${row.week.id}`}
                >
                  <X className="w-3 h-3" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRejectFor(null)}>
          <div className="w-full max-w-md rounded border border-border glass-surface p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-text">Reject {rejectFor.week.personName} · {rejectFor.week.weekIso}</div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="mt-2 h-24 w-full rounded border border-border bg-bg p-2 text-sm text-text"
              placeholder="Reason (required) — sent back to the submitter."
              data-testid="textarea-reject-reason"
            />
            <div className="mt-3 flex gap-2 justify-end">
              <PillButton variant="ghost" onClick={() => { setRejectFor(null); setRejectReason(""); }}>Cancel</PillButton>
              <PillButton onClick={submitReject} disabled={!rejectReason.trim() || busyId === rejectFor.week.id} data-testid="button-confirm-reject">
                Reject week
              </PillButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

interface CurrentTimesheet {
  week?: { weekIso: string; status: string; totalHours: number; billableHours: number };
}

function WorkspaceShelf({ role }: { role: string }) {
  // Task #292 — 9-persona model.
  const canSeeRoster =
    role === "founding_partner" ||
    role === "partner" ||
    role === "senior_manager" ||
    role === "finance" ||
    role === "hr";
  const canSeeFinance = role === "founding_partner" || role === "partner" || role === "finance";
  const canSeeTimesheet = role !== "partner_firm_resource" && role !== "board_observer";

  // Consolidated tile state — a single `Promise.all` resolves all three
  // fetches together so the tile grid mounts once with all data instead of
  // re-rendering three times and visibly reflowing as each fetch lands.
  const [shelf, setShelf] = React.useState<{
    ts: CurrentTimesheet | null;
    headcount: number | null;
    marginTarget: number | null;
  }>({ ts: null, headcount: null, marginTarget: null });

  React.useEffect(() => {
    let alive = true;
    const safeFetch = async <T,>(url: string, fallback: T): Promise<T> => {
      try {
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) return fallback;
        return (await r.json()) as T;
      } catch {
        return fallback;
      }
    };

    void Promise.all([
      canSeeTimesheet
        ? safeFetch<CurrentTimesheet | null>("/api/atelier/ledger/timesheets/current", null)
        : Promise.resolve(null),
      canSeeRoster
        ? safeFetch<{ people?: unknown[] }>("/api/atelier/roster/people", { people: [] })
        : Promise.resolve(null),
      canSeeFinance
        ? safeFetch<{ targetMarginPct?: number } | null>("/api/atelier/pricing/margin-policy", null)
        : Promise.resolve(null),
    ]).then(([tsRes, rosterRes, marginRes]) => {
      if (!alive) return;
      setShelf({
        ts: tsRes,
        headcount: rosterRes ? (rosterRes.people ?? []).length : null,
        marginTarget:
          marginRes && typeof marginRes.targetMarginPct === "number"
            ? marginRes.targetMarginPct
            : null,
      });
    });

    return () => {
      alive = false;
    };
  }, [canSeeTimesheet, canSeeRoster, canSeeFinance]);

  const { ts, headcount, marginTarget } = shelf;

  // Memoize the tile array so identical data doesn't allocate new
  // references every render.
  const tiles = React.useMemo<Array<{ href: string; label: string; icon: React.ReactNode; state: React.ReactNode; testid: string }>>(() => {
    const out: Array<{ href: string; label: string; icon: React.ReactNode; state: React.ReactNode; testid: string }> = [];
    // Task #364, Wave-4 review — Studio/Roster/Timesheet were unified into
    // the People lens. Surface one People entrypoint that summarises both
    // the headcount (Roster) and current-week timesheet state instead of
    // three separate tiles.
    if (canSeeTimesheet || canSeeRoster) {
      const w = ts?.week;
      const parts: React.ReactNode[] = [];
      if (canSeeRoster && headcount != null) {
        parts.push(<span key="hc"><span className="text-text">{headcount}</span><span className="text-text-faint"> people</span></span>);
      }
      if (canSeeTimesheet && w) {
        parts.push(<span key="ts"><span className="text-text">{w.totalHours.toFixed(1)}h</span><span className="text-text-faint"> · </span><span className="text-text-mute capitalize">{w.status.replace("_", " ")}</span></span>);
      } else if (canSeeTimesheet) {
        parts.push(<span key="ts" className="text-text-faint">log this week</span>);
      }
      const interleaved: React.ReactNode[] = [];
      parts.forEach((p, i) => {
        if (i > 0) interleaved.push(<span key={`sep-${i}`} className="text-text-faint"> · </span>);
        interleaved.push(p);
      });
      out.push({
        href: "/people",
        label: "People",
        icon: <Users className="w-4 h-4" />,
        state: interleaved.length ? <>{interleaved}</> : <span className="text-text-faint">lifecycle · directory · time</span>,
        testid: "tile-workspace-people",
      });
    }
    if (canSeeFinance) {
      out.push({
        href: "/finance",
        label: "Finance",
        icon: <Wallet className="w-4 h-4" />,
        state: marginTarget != null
          ? <><span className="text-text-mute">target</span> <span className="text-text">{(marginTarget * 100).toFixed(0)}%</span></>
          : <span className="text-text-faint">rate cards</span>,
        testid: "tile-workspace-finance",
      });
      out.push({
        href: "/wallet/margin",
        label: "Margin & WIP",
        icon: <Wallet className="w-4 h-4" />,
        state: <span className="text-text-faint">rev-rec · leakage</span>,
        testid: "tile-workspace-margin-wip",
      });
    }
    out.push({
      href: "/salon",
      label: "Salon",
      icon: <Store className="w-4 h-4" />,
      state: <span className="text-text-faint">client portal</span>,
      testid: "tile-workspace-salon",
    });
    return out;
  }, [canSeeTimesheet, canSeeRoster, canSeeFinance, ts, headcount, marginTarget]);

  if (tiles.length === 0) return null;

  return (
    <div className="space-y-6">
      <SectionLabel>Useful Links</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} data-testid={t.testid}>
            <Card hover className="p-5 cursor-pointer h-full">
              <div className="flex items-center gap-2.5 text-text-mute group-hover:text-gold">
                <span className="text-gold/80">{t.icon}</span>
                <span className="font-mono text-xs uppercase tracking-wider">{t.label}</span>
                <ArrowRight className="w-3.5 h-3.5 ml-auto text-text-faint" />
              </div>
              <div className="mt-3 text-sm">{t.state}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}


const TASK_TYPE_ICON: Record<string, React.ReactNode> = {
  task: <CheckSquare className="w-3.5 h-3.5" />,
  call: <Phone className="w-3.5 h-3.5" />,
  email: <Mail className="w-3.5 h-3.5" />,
  meeting: <CalendarClock className="w-3.5 h-3.5" />,
};

/**
 * Task #631 — per-owner open/overdue task roll-up. Surfaces the signed-in
 * persona's open activities/tasks across every account they own work on,
 * overdue-flagged and deep-linked to the parent account.
 */
function MyOpenTasksCard() {
  const { data, isLoading } = useAtelierGetMyOpenTasks();
  if (isLoading || !data || data.openCount === 0) return null;
  return (
    <Card className="p-5 space-y-3" data-testid="card-home-my-tasks">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-2">
          <ListTodo className="w-3.5 h-3.5" /> My open tasks
        </SectionLabel>
        <div className="flex items-center gap-2">
          <MonoChip>{data.openCount} open</MonoChip>
          {data.overdueCount > 0 && (
            <MonoChip tone="amber">{data.overdueCount} overdue</MonoChip>
          )}
        </div>
      </div>
      <div className="divide-y divide-border-soft">
        {data.tasks.slice(0, 6).map((t) => (
          <Link
            key={t.id}
            href={`/accounts/${t.accountId}`}
            className="flex items-center gap-2.5 py-2 group"
            data-testid={`row-my-task-${t.id}`}
          >
            <span className={t.overdue ? "text-danger" : "text-gold/80"}>
              {TASK_TYPE_ICON[t.type] ?? <CheckSquare className="w-3.5 h-3.5" />}
            </span>
            <span className="flex-1 min-w-0 text-sm text-text group-hover:text-gold truncate">
              {t.title}
            </span>
            {t.accountName && (
              <span className="text-[11px] font-mono text-text-faint shrink-0">
                {t.accountName}
              </span>
            )}
            {t.dueDate && (
              <span
                className={`text-[11px] font-mono shrink-0 ${
                  t.overdue ? "text-danger" : "text-text-faint"
                }`}
              >
                {t.overdue ? "Overdue " : "Due "}
                {t.dueDate}
              </span>
            )}
          </Link>
        ))}
      </div>
      {data.openCount > 6 && (
        <div className="text-[11px] font-mono text-text-faint">
          +{data.openCount - 6} more
        </div>
      )}
    </Card>
  );
}

export default function Home() {
  // Use `isPending` (initial load only) instead of `isLoading` so background
  // refetches — e.g. on window focus or after a persona switch — don't flip
  // the page back into the full-page skeleton and snap to content again.
  const { data: me } = useAtelierGetMe();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Task #50 — self-only personas (employee/contractor) have no org-wide
  // Home; their landing page is the Me lens.
  // Task #444 — don't fire the org-wide /home fetch (which 403s for
  // self-only roles) until the profile has loaded and the role may see it.
  const selfOnly = isSelfOnlyRole(me?.role);
  const { data: home, isPending } = useAtelierGetHome({
    query: {
      enabled: !!me && !selfOnly,
      queryKey: getAtelierGetHomeQueryKey(),
    },
  });
  React.useEffect(() => {
    if (selfOnly) setLocation("/me", { replace: true });
  }, [selfOnly, setLocation]);
  if (selfOnly) return null;

  if (isPending) {
    return (
      <div className="container-atelier py-12 space-y-12">
        <Skeleton className="h-8 w-48 bg-bg-elevate" />
        <Skeleton className="h-16 w-3/4 bg-bg-elevate" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Skeleton className="h-96 bg-bg-elevate col-span-2" />
          <Skeleton className="h-96 bg-bg-elevate" />
        </div>
      </div>
    );
  }

  if (!home) return null;

  const handlePullAsset = (assetTitle: string) => {
    toast({
      title: "Asset Pulled",
      description: `"${assetTitle}" has been copied to your current workspace.`,
    });
  };

  const navigateTo = (kind: string, targetId: string) => {
    if (kind === 'opportunity') setLocation(`/pipeline/${targetId}`);
    else if (kind === 'engagement') setLocation(`/clients/deliver/engagements/${targetId}`);
    else if (kind === 'atelier') setLocation(`/atelier/assets?focus=${targetId}`);
    // Task #732 — procurement renewal reminders deep-link to the account's
    // Procurement tab.
    else if (kind === 'account') setLocation(`/accounts/${targetId}?tab=procurement`);
  };

  return (
    <div className="animate-in fade-in duration-500">
      {/* Task #899 — the inline "Ask Atelier" input was removed; the
          assistant now lives permanently in the left chat panel. */}
      {/* Task #913 — the whole main section sits in one rounded glass
          panel so it reads as a single cohesive surface. */}
      <div className="container-atelier py-6">
        <div className="glass-panel rounded-2xl p-6 sm:p-8 grid grid-cols-1 xl:grid-cols-3 gap-8">

        {/* Task #917 — the greeting hero moved INSIDE the main panel as a
            rounded navy band spanning the full panel width. */}
        <div
          className="page-hero rounded-xl px-6 sm:px-8 xl:col-span-3"
          data-testid="home-greeting-band"
        >
          <SectionHead
            eyebrow={home.eyebrowDate}
            headline={
              <span dangerouslySetInnerHTML={{ __html: home.greeting.replace(home.persona.name, `<em class="accent">${home.persona.name}</em>`) }} />
            }
          />
        </div>
        
        {/* PANE A: What needs me today */}
        <div className="xl:col-span-2 space-y-6">
          <SectionLabel>What needs me today</SectionLabel>

          <div className="space-y-4">
            {/* Task #631 — per-owner open/overdue task roll-up. */}
            <MyOpenTasksCard />
            {/* Task #346 — contracts awaiting the viewer's firm signature. */}
            <PendingSignaturesCard />
            {/* Task #271 — pending timesheet approvals surface here as a single
                rolled-up actionable item with inline approve/reject. */}
            {me?.role && <TimesheetApprovalsCard role={me.role} />}

            {home.paneA.map((item) => (
              <Card key={item.id} hover className="p-5 flex flex-col sm:flex-row gap-5 items-start sm:items-center group">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <MonoChip tone={item.priority === 'high' ? 'gold' : item.priority === 'medium' ? 'amber' : 'default'}>
                      {item.priority}
                    </MonoChip>
                    <h4 className="font-semibold text-lg text-text group-hover:text-gold transition-colors">{item.title}</h4>
                  </div>
                  <p className="text-text-mute text-sm leading-relaxed">{item.summary}</p>
                  <div className="flex items-center gap-2 text-xs font-mono text-text-faint">
                    <Clock className="w-3.5 h-3.5" />
                    {item.dueLabel}
                  </div>
                </div>
                <div className="shrink-0 w-full sm:w-auto">
                  <PillButton 
                    variant="ghost" 
                    className="w-full sm:w-auto"
                    onClick={() => navigateTo(item.hrefKind, item.hrefTargetId)}
                  >
                    Open <ArrowRight className="w-4 h-4 ml-1" />
                  </PillButton>
                </div>
              </Card>
            ))}
            {home.paneA.length === 0 && (
              <div className="text-center py-12 text-text-mute font-mono text-sm border border-dashed border-border rounded-lg">
                No items require your attention today.
              </div>
            )}
          </div>

          {/* Workspace shelf — replaces the Ledger / Roster / Finance top-nav entries. */}
          {me?.role && <WorkspaceShelf role={me.role} />}
          {me?.role && <RenewalShelf role={me.role} />}
          {me?.role && <ContractExpiryShelf role={me.role} />}
          {/* Task #414 — Wave 2 Engagement Health tile (live EAC variance,
              projects-at-risk count, open change orders). */}
          {me?.role && <EngagementHealthTile role={me.role} />}
        </div>

        {/* PANE B & C Column */}
        <div className="space-y-12">

          {/* Task #327 — the viewer's Microsoft 365 meetings (next 7 days). */}
          <MyMeetingsCard />

          {/* PANE B: Pipeline & Engagements */}
          <div className="space-y-6">
            <SectionLabel>At a glance</SectionLabel>

            <div className="grid grid-cols-2 gap-4">
              <Card className="p-5 space-y-3">
                <div className="text-xs font-mono text-text-mute uppercase tracking-wider">Active Engagements</div>
                <div className="text-3xl font-light text-text">{home.engagements.activeCount}</div>
                <div className="flex flex-col gap-1.5 pt-2 border-t border-border-soft">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-faint">Due this week</span>
                    <span className="text-text">{home.engagements.deliverablesDueThisWeek}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-faint">RAID Red/Amber</span>
                    <span className="text-warn">{home.engagements.raidAmberCount}</span>
                    <span className="text-danger">{home.engagements.raidRedCount}</span>
                  </div>
                </div>
              </Card>

              <Card className="p-5 flex flex-col justify-between gap-3">
                <div className="text-xs font-mono text-text-mute uppercase tracking-wider">Pipeline Value</div>
                <HeroStat
                  size="md"
                  value={`$${(home.pipeline.reduce((acc, p) => acc + p.weightedValueUsd, 0) / 1000000).toFixed(1)}M`}
                  caption={<span className="normal-case tracking-normal">Weighted total</span>}
                />
              </Card>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="p-3 bg-bg-elevate-2/40 border-b border-border-soft text-xs font-mono text-text-mute uppercase tracking-wider">
                Pipeline Stages
              </div>
              <div className="divide-y divide-border-soft">
                {home.pipeline.map(stage => (
                  <div key={stage.stage} className="flex items-center justify-between p-3 hover:bg-bg-elevate-2 transition-colors">
                    <span className="plm-pill">{SALES_STAGE_LABEL[stage.stage]}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-mono text-text-mute">{stage.count} opps</span>
                      {stage.agedRedCount > 0 && (
                        <span className="flex items-center gap-1 text-danger font-mono text-xs">
                          <AlertCircle className="w-3.5 h-3.5" />
                          {stage.agedRedCount} aged
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* PANE C: From the Atelier */}
          <div className="space-y-6">
            <SectionLabel>From the Atelier</SectionLabel>

            <div className="space-y-4">
              {home.paneC.map((asset) => (
                <Card key={asset.id} className="p-4 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <MonoChip>{asset.kind.replace('_', ' ')}</MonoChip>
                    <button 
                      onClick={() => handlePullAsset(asset.title)}
                      className="text-text-mute hover:text-gold transition-colors"
                      title="Pull into current workspace"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                  <h4 className="font-medium text-text leading-tight">{asset.title}</h4>
                  <p className="text-sm text-text-faint line-clamp-2">{asset.abstract}</p>
                  <div className="text-xs font-mono text-gold/70">{asset.provenance}</div>
                </Card>
              ))}
            </div>
            <Link href="/atelier" className="inline-flex items-center gap-2 text-sm text-gold hover:text-gold-soft transition-colors font-mono uppercase tracking-wider">
              Browse full catalog <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

        </div>
        </div>
      </div>
    </div>
  );
}

interface HomeRenewalRow {
  id: string;
  accountId: string | null;
  status: string;
  riskTier: string;
  currentArrUsd: number;
  proposedArrUsd: number;
  nrrDeltaPct: number;
  renewalDueAt: string | null;
}

const RENEWAL_SHELF_ROLES = new Set([
  "founding_partner", "partner", "senior_manager", "finance", "board_observer",
]);

// Task #160 — contract expiry awareness. Partner-tier only: the
// /contracts detail pages are partner-tier, and partners own renewals.
const CONTRACT_EXPIRY_SHELF_ROLES = new Set(["founding_partner", "partner"]);

interface HomeContractRow {
  id: string;
  title: string;
  status: string;
  counterpartyLabel: string;
  expiryDate: string | null;
}

const CONTRACT_EXPIRY_ACTIVE = new Set([
  "draft", "out_for_review", "final_uploaded", "out_for_signature", "signed",
]);

function ContractExpiryShelf({ role }: { role: string }) {
  const [rows, setRows] = React.useState<HomeContractRow[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    if (!CONTRACT_EXPIRY_SHELF_ROLES.has(role)) { setLoaded(true); return; }
    void fetch("/api/atelier/contracts", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setRows(j?.contracts ?? []))
      .finally(() => setLoaded(true));
  }, [role]);
  if (!CONTRACT_EXPIRY_SHELF_ROLES.has(role)) return null;
  if (!loaded) return null;
  const expiring = rows
    .map((c) => {
      if (!c.expiryDate || !CONTRACT_EXPIRY_ACTIVE.has(c.status)) return null;
      const days = Math.ceil((new Date(c.expiryDate).getTime() - Date.now()) / 86_400_000);
      return days <= 60 ? { ...c, days } : null;
    })
    .filter((c): c is HomeContractRow & { days: number } => c !== null)
    .sort((a, b) => a.days - b.days);
  if (expiring.length === 0) return null;
  const within30 = expiring.filter((c) => c.days <= 30).length;
  const top = expiring.slice(0, 4);
  return (
    <div className="mt-6" data-testid="home-contract-expiry-shelf">
      <div className="flex items-baseline justify-between mb-2">
        <SectionLabel>Contracts · Expiring soon</SectionLabel>
        <Link href="/contracts" className="text-[11px] font-mono text-text-faint hover:text-gold">All contracts →</Link>
      </div>
      <Card className="p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-2xl font-light">
            {expiring.length} <span className="text-xs font-mono text-text-faint">within 60 days</span>
          </div>
          {within30 > 0 && (
            <div className="text-sm font-mono text-danger">{within30} within 30d</div>
          )}
        </div>
        <ul className="divide-y divide-border-soft">
          {top.map((c) => (
            <li key={c.id} className="py-1.5 text-xs font-mono" data-testid={`home-expiring-contract-${c.id}`}>
              <Link href={`/contracts/${c.id}`} className="flex items-center justify-between gap-3 hover:text-gold">
                <span className="truncate">
                  <MonoChip tone={c.days <= 30 ? "red" : "amber"}>
                    {c.days <= 0 ? "today" : `${c.days}d`}
                  </MonoChip>
                  <span className="ml-2 text-text">{c.title}</span>
                </span>
                <span className="text-text-mute truncate">{c.counterpartyLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

interface EngagementHealthSummary {
  totalEngagements: number;
  projectsAtRisk: number;
  openChangeOrders: number;
  totalVacUsd: number;
  weightedForecastMarginPct: number;
}

const ENGAGEMENT_HEALTH_ROLES = new Set([
  "founding_partner",
  "partner",
  "senior_manager",
  "finance",
  "board_observer",
]);

function EngagementHealthTile({ role }: { role: string }) {
  const [summary, setSummary] = React.useState<EngagementHealthSummary | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    if (!ENGAGEMENT_HEALTH_ROLES.has(role)) {
      setLoaded(true);
      return;
    }
    let alive = true;
    void fetch("/api/atelier/finance/engagement-pnl/summary", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { summary?: EngagementHealthSummary } | null) => {
        if (alive && j?.summary) setSummary(j.summary);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [role]);
  if (!ENGAGEMENT_HEALTH_ROLES.has(role)) return null;
  if (!loaded || !summary) return null;
  const vacTone = summary.totalVacUsd < 0 ? "red" : summary.totalVacUsd === 0 ? "default" : "green";
  const vacLabel = `${summary.totalVacUsd < 0 ? "-" : ""}$${Math.abs(Math.round(summary.totalVacUsd)).toLocaleString()}`;
  const marginTone =
    summary.weightedForecastMarginPct < 0.30
      ? "red"
      : summary.weightedForecastMarginPct < 0.40
        ? "amber"
        : "green";
  return (
    <div className="mt-6" data-testid="home-engagement-health">
      <div className="flex items-baseline justify-between mb-2">
        <SectionLabel>Engagement health · EAC</SectionLabel>
        <Link
          href="/finance/plan/engagement-health"
          className="text-[11px] font-mono text-text-faint hover:text-gold"
        >
          Open register →
        </Link>
      </div>
      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider">EAC variance</div>
            <div
              className={`mt-1 text-lg font-semibold ${vacTone === "red" ? "text-danger" : vacTone === "green" ? "text-green-400" : "text-text"}`}
              data-testid="tile-eac-variance"
            >
              {vacLabel}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider">Projects at risk</div>
            <div
              className={`mt-1 text-lg font-semibold ${summary.projectsAtRisk > 0 ? "text-amber" : "text-text"}`}
              data-testid="tile-projects-at-risk"
            >
              {summary.projectsAtRisk}
              <span className="text-text-faint text-sm font-mono"> / {summary.totalEngagements}</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider">Open change orders</div>
            <div
              className={`mt-1 text-lg font-semibold ${summary.openChangeOrders > 0 ? "text-amber" : "text-text"}`}
              data-testid="tile-open-change-orders"
            >
              {summary.openChangeOrders}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider">Portfolio fcst margin</div>
            <div
              className={`mt-1 text-lg font-semibold ${marginTone === "red" ? "text-danger" : marginTone === "amber" ? "text-amber" : "text-green-400"}`}
              data-testid="tile-portfolio-margin"
            >
              {(summary.weightedForecastMarginPct * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RenewalShelf({ role }: { role: string }) {
  const [rows, setRows] = React.useState<HomeRenewalRow[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    if (!RENEWAL_SHELF_ROLES.has(role)) { setLoaded(true); return; }
    void fetch("/api/atelier/crm/renewals?status=open", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setRows(j?.data?.rows ?? []))
      .finally(() => setLoaded(true));
  }, [role]);
  if (!RENEWAL_SHELF_ROLES.has(role)) return null;
  if (!loaded) return null;
  if (rows.length === 0) return null;
  const top = rows.slice(0, 4);
  const totalArr = rows.reduce((s, r) => s + r.currentArrUsd, 0);
  const totalProposed = rows.reduce((s, r) => s + r.proposedArrUsd, 0);
  const nrr = totalArr > 0 ? Math.round(((totalProposed - totalArr) / totalArr) * 1000) / 10 : 0;
  return (
    <div className="mt-6" data-testid="home-renewal-shelf">
      <div className="flex items-baseline justify-between mb-2">
        <SectionLabel>Renewals · NRR</SectionLabel>
        <Link href="/crm" className="text-[11px] font-mono text-text-faint hover:text-gold">All renewals →</Link>
      </div>
      <Card className="p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-2xl font-light">{rows.length} <span className="text-xs font-mono text-text-faint">open</span></div>
          <div className={`text-sm font-mono ${nrr >= 0 ? "text-success" : "text-danger"}`}>NRR Δ {nrr >= 0 ? "+" : ""}{nrr}%</div>
        </div>
        <ul className="divide-y divide-border-soft">
          {top.map((r) => (
            <li key={r.id} className="py-1.5 flex items-center justify-between text-xs font-mono">
              <span className="truncate">
                <MonoChip tone={r.riskTier === "red" ? "red" : r.riskTier === "amber" ? "amber" : "green"}>{r.riskTier}</MonoChip>
                <span className="ml-2 text-text">{r.accountId ?? r.id}</span>
              </span>
              <span className="text-text-mute">${r.currentArrUsd.toFixed(0)} → ${r.proposedArrUsd.toFixed(0)} {r.renewalDueAt ?? ""}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
