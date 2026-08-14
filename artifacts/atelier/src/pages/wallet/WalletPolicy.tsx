import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { WalletTabs } from "./walletTabs";

interface Rule {
  id: string;
  category: string;
  appliesToRole: string | null;
  appliesToCountry: string | null;
  capAmountUsd: number | null;
  capUnit: string | null;
  hardBlockAmountUsd: number | null;
  approvalThresholdUsd: number | null;
  flightClassMax: string | null;
  rationale: string | null;
  active: boolean;
}

export default function WalletPolicy() {
  const [rules, setRules] = React.useState<Rule[]>([]);
  const [principles, setPrinciples] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const r = await fetch("/api/atelier/wallet/policy", { credentials: "include" });
    const j = await r.json();
    setRules(j.rules ?? []);
    setPrinciples(typeof j.principles === "string" ? j.principles : null);
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  async function seedDefaults() {
    setBusy(true);
    await fetch("/api/atelier/wallet/policy/seed-defaults", {
      method: "POST", credentials: "include",
    });
    await load();
    setBusy(false);
  }

  async function patch(id: string, body: Partial<Rule>) {
    setBusy(true);
    await fetch(`/api/atelier/wallet/policy/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
    setEditing(null);
    setBusy(false);
  }

  async function remove(id: string) {
    if (!confirm("Retire this policy rule?")) return;
    setBusy(true);
    await fetch(`/api/atelier/wallet/policy/${id}`, {
      method: "DELETE", credentials: "include",
    });
    await load();
    setBusy(false);
  }

  return (
    <div className="min-h-screen text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Expense policy"
          lede="Caps, hard blocks, and approval thresholds — keep the firm clean."
        />
      </PageHero>
      <WalletTabs group="main" />
      <div className="px-6 py-4 max-w-6xl mx-auto space-y-3">
        {principles && (
          <Card className="p-4" data-testid="policy-principles">
            <p className="text-[10px] font-mono uppercase tracking-wider text-text-mute mb-1">The spirit of the policy</p>
            <p className="text-sm text-text-mute">{principles}</p>
          </Card>
        )}
        <div className="flex justify-between items-center">
          <p className="text-sm text-text-mute">{rules.length} rules · most-specific (role + country) wins.</p>
          <button onClick={seedDefaults} disabled={busy} className="px-3 py-1 rounded text-xs font-mono bg-gold text-bg disabled:opacity-50" data-testid="button-seed-defaults">
            {busy ? "Working…" : "Restore missing defaults"}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {rules.map((r) => (
            <Card
              key={r.id}
              className={`p-4 ${r.active ? "" : "opacity-60"} ${editing === r.id ? "" : "cursor-pointer hover:bg-bg-elevate-2 transition-colors"}`}
              onClick={editing === r.id ? undefined : () => setEditing(r.id)}
              data-testid={`policy-${r.id}`}
            >
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <MonoChip>{r.category}</MonoChip>
                    {r.appliesToRole && <MonoChip tone="gold">role: {r.appliesToRole}</MonoChip>}
                    {r.appliesToCountry && <MonoChip>country: {r.appliesToCountry}</MonoChip>}
                    {!r.active && <MonoChip tone="red">retired</MonoChip>}
                  </div>
                  <div className="text-xs font-mono text-text-mute">
                    cap ${r.capAmountUsd ?? "—"} {r.capUnit ?? ""} · hard ${r.hardBlockAmountUsd ?? "—"} · approval ${r.approvalThresholdUsd ?? "—"} {r.flightClassMax ? `· flight ${r.flightClassMax}` : ""}
                  </div>
                  {r.rationale && <p className="text-sm text-text-mute italic">{r.rationale}</p>}
                </div>
                <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {editing === r.id && (
                    <button onClick={() => setEditing(null)} className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-border text-text-mute hover:border-gold hover:text-gold" data-testid={`button-cancel-edit-${r.id}`}>
                      Cancel
                    </button>
                  )}
                  <button onClick={() => remove(r.id)} className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-border text-text-mute hover:border-red-500 hover:text-red-400">
                    Retire
                  </button>
                </div>
              </div>
              {editing === r.id && <EditForm rule={r} onSave={(b) => patch(r.id, b)} busy={busy} />}
            </Card>
          ))}
          {rules.length === 0 && (
            <Card className="p-6 text-center text-text-mute">No active rules. The default policy installs automatically on first use — if none appear, click "Restore missing defaults".</Card>
          )}
        </div>
      </div>
    </div>
  );
}

function EditForm({ rule, onSave, busy }: { rule: Rule; onSave: (b: Partial<Rule>) => void; busy: boolean }) {
  const [cap, setCap] = React.useState(rule.capAmountUsd ?? 0);
  const [hard, setHard] = React.useState(rule.hardBlockAmountUsd ?? 0);
  const [approval, setApproval] = React.useState(rule.approvalThresholdUsd ?? 0);
  const [rationale, setRationale] = React.useState(rule.rationale ?? "");
  const inputCls = "w-full bg-bg-deep border border-border rounded px-2 py-1 text-sm";
  return (
    <div className="mt-3 pt-3 border-t border-border-soft grid grid-cols-2 md:grid-cols-4 gap-3">
      <div><label className="text-[10px] font-mono uppercase text-text-mute">Cap USD</label><input type="number" className={inputCls} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></div>
      <div><label className="text-[10px] font-mono uppercase text-text-mute">Hard block USD</label><input type="number" className={inputCls} value={hard} onChange={(e) => setHard(Number(e.target.value))} /></div>
      <div><label className="text-[10px] font-mono uppercase text-text-mute">Approval USD</label><input type="number" className={inputCls} value={approval} onChange={(e) => setApproval(Number(e.target.value))} /></div>
      <div className="col-span-full"><label className="text-[10px] font-mono uppercase text-text-mute">Rationale</label><input className={inputCls} value={rationale} onChange={(e) => setRationale(e.target.value)} /></div>
      <div className="col-span-full">
        <button disabled={busy} onClick={() => onSave({ capAmountUsd: cap, hardBlockAmountUsd: hard, approvalThresholdUsd: approval, rationale })} className="px-3 py-1 rounded bg-gold text-bg text-xs font-mono uppercase">Save</button>
      </div>
    </div>
  );
}
