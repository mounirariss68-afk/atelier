import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";

interface CashReceipt {
  id: string;
  bankTransactionId: string;
  totalAmount: number;
  appliedAmount: number;
  currency: string;
  receivedAt: string;
  customerId: string | null;
}

interface MatchCandidate {
  invoiceId: string;
  invoiceNumber: string | null;
  appliedAmount: number;
  confidence: number;
  rationale: string;
}

interface MatchResp {
  recommended: string;
  candidates: MatchCandidate[];
  rationaleSummary: string;
}

interface OutflowCandidate {
  refKind: string;
  refId: string;
  label: string;
  amount: number;
  confidence: number;
  rationale: string;
}

interface TriageTxn {
  id: string;
  postedDate: string;
  amount: number;
  currency: string;
  kind: string;
  counterpartyNameRaw: string | null;
  referenceRaw: string | null;
  matchedState: string;
  parkedReason: string | null;
  matchProposal: {
    type?: "inflow" | "outflow";
    cashReceiptId?: string;
    recommended?: string | { invoiceId: string | null; invoiceNumber?: string | null; appliedAmount?: number };
    candidates?: Array<MatchCandidate & OutflowCandidate>;
    rationaleSummary?: string;
  } | null;
}

const stateTone: Record<string, "green" | "gold" | "red" | "default"> = {
  proposed: "gold", unmatched: "default", parked: "red", matched: "green", journaled: "green",
};

interface BankAccount {
  id: string;
  bankName: string;
  accountLabel: string;
  accountNumberLast4: string;
  currency: string;
}

/** Task #1071 — statement file upload (CSV / Xero export) against a bank account. */
function StatementUploadCard({ onImported }: { onImported: (msg: string) => void }) {
  const [accounts, setAccounts] = React.useState<BankAccount[]>([]);
  const [accountId, setAccountId] = React.useState("");
  const [statementDate, setStatementDate] = React.useState("");
  const [source, setSource] = React.useState("auto");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void (async () => {
      const r = await fetch("/api/atelier/wallet/bank/accounts", { credentials: "include" });
      const j = await r.json().catch(() => null);
      const rows: BankAccount[] = j?.data ?? [];
      setAccounts(rows);
      if (rows.length > 0) setAccountId((prev) => prev || rows[0].id);
    })();
  }, []);

  const upload = async () => {
    if (!file || !accountId || !statementDate) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("bankAccountId", accountId);
      form.append("statementDate", statementDate);
      if (source !== "auto") form.append("source", source);
      const r = await fetch("/api/atelier/wallet/bank/import-file", {
        method: "POST", credentials: "include", body: form,
      });
      const j = await r.json().catch(() => null);
      if (r.status === 409) {
        setErr("This statement file was already imported — no rows were duplicated.");
      } else if (!r.ok) {
        setErr(`Import failed: ${j?.message ?? j?.error ?? r.status}`);
      } else {
        const d = j?.data;
        const parseErrs = Array.isArray(d?.errors) && d.errors.length > 0 ? ` (${d.errors.length} rows skipped)` : "";
        onImported(`Statement imported — ${d?.rowsImported ?? 0} rows${parseErrs}. Auto-matcher ${d?.matcher?.status === "ok" ? "ran" : "reported issues"}.`);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-3 space-y-2" data-testid="statement-upload">
      <div className="font-mono text-xs text-text-faint uppercase">Import bank statement</div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <select className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
          value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="select-statement-account">
          {accounts.length === 0 && <option value="">No bank accounts</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.bankName} · {a.accountLabel} ····{a.accountNumberLast4}</option>
          ))}
        </select>
        <input type="date" className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
          value={statementDate} onChange={(e) => setStatementDate(e.target.value)} data-testid="input-statement-date" />
        <select className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
          value={source} onChange={(e) => setSource(e.target.value)} data-testid="select-statement-source">
          <option value="auto">Auto-detect format</option>
          <option value="csv">Generic CSV</option>
          <option value="xero">Xero export</option>
        </select>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="text-text-mute"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-statement-file" />
        <PillButton variant="primary" disabled={busy || !file || !accountId || !statementDate}
          data-testid="btn-statement-upload" onClick={() => void upload()}>
          {busy ? "Importing…" : "Upload & reconcile"}
        </PillButton>
      </div>
      <div className="text-[11px] text-text-faint">
        CSV columns: date, amount, counterparty, reference. Xero bank-statement exports are detected automatically. Re-uploading the same file never duplicates rows.
      </div>
      {err && <div className="text-xs font-mono text-danger" data-testid="statement-upload-error">{err}</div>}
    </Card>
  );
}

