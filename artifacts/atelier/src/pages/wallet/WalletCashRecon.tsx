import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { WalletTabs } from "./walletTabs";

interface ReconSummary {
  txnCount: number;
  matchedCount: number;
  unmatchedCount: number;
  matchedTotal: number;
  unmatchedTotal: number;
  openExceptions: number;
}

interface ReconRow {
  id: string;
  bankAccountId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  computedReceipts: number;
  computedPayments: number;
  variance: number;
  status: string;
  reconSummary?: ReconSummary;
}

interface ExceptionRow {
  txnId: string;
  postedDate: string;
  amount: number;
  currency: string;
  counterpartyNameRaw: string | null;
  referenceRaw: string | null;
  matchedState: string;
  reasons: string[];
  detail: string | null;
}

interface BankAccount {
  id: string;
  bankName: string;
  accountLabel: string;
  accountNumberLast4: string;
}

interface ImportRow {
  id: string;
  bankAccountId: string;
  statementDate: string;
  source: string;
  rowsCount: number;
  importedAt: string;
  importedByName: string | null;
  hasFile: boolean;
}

const REASON_LABEL: Record<string, string> = {
  no_match: "no match",
  amount_mismatch: "amount differs",
  duplicate: "possible duplicate",
  flagged: "flagged",
  unreviewed_proposal: "needs review",
};
const REASON_TONE: Record<string, "red" | "gold" | "default"> = {
  no_match: "red", amount_mismatch: "red", duplicate: "red",
  flagged: "gold", unreviewed_proposal: "gold",
};

