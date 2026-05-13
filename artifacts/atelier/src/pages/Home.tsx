import * as React from "react";
import { useAtelierGetHome, useAtelierGetMe } from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip, PlmPill, PillButton, SectionLabel, HeroStat } from "@/components/ui/primitives";
import { Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Clock, FileText, ArrowRight, Download, ChevronDown, ChevronUp, Check, X, Users, Wallet, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  if (role === "engagement_lead" || role === "operations") {
    return { stage: "submitted", role: "lead", label: "Lead approve" };
  }
  if (role === "partner") {
    return { stage: "lead_approved", role: "partner", label: "Partner approve" };
  }
  return null;
}

function TimesheetApprovalsCard({ role }: { role: string }) {
  const next = nextStageFor(role);
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
                  onClick={() => setLocation(`/ledger/timesheets/${row.week.personId}/${row.week.weekIso}`)}
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
          <div className="w-full max-w-md rounded border border-border bg-bg-elevate p-4" onClick={(e) => e.stopPropagation()}>
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
  const canSeeRoster = role === "partner" || role === "operations" || role === "engagement_lead";
  const canSeeFinance = role === "partner";
  const canSeeTimesheet = role !== "partner_firm_resource";

  // Live tile state — kept lightweight, fail-soft to "—".
  const [ts, setTs] = React.useState<CurrentTimesheet | null>(null);
  const [headcount, setHeadcount] = React.useState<number | null>(null);
  const [marginTarget, setMarginTarget] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!canSeeTimesheet) return;
    let alive = true;
    void fetch("/api/atelier/ledger/timesheets/current", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: CurrentTimesheet | null) => { if (alive) setTs(j); })
      .catch(() => {});
    return () => { alive = false; };
  }, [canSeeTimesheet]);

  React.useEffect(() => {
    if (!canSeeRoster) return;
    let alive = true;
    void fetch("/api/atelier/roster/people", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((j: { people?: unknown[] }) => { if (alive) setHeadcount((j.people ?? []).length); })
      .catch(() => {});
    return () => { alive = false; };
  }, [canSeeRoster]);

  React.useEffect(() => {
    if (!canSeeFinance) return;
    let alive = true;
    void fetch("/api/atelier/pricing/margin-policy", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { targetMarginPct?: number } | null) => {
        if (alive && j && typeof j.targetMarginPct === "number") setMarginTarget(j.targetMarginPct);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [canSeeFinance]);

  const tiles: Array<{ href: string; label: string; icon: React.ReactNode; state: React.ReactNode; testid: string }> = [];
  if (canSeeTimesheet) {
    const w = ts?.week;
    tiles.push({
      href: "/ledger",
      label: "Timesheet",
      icon: <ClipboardList className="w-4 h-4" />,
      state: w
        ? <>
            <span className="text-text">{w.totalHours.toFixed(1)}h</span>
            <span className="text-text-faint"> · </span>
            <span className="text-text-mute capitalize">{w.status.replace("_", " ")}</span>
          </>
        : <span className="text-text-faint">log this week</span>,
      testid: "tile-workspace-timesheet",
    });
  }
  if (canSeeRoster) {
    tiles.push({
      href: "/roster/people",
      label: "Roster",
      icon: <Users className="w-4 h-4" />,
      state: headcount != null
        ? <><span className="text-text">{headcount}</span><span className="text-text-faint"> people</span></>
        : <span className="text-text-faint">firm-wide</span>,
      testid: "tile-workspace-roster",
    });
  }
  if (canSeeFinance) {
    tiles.push({
      href: "/finance",
      label: "Finance",
      icon: <Wallet className="w-4 h-4" />,
      state: marginTarget != null
        ? <><span className="text-text-mute">target</span> <span className="text-text">{(marginTarget * 100).toFixed(0)}%</span></>
        : <span className="text-text-faint">rate cards</span>,
      testid: "tile-workspace-finance",
    });
  }

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

export default function Home() {
  const { data: home, isLoading } = useAtelierGetHome();
  const { data: me } = useAtelierGetMe();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  if (isLoading) {
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
    else if (kind === 'engagement') setLocation(`/engagements/${targetId}`);
    else if (kind === 'atelier') setLocation(`/atelier/assets?focus=${targetId}`);
  };

  return (
    <div className="animate-in fade-in duration-500">
      <PageHero>
        <SectionHead 
          eyebrow={home.eyebrowDate}
          headline={
            <span dangerouslySetInnerHTML={{ __html: home.greeting.replace(home.persona.name, `<em class="accent">${home.persona.name}</em>`) }} />
          }
        />
      </PageHero>

      <div className="container-atelier py-10 space-y-12 grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* PANE A: What needs me today */}
        <div className="xl:col-span-2 space-y-6">
          <SectionLabel>What needs me today</SectionLabel>

          <div className="space-y-4">
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
        </div>

        {/* PANE B & C Column */}
        <div className="space-y-12">
          
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
                    <PlmPill stage={stage.stage} />
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
  );
}