export default function WalletCash() {
  const [txns, setTxns] = React.useState<TriageTxn[]>([]);
  const [receipts, setReceipts] = React.useState<CashReceipt[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [matches, setMatches] = React.useState<MatchResp | null>(null);
  const [matching, setMatching] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [journalFor, setJournalFor] = React.useState<string | null>(null);
  const [journalAcct, setJournalAcct] = React.useState("6000");
  const [parkFor, setParkFor] = React.useState<string | null>(null);
  const [parkReason, setParkReason] = React.useState("");

  const load = React.useCallback(async () => {
    const [tr, rr] = await Promise.all([
      fetch("/api/atelier/wallet/cash/triage", { credentials: "include" }),
      fetch("/api/atelier/wallet/cash/receipts", { credentials: "include" }),
    ]);
    const tj = await tr.json();
    const rj = await rr.json();
    setTxns(tj?.data?.rows ?? []);
    setReceipts(rj?.data?.rows ?? []);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const act = async (label: string, fn: () => Promise<Response>) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fn();
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setNote(`${label} failed: ${j?.message ?? j?.error ?? r.status}`);
      } else {
        const gl = j?.data?.glPosting;
        setNote(gl?.status === "failed" ? `${label} done — GL posting failed: ${gl.message}` : `${label} done.`);
        setJournalFor(null); setParkFor(null); setParkReason("");
        await load();
      }
    } finally { setBusy(false); }
  };

  const confirmInflow = (t: TriageTxn, invoiceId?: string) =>
    act("Confirm", () => fetch(`/api/atelier/wallet/cash/triage/${t.id}/confirm`, {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invoiceId ? { invoiceId } : {}),
    }));

  const confirmOutflow = (t: TriageTxn, c: OutflowCandidate) =>
    act("Match", () => fetch(`/api/atelier/wallet/cash/triage/${t.id}/outflow-confirm`, {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refKind: c.refKind, refId: c.refId }),
    }));

  const journal = (t: TriageTxn) =>
    act("Journal", () => fetch(`/api/atelier/wallet/cash/triage/${t.id}/journal`, {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expenseAccountCode: journalAcct.trim() }),
    }));

  const park = (t: TriageTxn) =>
    act("Park", () => fetch(`/api/atelier/wallet/cash/triage/${t.id}/park`, {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: parkReason.trim() }),
    }));

  const runMatch = async (cashReceiptId: string) => {
    setMatching(true);
    setSelected(cashReceiptId);
    setMatches(null);
    try {
      const r = await fetch("/api/atelier/wallet/cash/match", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashReceiptId }),
      });
      const j = await r.json();
      setMatches(j?.data ?? null);
    } finally { setMatching(false); }
  };

  const apply = async (cashReceiptId: string, c: MatchCandidate) => {
    setBusy(true);
    try {
      await fetch("/api/atelier/wallet/cash/apply", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashReceiptId, applications: [{ invoiceId: c.invoiceId, appliedAmount: c.appliedAmount, rationale: c.rationale }] }),
      });
      setMatches(null); setSelected(null);
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen text-text" data-testid="page-wallet-cash">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Cash application"
          lede="Bank rows auto-matched on import. Confirm proposals, correct them, journal one-offs, or park items for later."
        />
      </PageHero>
      <SubSectionTabs
        tabs={[
        { id: "cash", label: "Cash", href: "/wallet/cash" },
        { id: "cash-recon", label: "Bank reconciliation", href: "/wallet/cash/recon" },
        { id: "treasury", label: "Treasury", href: "/wallet/treasury" },
        { id: "ar", label: "AR aging", href: "/wallet/ar" },
      ]}
      />
      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {note && (
          <div className="text-xs font-mono text-gold" data-testid="cash-action-note">{note}</div>
        )}

        <StatementUploadCard onImported={(msg) => { setNote(msg); void load(); }} />

        <Card className="overflow-hidden">
          <div className="px-3 pt-3 font-mono text-xs text-text-faint uppercase" data-testid="triage-head">
            Triage queue · {txns.length} open item{txns.length === 1 ? "" : "s"}
          </div>
          <table className="w-full text-sm" data-testid="cash-triage">
            <thead className="bg-bg-elevate/50 text-[11px] font-mono uppercase text-text-faint">
              <tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Counterparty</th><th className="text-right px-3 py-2">Amount</th><th className="text-left px-3 py-2">State</th><th className="text-left px-3 py-2">Proposal</th><th></th></tr>
            </thead>
            <tbody>
              {txns.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-text-mute">Queue is clear. Import a bank statement to triage new rows.</td></tr>
              )}
              {txns.map((t) => {
                const p = t.matchProposal;
                const isInflow = t.amount > 0;
                const recObj = typeof p?.recommended === "object" ? p.recommended : null;
                const rec = recObj?.invoiceId
                  ? recObj
                  : (p?.candidates?.[0]?.invoiceId
                      ? { invoiceId: p.candidates[0].invoiceId, invoiceNumber: p.candidates[0].invoiceNumber }
                      : null);
                const cands = (p?.candidates ?? []) as Array<MatchCandidate & OutflowCandidate>;
                return (
                  <React.Fragment key={t.id}>
                    <tr className="border-t border-border-soft" data-testid={`triage-row-${t.id}`}>
                      <td className="px-3 py-2 font-mono text-xs">{t.postedDate}</td>
                      <td className="px-3 py-2 text-xs">
                        <div>{t.counterpartyNameRaw ?? "—"}</div>
                        {t.referenceRaw && <div className="text-text-faint font-mono">{t.referenceRaw}</div>}
                        {t.matchedState === "parked" && t.parkedReason && (
                          <div className="text-danger text-[11px]">parked: {t.parkedReason}</div>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${isInflow ? "text-gold" : ""}`}>
                        {t.currency} {t.amount.toFixed(2)}
                      </td>
                      <td className="px-3 py-2"><MonoChip tone={stateTone[t.matchedState] ?? "default"}>{t.matchedState}</MonoChip></td>
                      <td className="px-3 py-2 text-xs text-text-mute max-w-[260px]">
                        {isInflow
                          ? (rec?.invoiceId ? `→ ${rec.invoiceNumber ?? rec.invoiceId}` : p?.rationaleSummary ?? "no proposal")
                          : (cands[0] ? `→ ${cands[0].label}` : "no candidate")}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                        {isInflow && rec?.invoiceId && (
                          <PillButton variant="primary" disabled={busy} data-testid={`btn-confirm-${t.id}`} onClick={() => confirmInflow(t)}>
                            Confirm
                          </PillButton>
                        )}
                        {!isInflow && cands[0] && (
                          <PillButton variant="primary" disabled={busy} data-testid={`btn-outflow-confirm-${t.id}`} onClick={() => confirmOutflow(t, cands[0])}>
                            Match
                          </PillButton>
                        )}
                        {!isInflow && (
                          <PillButton variant="ghost" disabled={busy} data-testid={`btn-journal-${t.id}`} onClick={() => { setJournalFor(journalFor === t.id ? null : t.id); setParkFor(null); }}>
                            Journal
                          </PillButton>
                        )}
                        {t.matchedState !== "parked" && (
                          <PillButton variant="ghost" disabled={busy} data-testid={`btn-park-${t.id}`} onClick={() => { setParkFor(parkFor === t.id ? null : t.id); setJournalFor(null); }}>
                            Park
                          </PillButton>
                        )}
                      </td>
                    </tr>
                    {(cands.length > 1 || (isInflow && cands.length > 0)) && (
                      <tr className="border-t border-border-soft/50 bg-bg-elevate/40">
                        <td colSpan={6} className="px-3 py-2">
                          <div className="text-[11px] font-mono text-text-faint uppercase mb-1">Candidates</div>
                          <ul className="space-y-1">
                            {cands.map((c, i) => (
                              <li key={i} className="flex items-center justify-between text-xs font-mono">
                                <span className="text-text-mute">{isInflow ? (c.invoiceNumber ?? c.invoiceId) : c.label} · {c.rationale}</span>
                                <span className="flex items-center gap-2">
                                  <span className="text-text-faint">{(c.confidence * 100).toFixed(0)}%</span>
                                  <PillButton variant="ghost" disabled={busy}
                                    data-testid={`btn-pick-${t.id}-${i}`}
                                    onClick={() => isInflow ? confirmInflow(t, c.invoiceId) : confirmOutflow(t, c)}>
                                    Use this
                                  </PillButton>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                    {journalFor === t.id && (
                      <tr className="bg-bg-elevate/40">
                        <td colSpan={6} className="px-3 py-2">
                          <div className="flex items-center gap-2 text-xs font-mono">
                            <span className="text-text-mute">Dr account code</span>
                            <input className="bg-bg border border-border-soft rounded px-2 py-1 w-24 text-text"
                              value={journalAcct} onChange={(e) => setJournalAcct(e.target.value)}
                              data-testid={`input-journal-acct-${t.id}`} />
                            <span className="text-text-faint">/ Cr 1000 cash · ${Math.abs(t.amount).toFixed(2)}</span>
                            <PillButton variant="primary" disabled={busy || !journalAcct.trim()} data-testid={`btn-journal-go-${t.id}`} onClick={() => journal(t)}>
                              Post journal
                            </PillButton>
                          </div>
                        </td>
                      </tr>
                    )}
                    {parkFor === t.id && (
                      <tr className="bg-bg-elevate/40">
                        <td colSpan={6} className="px-3 py-2">
                          <div className="flex items-center gap-2 text-xs font-mono">
                            <span className="text-text-mute">Reason</span>
                            <input className="bg-bg border border-border-soft rounded px-2 py-1 flex-1 text-text"
                              value={parkReason} onChange={(e) => setParkReason(e.target.value)}
                              placeholder="Why is this row parked?" data-testid={`input-park-reason-${t.id}`} />
                            <PillButton variant="primary" disabled={busy || parkReason.trim().length < 4} data-testid={`btn-park-go-${t.id}`} onClick={() => park(t)}>
                              Park item
                            </PillButton>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-3 pt-3 font-mono text-xs text-text-faint uppercase">Receipts</div>
          <table className="w-full text-sm" data-testid="cash-receipts">
            <thead className="bg-bg-elevate/50 text-[11px] font-mono uppercase text-text-faint">
              <tr><th className="text-left px-3 py-2">Receipt</th><th className="text-left px-3 py-2">Date</th><th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Applied</th><th className="text-right px-3 py-2">Remaining</th><th></th></tr>
            </thead>
            <tbody>
              {receipts.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-text-mute">No receipts. Import a bank statement and create receipts.</td></tr>
              )}
              {receipts.map((r) => {
                const remaining = Math.max(0, r.totalAmount - r.appliedAmount);
                return (
                  <tr key={r.id} className="border-t border-border-soft">
                    <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                    <td className="px-3 py-2">{r.receivedAt}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.currency} {r.totalAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.appliedAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      <MonoChip tone={remaining < 0.01 ? "green" : "gold"}>{remaining.toFixed(2)}</MonoChip>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {remaining > 0.01 && (
                        <PillButton variant="ghost" data-testid={`btn-match-${r.id}`} onClick={() => runMatch(r.id)}>
                          {matching && selected === r.id ? "Matching…" : "Match"}
                        </PillButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {selected && matches && (
          <Card className="p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="font-mono text-sm">Matcher proposals · <span className="text-gold">{matches.recommended}</span></div>
              <button className="text-text-mute text-xs hover:text-gold" onClick={() => { setMatches(null); setSelected(null); }}>close</button>
            </div>
            <div className="text-xs text-text-mute">{matches.rationaleSummary}</div>
            <ul className="divide-y divide-border-soft">
              {matches.candidates.map((c, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-xs font-mono">
                  <div className="flex-1">
                    <div className="text-text">{c.invoiceNumber ?? c.invoiceId}</div>
                    <div className="text-text-mute">{c.rationale}</div>
                  </div>
                  <div className="mx-3 text-text-mute">{(c.confidence * 100).toFixed(0)}%</div>
                  <PillButton variant="primary" data-testid={`btn-apply-${c.invoiceId}`} disabled={busy} onClick={() => apply(selected, c)}>
                    Apply ${c.appliedAmount.toFixed(2)}
                  </PillButton>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