export default function WalletCashRecon() {
  const [rows, setRows] = React.useState<ReconRow[]>([]);
  const [accounts, setAccounts] = React.useState<BankAccount[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [exceptions, setExceptions] = React.useState<ExceptionRow[]>([]);
  const [loadingEx, setLoadingEx] = React.useState(false);
  const [ackFor, setAckFor] = React.useState<string | null>(null);
  const [ack, setAck] = React.useState(false);
  // open-period form
  const [showOpen, setShowOpen] = React.useState(false);
  const [openAcct, setOpenAcct] = React.useState("");
  const [openLabel, setOpenLabel] = React.useState("");
  const [openStart, setOpenStart] = React.useState("");
  const [openEnd, setOpenEnd] = React.useState("");
  const [openBal, setOpenBal] = React.useState("");
  const [closeBal, setCloseBal] = React.useState("");

  // Task #1076 — statement import history
  const [imports, setImports] = React.useState<ImportRow[]>([]);
  const [importsAcct, setImportsAcct] = React.useState<string>("");

  const load = React.useCallback(async () => {
    const [rr, ar, ir] = await Promise.all([
      fetch("/api/atelier/wallet/bank/recon", { credentials: "include" }),
      fetch("/api/atelier/wallet/bank/accounts", { credentials: "include" }),
      fetch("/api/atelier/wallet/bank/imports", { credentials: "include" }),
    ]);
    const rj = await rr.json().catch(() => null);
    const aj = await ar.json().catch(() => null);
    const ij = await ir.json().catch(() => null);
    setRows(rj?.data?.rows ?? []);
    setImports(ij?.data?.rows ?? []);
    const accts: BankAccount[] = aj?.data ?? [];
    setAccounts(accts);
    if (accts.length > 0) setOpenAcct((prev) => prev || accts[0].id);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const loadExceptions = async (id: string) => {
    setLoadingEx(true);
    try {
      const r = await fetch(`/api/atelier/wallet/bank/recon/${id}/exceptions`, { credentials: "include" });
      const j = await r.json().catch(() => null);
      setExceptions(j?.data?.exceptions ?? []);
    } finally { setLoadingEx(false); }
  };

  const toggleExpand = (id: string) => {
    if (expanded === id) { setExpanded(null); setExceptions([]); return; }
    setExpanded(id);
    setExceptions([]);
    void loadExceptions(id);
  };

  const classify = async (r: ReconRow, e: ExceptionRow, classification: string) => {
    setBusy(true);
    setNote(null);
    try {
      const resp = await fetch(`/api/atelier/wallet/cash/triage/${e.txnId}/classify`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classification }),
      });
      const j = await resp.json().catch(() => null);
      setNote(resp.ok ? `Marked as ${classification.replace("_", " ")}.` : `Failed: ${j?.message ?? j?.error ?? resp.status}`);
      await Promise.all([load(), loadExceptions(r.id)]);
    } finally { setBusy(false); }
  };

  const finalise = async (r: ReconRow, exceptionsAcknowledged: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const resp = await fetch(`/api/atelier/wallet/bank/recon/${r.id}/finalise`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rationale: exceptionsAcknowledged ? "Reviewed by partner; outstanding exceptions acknowledged." : "Reviewed by partner.",
          varianceAccepted: Math.abs(r.variance) > 0.01,
          exceptionsAcknowledged,
        }),
      });
      const j = await resp.json().catch(() => null);
      if (resp.status === 409 && j?.error === "exceptions_present") {
        setNote(`Cannot finalise: ${j.count} outstanding exception${j.count === 1 ? "" : "s"}. Resolve them or acknowledge below.`);
        setAckFor(r.id);
      } else if (!resp.ok) {
        setNote(`Finalise failed: ${j?.message ?? j?.error ?? resp.status}`);
      } else {
        setNote(`Period ${r.periodLabel} finalised.`);
        setAckFor(null); setAck(false);
      }
      await load();
    } finally { setBusy(false); }
  };

  const openPeriod = async () => {
    setBusy(true);
    setNote(null);
    try {
      const body: Record<string, unknown> = {
        bankAccountId: openAcct, periodLabel: openLabel.trim(),
        periodStart: openStart, periodEnd: openEnd,
      };
      if (openBal.trim() !== "") body.openingBalance = Number(openBal);
      if (closeBal.trim() !== "") body.closingBalance = Number(closeBal);
      const r = await fetch("/api/atelier/wallet/bank/recon", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) setNote(`Open period failed: ${j?.message ?? j?.error ?? r.status}`);
      else {
        setNote(`Period ${openLabel} opened.`);
        setShowOpen(false); setOpenLabel(""); setOpenStart(""); setOpenEnd(""); setOpenBal(""); setCloseBal("");
      }
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen text-text" data-testid="page-wallet-cash-recon">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Bank reconciliation"
          lede="Open reconciliation periods, work the exceptions, and finalise. Finalising locks the period for cash & bank entries."
        />
      </PageHero>
      <WalletTabs group="cash" />
      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {note && (
          <div className="text-xs font-mono text-gold" data-testid="recon-action-note">{note}</div>
        )}

        <div className="flex justify-end">
          <PillButton variant="ghost" data-testid="btn-open-period" onClick={() => setShowOpen((v) => !v)}>
            {showOpen ? "Cancel" : "Open period"}
          </PillButton>
        </div>
        {showOpen && (
          <Card className="p-3 space-y-2" data-testid="open-period-form">
            <div className="font-mono text-xs text-text-faint uppercase">Open reconciliation period</div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <select className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
                value={openAcct} onChange={(e) => setOpenAcct(e.target.value)} data-testid="select-period-account">
                {accounts.length === 0 && <option value="">No bank accounts</option>}
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.bankName} · {a.accountLabel} ····{a.accountNumberLast4}</option>
                ))}
              </select>
              <input className="bg-bg border border-border-soft rounded px-2 py-1 w-28 text-text" placeholder="2026-08"
                value={openLabel} onChange={(e) => setOpenLabel(e.target.value)} data-testid="input-period-label" />
              <input type="date" className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
                value={openStart} onChange={(e) => setOpenStart(e.target.value)} data-testid="input-period-start" />
              <span className="text-text-faint">→</span>
              <input type="date" className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
                value={openEnd} onChange={(e) => setOpenEnd(e.target.value)} data-testid="input-period-end" />
              <input className="bg-bg border border-border-soft rounded px-2 py-1 w-28 text-text" placeholder="Opening bal."
                value={openBal} onChange={(e) => setOpenBal(e.target.value)} data-testid="input-period-opening" />
              <input className="bg-bg border border-border-soft rounded px-2 py-1 w-28 text-text" placeholder="Closing bal."
                value={closeBal} onChange={(e) => setCloseBal(e.target.value)} data-testid="input-period-closing" />
              <PillButton variant="primary" disabled={busy || !openAcct || !openLabel.trim() || !openStart || !openEnd}
                data-testid="btn-period-create" onClick={() => void openPeriod()}>
                Open
              </PillButton>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <table className="w-full text-sm" data-testid="recon-rows">
            <thead className="bg-bg-elevate/50 text-[11px] font-mono uppercase text-text-faint">
              <tr>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-left px-3 py-2">Range</th>
                <th className="text-right px-3 py-2">Matched</th>
                <th className="text-right px-3 py-2">Unmatched</th>
                <th className="text-right px-3 py-2">Variance</th>
                <th className="text-left px-3 py-2">Exceptions</th>
                <th className="text-left px-3 py-2">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-text-mute">No reconciliation periods yet. Open one, then import a statement from the Cash tab.</td></tr>
              )}
              {rows.map((r) => {
                const s = r.reconSummary;
                const exCount = s?.openExceptions ?? 0;
                return (
                  <React.Fragment key={r.id}>
                    <tr className="border-t border-border-soft" data-testid={`recon-row-${r.id}`}>
                      <td className="px-3 py-2">{r.periodLabel}</td>
                      <td className="px-3 py-2 text-text-mute font-mono text-xs">{r.periodStart} → {r.periodEnd}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        ${s ? s.matchedTotal.toFixed(2) : "0.00"}
                        <span className="text-text-faint text-xs"> ({s?.matchedCount ?? 0})</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        ${s ? s.unmatchedTotal.toFixed(2) : "0.00"}
                        <span className="text-text-faint text-xs"> ({s?.unmatchedCount ?? 0})</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        <MonoChip tone={Math.abs(r.variance) > 0.01 ? "red" : "green"}>${r.variance.toFixed(2)}</MonoChip>
                      </td>
                      <td className="px-3 py-2">
                        <button className="inline-flex items-center gap-1 hover:opacity-80" data-testid={`btn-exceptions-${r.id}`}
                          onClick={() => toggleExpand(r.id)}>
                          <MonoChip tone={exCount > 0 ? "red" : "green"}>{exCount} open</MonoChip>
                          <span className="text-text-faint text-xs">{expanded === r.id ? "▾" : "▸"}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <MonoChip tone={r.status === "finalised" ? "green" : "gold"}>{r.status}</MonoChip>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.status !== "finalised" && (
                          <PillButton variant="primary" disabled={busy} data-testid={`btn-finalise-${r.id}`}
                            onClick={() => void finalise(r, false)}>
                            Finalise
                          </PillButton>
                        )}
                      </td>
                    </tr>
                    {ackFor === r.id && r.status !== "finalised" && (
                      <tr className="bg-bg-elevate/40">
                        <td colSpan={8} className="px-3 py-2">
                          <label className="flex items-center gap-2 text-xs font-mono text-text-mute">
                            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)}
                              data-testid={`chk-ack-${r.id}`} />
                            I have reviewed the outstanding exceptions and accept finalising this period with them unresolved.
                            <PillButton variant="primary" disabled={busy || !ack} data-testid={`btn-finalise-ack-${r.id}`}
                              onClick={() => void finalise(r, true)}>
                              Finalise anyway
                            </PillButton>
                          </label>
                        </td>
                      </tr>
                    )}
                    {expanded === r.id && (
                      <tr className="border-t border-border-soft/50 bg-bg-elevate/40">
                        <td colSpan={8} className="px-3 py-2">
                          <div className="text-[11px] font-mono text-text-faint uppercase mb-1">
                            Exceptions {loadingEx ? "· loading…" : `· ${exceptions.length}`}
                          </div>
                          {!loadingEx && exceptions.length === 0 && (
                            <div className="text-xs text-text-mute" data-testid={`exceptions-clear-${r.id}`}>All rows in this period are reconciled.</div>
                          )}
                          <ul className="space-y-1" data-testid={`exceptions-list-${r.id}`}>
                            {exceptions.map((e) => (
                              <li key={e.txnId} className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono" data-testid={`exception-${e.txnId}`}>
                                <span className="text-text-mute">
                                  {e.postedDate} · {e.counterpartyNameRaw ?? e.referenceRaw ?? "—"} · {e.currency} {e.amount.toFixed(2)}
                                  {e.detail && <span className="text-text-faint"> — {e.detail}</span>}
                                </span>
                                <span className="flex items-center gap-1">
                                  {e.reasons.map((reason) => (
                                    <MonoChip key={reason} tone={REASON_TONE[reason] ?? "default"}>{REASON_LABEL[reason] ?? reason}</MonoChip>
                                  ))}
                                  {r.status !== "finalised" && (
                                    <>
                                      <a className="underline text-text-mute hover:text-gold" href="/wallet/cash" data-testid={`link-resolve-${e.txnId}`}>match</a>
                                      <PillButton variant="ghost" disabled={busy} data-testid={`btn-fee-${e.txnId}`}
                                        onClick={() => void classify(r, e, "bank_fee")}>Fee</PillButton>
                                      <PillButton variant="ghost" disabled={busy} data-testid={`btn-transfer-${e.txnId}`}
                                        onClick={() => void classify(r, e, "internal_transfer")}>Transfer</PillButton>
                                      <PillButton variant="ghost" disabled={busy} data-testid={`btn-other-${e.txnId}`}
                                        onClick={() => void classify(r, e, "other")}>Other</PillButton>
                                    </>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* Task #1076 — statement import history with original-file download */}
        <Card className="overflow-hidden" data-testid="statement-imports-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="font-mono text-xs text-text-faint uppercase">Statement imports</div>
            <select className="bg-bg border border-border-soft rounded px-2 py-1 text-xs font-mono text-text"
              value={importsAcct} onChange={(e) => setImportsAcct(e.target.value)} data-testid="select-imports-account">
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.bankName} · {a.accountLabel} ····{a.accountNumberLast4}</option>
              ))}
            </select>
          </div>
          <table className="w-full text-sm" data-testid="statement-imports-rows">
            <thead className="bg-bg-elevate/50 text-[11px] font-mono uppercase text-text-faint">
              <tr>
                <th className="text-left px-3 py-2">Statement date</th>
                <th className="text-left px-3 py-2">Account</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-right px-3 py-2">Rows</th>
                <th className="text-left px-3 py-2">Imported</th>
                <th className="text-left px-3 py-2">By</th>
                <th className="text-right px-3 py-2">Original file</th>
              </tr>
            </thead>
            <tbody>
              {imports.filter((i) => !importsAcct || i.bankAccountId === importsAcct).length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-text-mute">No statement imports yet.</td></tr>
              )}
              {imports.filter((i) => !importsAcct || i.bankAccountId === importsAcct).map((i) => {
                const acct = accounts.find((a) => a.id === i.bankAccountId);
                return (
                  <tr key={i.id} className="border-t border-border-soft" data-testid={`import-row-${i.id}`}>
                    <td className="px-3 py-2 font-mono text-xs">{i.statementDate}</td>
                    <td className="px-3 py-2 text-text-mute text-xs">
                      {acct ? `${acct.accountLabel} ····${acct.accountNumberLast4}` : i.bankAccountId}
                    </td>
                    <td className="px-3 py-2"><MonoChip>{i.source}</MonoChip></td>
                    <td className="px-3 py-2 text-right font-mono">{i.rowsCount}</td>
                    <td className="px-3 py-2 text-text-mute font-mono text-xs">
                      {i.importedAt ? new Date(i.importedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-text-mute text-xs">{i.importedByName ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {i.hasFile ? (
                        <a className="underline text-text-mute hover:text-gold text-xs font-mono"
                          href={`/api/atelier/wallet/bank/imports/${i.id}/file`}
                          data-testid={`link-download-${i.id}`}>
                          Download
                        </a>
                      ) : (
                        <span className="text-text-faint text-xs font-mono" data-testid={`no-file-${i.id}`}>not stored</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
