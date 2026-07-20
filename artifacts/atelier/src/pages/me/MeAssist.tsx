/**
 * MeAssist — Task #386: the Executive Assistant workspace.
 *
 * EAs pick which partner they are acting for (a persistent "Acting for …"
 * banner makes the context unmistakable) and enter timesheet entries,
 * expense claims (with receipt) or meeting/task notes ON BEHALF of that
 * partner. Nothing takes effect until the partner approves; rejected items
 * come back here with the partner's reason for edit + resubmit.
 *
 * Uses raw fetch — /me/assist/* is a bespoke surface (accepted pattern for
 * non-openapi Atelier routes).
 */
import * as React from "react";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { describeItemPayload, type PendingItem } from "./MeDelegates";

const API = "/api/atelier/me";

interface Delegation {
  id: string;
  partnerUserId: string;
  partnerName: string;
  scopes: string[];
  status: string;
}

const inputCls =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text min-h-[44px] focus:outline-none focus:ring-1 focus:ring-gold/50";

export default function MeAssist() {
  const [delegations, setDelegations] = React.useState<Delegation[]>([]);
  const [items, setItems] = React.useState<PendingItem[]>([]);
  const [isEa, setIsEa] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string>("");
  const [kind, setKind] = React.useState<string>("timesheet_entry");
  const [receiptFile, setReceiptFile] = React.useState<File | null>(null);
  const [form, setForm] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`${API}/assist`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      setDelegations(j.delegations ?? []);
      setItems(j.items ?? []);
      setIsEa(!!j.isExecutiveAssistant);
      setActiveId((prev) => prev || j.delegations?.[0]?.id || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const active = delegations.find((d) => d.id === activeId) ?? null;
  const allowedKinds = React.useMemo(() => {
    if (!active) return [];
    const out: Array<{ value: string; label: string }> = [];
    if (active.scopes.includes("timesheets"))
      out.push({ value: "timesheet_entry", label: "Timesheet entry" });
    if (active.scopes.includes("expenses")) out.push({ value: "expense", label: "Expense" });
    if (active.scopes.includes("meetings_tasks"))
      out.push({ value: "meeting_task", label: "Meeting / task" });
    return out;
  }, [active]);

  React.useEffect(() => {
    if (allowedKinds.length && !allowedKinds.some((k) => k.value === kind)) {
      setKind(allowedKinds[0].value);
    }
  }, [allowedKinds, kind]);

  const uploadReceipt = async (): Promise<string | null> => {
    if (!receiptFile) return null;
    const r = await fetch(`${API}/assist/receipt-upload`, {
      method: "POST",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.uploadURL) throw new Error(j.error || "Receipt upload unavailable.");
    const put = await fetch(j.uploadURL, {
      method: "PUT",
      body: receiptFile,
      headers: { "Content-Type": receiptFile.type || "application/octet-stream" },
    });
    if (!put.ok) throw new Error("Receipt upload failed.");
    return j.uploadURL.split("?")[0];
  };

  const submit = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> =
        kind === "timesheet_entry"
          ? {
              workDate: form.workDate,
              hours: Number(form.hours),
              narrative: form.narrative || null,
            }
          : kind === "expense"
            ? {
                expenseDate: form.expenseDate,
                merchant: form.merchant,
                amount: Number(form.amount),
                currency: form.currency || "USD",
                description: form.description || null,
              }
            : {
                title: form.title,
                date: form.date || null,
                time: form.time || null,
                notes: form.notes || null,
                attendees: form.attendees || null,
              };
      const receiptPath = kind === "expense" ? await uploadReceipt() : null;
      const r = await fetch(`${API}/assist/${active.id}/items`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload, receiptPath }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.message || j.error || `HTTP ${r.status}`);
      setForm({});
      setReceiptFile(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resubmit = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/assist/items/${id}/resubmit`, {
        method: "POST",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.message || j.error || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-text-faint">Loading…</p>;

  if (!delegations.length) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="me-assist-empty">
        {isEa
          ? "No partner has delegated work to you yet. Once a partner grants you a delegation, it appears here."
          : "You are not designated as an Executive Assistant. This section activates once HR designates you and a partner delegates work to you."}
      </Card>
    );
  }

  const mine = items;
  const rejected = mine.filter((i) => i.status === "rejected");

  return (
    <div className="space-y-6" data-testid="me-assist">
      {error ? (
        <Card className="p-3 text-sm text-red-400" data-testid="me-assist-error">
          {error}
        </Card>
      ) : null}

      {/* Acting-for banner + partner picker */}
      <Card className="p-4 border-gold/50 bg-gold/5" data-testid="me-assist-banner">
        <div className="flex flex-wrap items-center gap-3">
          <MonoChip tone="gold">Acting for</MonoChip>
          <select
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-text"
            value={activeId}
            onChange={(e) => setActiveId(e.target.value)}
            data-testid="me-assist-partner-select"
          >
            {delegations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.partnerName}
              </option>
            ))}
          </select>
          {active ? (
            <span className="text-xs text-text-faint">
              you may enter: {active.scopes.map((s) => s.replace(/_/g, " ")).join(", ")} — everything
              you enter awaits {active.partnerName.split(/\s+/)[0]}'s approval
            </span>
          ) : null}
        </div>
      </Card>

      {/* New entry */}
      {active && allowedKinds.length ? (
        <Card className="p-4 space-y-3" data-testid="me-assist-form">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-text">New entry for {active.partnerName}</h3>
            <select
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              data-testid="me-assist-kind"
            >
              {allowedKinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          {kind === "timesheet_entry" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <input type="date" className={inputCls} value={form.workDate ?? ""} onChange={(e) => setForm({ ...form, workDate: e.target.value })} data-testid="assist-workdate" />
              <input type="number" step="0.25" min="0.25" max="24" placeholder="Hours" className={inputCls} value={form.hours ?? ""} onChange={(e) => setForm({ ...form, hours: e.target.value })} data-testid="assist-hours" />
              <input placeholder="What was the work? (optional)" className={inputCls} value={form.narrative ?? ""} onChange={(e) => setForm({ ...form, narrative: e.target.value })} data-testid="assist-narrative" />
            </div>
          ) : kind === "expense" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <input placeholder="Merchant" className={inputCls} value={form.merchant ?? ""} onChange={(e) => setForm({ ...form, merchant: e.target.value })} data-testid="assist-merchant" />
              <input type="number" step="0.01" min="0.01" placeholder="Amount" className={inputCls} value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="assist-amount" />
              <input placeholder="Currency (e.g. USD)" className={inputCls} value={form.currency ?? ""} onChange={(e) => setForm({ ...form, currency: e.target.value })} data-testid="assist-currency" />
              <input type="date" className={inputCls} value={form.expenseDate ?? ""} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} data-testid="assist-expensedate" />
              <input placeholder="Description (optional)" className={inputCls} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="assist-description" />
              <input type="file" accept="image/*,application/pdf" className="text-sm text-text-mute" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} data-testid="assist-receipt" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <input placeholder="Title" className={inputCls} value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="assist-title" />
              <input placeholder="Attendees (optional)" className={inputCls} value={form.attendees ?? ""} onChange={(e) => setForm({ ...form, attendees: e.target.value })} data-testid="assist-attendees" />
              <input type="date" className={inputCls} value={form.date ?? ""} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="assist-date" />
              <input type="time" className={inputCls} value={form.time ?? ""} onChange={(e) => setForm({ ...form, time: e.target.value })} data-testid="assist-time" />
              <input placeholder="Notes (optional)" className={`${inputCls} sm:col-span-2`} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="assist-notes" />
            </div>
          )}
          <PillButton
            disabled={
              busy ||
              (kind === "timesheet_entry" && (!form.workDate || !form.hours)) ||
              (kind === "expense" && (!form.merchant || !form.amount)) ||
              (kind === "meeting_task" && !form.title)
            }
            onClick={() => void submit()}
            data-testid="assist-submit"
          >
            Send for {active.partnerName.split(/\s+/)[0]}'s approval
          </PillButton>
        </Card>
      ) : null}

      {/* Sent back */}
      {rejected.length ? (
        <div>
          <h3 className="text-sm font-semibold text-text mb-2">Sent back to you</h3>
          <div className="space-y-2" data-testid="me-assist-rejected">
            {rejected.map((i) => (
              <Card key={i.id} className="p-4 space-y-2 border-red-500/30">
                <div className="flex items-center gap-2 text-sm">
                  <MonoChip tone="red">{i.kind.replace(/_/g, " ")}</MonoChip>
                  <span className="text-text">{describeItemPayload(i.kind, i.payload)}</span>
                  <span className="text-text-faint">for {i.partnerName}</span>
                </div>
                {i.rejectionReason ? (
                  <p className="text-xs text-red-400">Reason: {i.rejectionReason}</p>
                ) : null}
                <PillButton disabled={busy} onClick={() => void resubmit(i.id)} data-testid={`assist-resubmit-${i.id}`}>
                  Resubmit
                </PillButton>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* History */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">Your entries</h3>
        {mine.length === 0 ? (
          <Card className="p-4 text-sm text-text-mute" data-testid="me-assist-items-empty">
            Nothing entered yet.
          </Card>
        ) : (
          <div className="space-y-2" data-testid="me-assist-items">
            {mine.slice(0, 20).map((i) => (
              <Card key={i.id} className="p-3 flex items-center gap-2 text-sm">
                <MonoChip
                  tone={i.status === "approved" ? "green" : i.status === "rejected" ? "red" : "amber"}
                >
                  {i.status}
                </MonoChip>
                <span className="text-text-mute truncate">
                  {i.kind.replace(/_/g, " ")} — {describeItemPayload(i.kind, i.payload)} · for {i.partnerName}
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
