import * as React from "react";
import { Card, MonoChip, PageHero, SectionHead } from "@/components/ui/primitives";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

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

export default function WalletRevrec() {
  const { toast } = useToast();
  const [me, setMe] = React.useState<MeResp["user"] | null>(null);
  const [period, setPeriod] = React.useState(thisMonth());
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

  return (
    <div className="min-h-screen bg-bg text-text">
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
          <table className="w-full text-sm" data-testid="revrec-schedule-table">
            <thead className="text-text-mute text-left">
              <tr><th className="py-2">Engagement</th><th>Method</th><th>Basis %</th><th>Recognised</th><th>Deferred</th><th>State</th><th></th></tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-t border-border/40">
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
