import * as React from "react";
import { Card, MonoChip, PageHero, SectionHead } from "@/components/ui/primitives";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useDeepLinkFocus, deepLinkFocusClass, scrollFocusIntoView } from "@/lib/useDeepLinkFocus";
import { scheduleIdForPostingLine } from "@/lib/revrecFocus";

interface ScheduleRow {
  id: string;
  engagementId: string;
  periodLabel: string;
  method: string;
  basisPct: number;
  recognisedAmount: number;
  deferredBalanceEnding: number;
  currency: string;
  frozen: boolean;
  postingId: string | null;
}
interface PostingRow {
  id: string;
  periodLabel: string;
  postedAt: string | null;
  initiatedByUserId: string;
  postedByUserId: string | null;
  linesCount: number;
  grossRecognisedAmount: number;
  rationaleText: string;
}
interface PeriodLock {
  id: string;
  periodLabel: string;
  lockedModules: string[];
  lockedAt: string;
}
interface MeResp {
  user?: { id: string; role: string; name: string };
}

const fmtUsd = (n: number) => `$${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Task #1082 — `?period=YYYY-MM` deep-link from GL revrec_line rows: open
// the page on the source line's period instead of the current month.
function initialPeriod(): { period: string; fromDeepLink: boolean } {
  const p = new URLSearchParams(window.location.search).get("period");
  if (p && /^\d{4}-\d{2}$/.test(p)) return { period: p, fromDeepLink: true };
  return { period: thisMonth(), fromDeepLink: false };
}

export default function WalletRevrec() {
  const { toast } = useToast();
  const [me, setMe] = React.useState<MeResp["user"] | null>(null);
  const [{ period: initPeriod, fromDeepLink }] = React.useState(initialPeriod);
  const [period, setPeriod] = React.useState(initPeriod);
  // Highlight the deep-linked period's schedules until the user changes period.
  const focusPeriod = fromDeepLink && period === initPeriod ? initPeriod : null;
  const focusRef = React.useRef<HTMLTableElement | null>(null);
  const rowRef = React.useRef<HTMLTableRowElement | null>(null);
  const scrolled = React.useRef(false);
  // `?line=<posting line id>` — resolve to the schedule row it recognises.
  const { focusId: lineId, missing, reportMissing, dismissMissing } = useDeepLinkFocus("line");
  const [focusScheduleId, setFocusScheduleId] = React.useState<string | null>(null);
  // Which period the currently-rendered schedules belong to (null = loading).
  const [loadedPeriod, setLoadedPeriod] = React.useState<string | null>(null);
  const [schedules, setSchedules] = React.useState<ScheduleRow[]>([]);
  const [postings, setPostings] = React.useState<PostingRow[]>([]);
  const [locks, setLocks] = React.useState<PeriodLock[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const meRes = await fetch("/api/atelier/me", { credentials: "include" }).then((r) => r.json());
    setMe(meRes.user ?? null);
    const [sched, post, lk] = await Promise.all([
      fetch(`/api/atelier/revrec/schedules?periodLabel=${period}`, { credentials: "include" }).then((r) => r.json()),
      fetch(`/api/atelier/revrec/period-postings`, { credentials: "include" }).then((r) => r.json()),
      fetch(`/api/atelier/revrec/period-locks`, { credentials: "include" }).then((r) => r.json()),
    ]);
    setSchedules(sched.schedules ?? []);
    setPostings(post.postings ?? []);
    setLocks(lk.locks ?? []);
    setLoadedPeriod(period);
  }, [period]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const role = me?.role ?? "";
  const isFinance = role === "finance" || role === "founding_partner" || role === "partner";
  const isFounding = role === "founding_partner";
  const lockedThisPeriod = locks.some((l) => l.periodLabel === period && (l.lockedModules ?? []).includes("revrec"));

  const compute = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/atelier/revrec/schedules/compute", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodLabel: period }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "compute failed");
      toast({ title: "Computed", description: `${j.schedules?.length ?? 0} schedule rows for ${period}` });
      await refresh();
    } catch (e) {
      toast({ title: "Compute failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const freeze = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/atelier/revrec/schedules/${id}/freeze`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).error || "freeze failed");
      toast({ title: "Frozen", description: "Schedule row frozen" });
      await refresh();
    } catch (e) {
      toast({ title: "Freeze failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const initiatePost = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/atelier/revrec/period-postings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodLabel: period, rationaleText: "Period close — finance review" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "init failed");
      toast({ title: "Posting initiated", description: `Awaits founding_partner approval` });
      setConfirmId(j.confirmationToken);
      await refresh();
    } catch (e) {
      toast({ title: "Initiate failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const confirmPost = async (id: string) => {
    if (!confirm(`POST period ${period} irreversibly? This will lock the period for revrec.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/atelier/revrec/period-postings/${id}/confirm-post`, {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error || "post failed");
      toast({ title: "POSTED", description: `${period} is now locked` });
      setConfirmId(null);
      await refresh();
    } catch (e) {
      toast({ title: "Post failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const pendingPosting = postings.find((p) => p.periodLabel === period && !p.postedAt);

  React.useEffect(() => {
    if (!focusPeriod || scrolled.current || schedules.length === 0) return;
    scrolled.current = true;
    scrollFocusIntoView(rowRef.current ?? focusRef.current);
  }, [focusPeriod, schedules.length, focusScheduleId]);

  // Resolve `?line=` → schedule row via the targeted posting-line lookup
  // (works for any period, no list cap). Missing line (deleted posting,
  // adjustment line with no schedule) surfaces a dismissible notice.
  const lineResolved = React.useRef(false);
  React.useEffect(() => {
    if (!lineId || lineResolved.current) return;
    lineResolved.current = true;
    void (async () => {
      try {
        const r = await fetch(`/api/atelier/revrec/posting-lines/${encodeURIComponent(lineId)}`, { credentials: "include" });
        if (r.ok) {
          const j = await r.json();
          const sid = scheduleIdForPostingLine(j.line ? [j.line] : [], lineId);
          if (sid) {
            // Follow the line's real period if it differs from the URL param.
            if (j.line.periodLabel && j.line.periodLabel !== initPeriod) setPeriod(j.line.periodLabel);
            setFocusScheduleId(sid);
            return;
          }
        }
      } catch { /* fall through to missing notice */ }
      reportMissing();
    })();
  }, [lineId, fromDeepLink, initPeriod, reportMissing]);

  // Once the resolved schedule row renders, scroll again to the exact row —
  // or report missing if the schedule itself is no longer in this period.
  // Only judge after the schedules for the CURRENT period have loaded.
  React.useEffect(() => {
    if (!focusScheduleId || loadedPeriod !== period) return;
    if (schedules.some((s) => s.id === focusScheduleId)) scrollFocusIntoView(rowRef.current);
    else reportMissing();
  }, [focusScheduleId, schedules, loadedPeriod, period, reportMissing]);

  return (
    <div className="min-h-screen text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Revenue recognition"
          lede="Schedules, period postings, and lock state for ASC 606 / IFRS 15 revenue recognition."
        />
      </PageHero>
      <SubSectionTabs
        tabs={[
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "revrec", label: "Rev-rec", href: "/wallet/revrec" },
        { id: "wip", label: "WIP", href: "/wallet/wip" },
        { id: "margin", label: "Margin & leakage", href: "/wallet/margin" },
      ]}
      />

      <div className="px-6 py-4 max-w-7xl mx-auto">
      {missing && (
        <div className="flex items-center justify-between text-xs font-mono text-text-mute border border-border-soft rounded px-3 py-2 mb-3" data-testid="revrec-focus-missing">
          <span>The linked revenue-recognition line is not available for {initPeriod} (it may have been re-computed or removed).</span>
          <button className="text-gold hover:text-gold/80 ml-3" onClick={dismissMissing} data-testid="btn-dismiss-revrec-focus">dismiss</button>
        </div>
      )}
      <div className="flex items-end gap-3">
        <div>
          <label className="text-xs text-text-mute uppercase block mb-1">Period</label>
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="YYYY-MM" className="w-32" />
        </div>
        {isFinance && (
          <Button disabled={busy || lockedThisPeriod} onClick={compute}>
            {lockedThisPeriod ? "Period locked" : "Compute schedules"}
          </Button>
        )}
        {isFinance && schedules.some((s) => s.frozen) && !pendingPosting && !lockedThisPeriod && (
          <Button disabled={busy} variant="default" onClick={initiatePost}>Initiate posting</Button>
        )}
      </div>

      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg">Schedule rows · {period}</h3>
          {lockedThisPeriod && <MonoChip tone="amber">PERIOD LOCKED</MonoChip>}
        </div>
        {schedules.length === 0 ? (
          <p className="text-text-mute text-sm">No schedule rows. Click "Compute schedules" to generate them from the Recognizer agent.</p>
        ) : (
          <table ref={focusRef} className={`w-full text-sm ${focusPeriod && !focusScheduleId ? deepLinkFocusClass : ""}`} data-testid="revrec-schedule-table">
            <thead className="text-text-mute text-left">
              <tr><th className="py-2">Engagement</th><th>Method</th><th>Basis %</th><th>Recognised</th><th>Deferred</th><th>State</th><th></th></tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr
                  key={s.id}
                  ref={s.id === focusScheduleId ? rowRef : undefined}
                  className={`border-t border-border/40 ${s.id === focusScheduleId ? "bg-gold/10 " + deepLinkFocusClass : ""}`}
                  data-testid={`revrec-schedule-row-${s.id}`}
                >
                  <td className="py-2 font-mono text-xs">{s.engagementId}</td>
                  <td>{s.method}</td>
                  <td>{fmtPct(s.basisPct)}</td>
                  <td className="font-mono">{fmtUsd(s.recognisedAmount)}</td>
                  <td className="font-mono text-text-mute">{fmtUsd(s.deferredBalanceEnding)}</td>
                  <td>{s.postingId ? <MonoChip tone="green">posted</MonoChip> : s.frozen ? <MonoChip tone="gold">frozen</MonoChip> : <MonoChip>computed</MonoChip>}</td>
                  <td>{!s.frozen && !s.postingId && isFinance && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => freeze(s.id)}>Freeze</Button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <h3 className="text-lg mb-3">Period postings</h3>
        {postings.length === 0 ? (
          <p className="text-text-mute text-sm">No postings yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-text-mute text-left"><tr><th className="py-2">Period</th><th>State</th><th>Lines</th><th>Gross</th><th></th></tr></thead>
            <tbody>
              {postings.map((p) => (
                <tr key={p.id} className="border-t border-border/40">
                  <td className="py-2">{p.periodLabel}</td>
                  <td>{p.postedAt ? <MonoChip tone="green">POSTED</MonoChip> : <MonoChip tone="amber">awaits founding_partner</MonoChip>}</td>
                  <td>{p.linesCount}</td>
                  <td className="font-mono">{fmtUsd(p.grossRecognisedAmount)}</td>
                  <td>{!p.postedAt && isFounding && (
                    <Button size="sm" variant="default" disabled={busy} onClick={() => confirmPost(p.id)}>Approve & POST</Button>
                  )}{!p.postedAt && !isFounding && <span className="text-xs text-text-mute">founding_partner only</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      </div>
    </div>
  );
}
