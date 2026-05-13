import * as React from "react";
import { useLocation } from "wouter";
import { PageHero, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";

const FIXTURE_KEYS = [
  "riyadh_taxi_01",
  "riyadh_hotel_01",
  "riyadh_dinner_clientmeal",
  "dubai_taxi_01",
  "dubai_hotel_01",
  "dubai_dinner_01",
  "flight_riyadh_dubai_business",
  "flight_dubai_london_first",
  "software_chatgpt_team",
  "software_figma_org",
  "gift_client_riyadh",
  "gift_excessive_dubai",
];

interface Engagement { id: string; name: string }
interface CardOption {
  id: string;
  cardholderName: string;
  last4: string;
  network: string;
  issuingCurrency: string;
}
interface Finding { ruleId: string; severity: "amber" | "red"; category: string; message: string }
interface AuditorProposal {
  category: string;
  vatTreatment: string;
  vatAmount: number;
  clientBillable: boolean;
  markupPct: number;
  summary: string;
  ocrConfidence: "green" | "amber" | "red";
  refused?: boolean;
  reason?: string;
}
interface ExpenseDraft {
  id: string;
  usdAmount?: number;
  policyStatus: "green" | "amber" | "red";
  policyFindings: Finding[];
  auditorProposal: AuditorProposal | null;
}
interface CreateBody {
  captureSource: "manual" | "card_feed" | "mileage" | "per_diem";
  engagementId: string | null;
  expenseDate: string;
  amount?: number;
  currency?: string;
  merchant?: string;
  description?: string;
  vatCountry?: string | null;
  receiptFixtureKey?: string | null;
  receiptFileName?: string | null;
  cardId?: string | null;
  km?: number;
  days?: number;
  perDiemUsd?: number;
}

export default function WalletNewExpense() {
  const [, setLocation] = useLocation();
  const [path, setPath] = React.useState<"manual" | "card_feed" | "mileage" | "per_diem">("manual");
  const [engagements, setEngagements] = React.useState<Engagement[]>([]);
  const [cards, setCards] = React.useState<CardOption[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [proposal, setProposal] = React.useState<AuditorProposal | null>(null);
  const [draft, setDraft] = React.useState<ExpenseDraft | null>(null);

  // form fields
  const [engagementId, setEngagementId] = React.useState<string>("");
  const [merchant, setMerchant] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState<number>(0);
  const [currency, setCurrency] = React.useState("USD");
  const [vatCountry, setVatCountry] = React.useState("");
  const [fixtureKey, setFixtureKey] = React.useState<string>("riyadh_taxi_01");
  const [receiptFileName, setReceiptFileName] = React.useState<string>("");
  const [cardId, setCardId] = React.useState<string>("");
  const [km, setKm] = React.useState<number>(0);
  const [days, setDays] = React.useState<number>(1);
  const [perDiemUsd, setPerDiemUsd] = React.useState<number>(75);

  React.useEffect(() => {
    void fetch("/api/atelier/engagements", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setEngagements(d ?? []))
      .catch(() => setEngagements([]));
    void fetch("/api/atelier/wallet/cards", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { cards?: CardOption[] }) => setCards(d.cards ?? []))
      .catch(() => setCards([]));
  }, []);

  // Auto-pick the cardholder's currency when a card is selected.
  React.useEffect(() => {
    if (!cardId) return;
    const c = cards.find((x) => x.id === cardId);
    if (c) setCurrency(c.issuingCurrency);
  }, [cardId, cards]);

  async function createDraft() {
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const body: CreateBody = {
        captureSource: path,
        engagementId: engagementId || null,
        expenseDate: new Date().toISOString().slice(0, 10),
      };
      if (path === "manual" || path === "card_feed") {
        body.amount = amount;
        body.currency = currency;
        body.merchant = merchant;
        body.description = description;
        body.vatCountry = vatCountry || null;
        body.receiptFixtureKey = path === "manual" ? fixtureKey : null;
        body.receiptFileName = path === "manual" && receiptFileName ? receiptFileName : null;
        body.cardId = path === "card_feed" && cardId ? cardId : null;
      } else if (path === "mileage") {
        body.km = km;
        body.merchant = merchant || `Mileage ${km} km`;
      } else if (path === "per_diem") {
        body.days = days;
        body.perDiemUsd = perDiemUsd;
        body.merchant = merchant || `Per-diem ${days}d`;
        body.vatCountry = vatCountry || null;
      }
      const r = await fetch("/api/atelier/wallet/expenses", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`Create failed (${r.status})`);
      const j = await r.json();
      setDraft(j.expense);
      // Run auditor
      const ar = await fetch(`/api/atelier/wallet/expenses/${j.expense.id}/audit`, {
        method: "POST",
        credentials: "include",
      });
      if (!ar.ok) throw new Error(`Audit failed (${ar.status})`);
      const aj = await ar.json();
      setDraft(aj.expense);
      setProposal(aj.expense.auditorProposal);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(overrideRationale?: string) {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/atelier/wallet/expenses/${draft.id}/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overrideRationale }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.message || j.error || "Submit failed");
        if (j.findings) setDraft({ ...draft, policyFindings: j.findings as Finding[], policyStatus: String(j.error).includes("red") ? "red" : "amber" });
        return;
      }
      setLocation(`/wallet/expenses/${draft.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full bg-bg-deep border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-gold";
  const labelCls = "block text-[10px] font-mono uppercase tracking-wider text-text-mute mb-1";

  return (
    <div className="min-h-screen bg-bg text-text">
      <PageHero><div className="text-[11px] font-mono uppercase tracking-widest text-gold mb-2">WALLET</div><h1 className="text-3xl font-display tracking-tight">New expense</h1><p className="text-text-mute mt-2 max-w-2xl">Pick a capture path. The Auditor classifies, checks policy, and proposes VAT + billability.</p></PageHero>
      <TabNav>
        <TabNavLink href="/wallet" active={false}>Expenses</TabNavLink>
        <TabNavLink href="/wallet/expenses/new" active>+ New expense</TabNavLink>
        <TabNavLink href="/wallet/cards" active={false}>Cards</TabNavLink>
      </TabNav>

      <div className="px-6 py-6 max-w-3xl mx-auto space-y-6">
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["manual", "card_feed", "mileage", "per_diem"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPath(p)}
                className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wider border ${path === p ? "border-gold text-gold bg-gold/10" : "border-border text-text-mute hover:border-gold/40"}`}
                data-testid={`path-${p}`}
              >
                {p.replace("_", " ")}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Engagement (optional)</label>
              <select className={inputCls} value={engagementId} onChange={(e) => setEngagementId(e.target.value)} data-testid="select-engagement">
                <option value="">Firm overhead (no engagement)</option>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>

            {(path === "manual" || path === "card_feed") && (
              <>
                {path === "card_feed" && (
                  <div className="md:col-span-2">
                    <label className={labelCls}>Card-feed draft (pick a synthetic line)</label>
                    <select className={inputCls} value={cardId} onChange={(e) => setCardId(e.target.value)} data-testid="select-card">
                      <option value="">— select a card —</option>
                      {cards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.cardholderName} · {c.network} ••{c.last4} ({c.issuingCurrency})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className={labelCls}>Merchant</label>
                  <input className={inputCls} value={merchant} onChange={(e) => setMerchant(e.target.value)} data-testid="input-merchant" />
                </div>
                <div>
                  <label className={labelCls}>Amount</label>
                  <input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} data-testid="input-amount" />
                </div>
                <div>
                  <label className={labelCls}>Currency</label>
                  <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)} data-testid="select-currency">
                    <option>USD</option><option>SAR</option><option>AED</option><option>EUR</option><option>GBP</option><option>TRY</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>VAT country</label>
                  <select className={inputCls} value={vatCountry} onChange={(e) => setVatCountry(e.target.value)} data-testid="select-vat-country">
                    <option value="">— none —</option>
                    <option value="KSA">KSA (15%)</option>
                    <option value="UAE">UAE (5%)</option>
                    <option value="TR">TR (export)</option>
                    <option value="GB">GB (export)</option>
                  </select>
                </div>
                {path === "manual" && (
                  <>
                    <div className="md:col-span-2">
                      <label className={labelCls}>Receipt file (image / PDF — name only is captured for the encrypted ref)</label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className={inputCls}
                        onChange={(e) => setReceiptFileName(e.target.files?.[0]?.name ?? "")}
                        data-testid="input-receipt-file"
                      />
                      {receiptFileName ? (
                        <p className="text-[10px] font-mono text-text-mute mt-1">attached: {receiptFileName}</p>
                      ) : null}
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelCls}>OCR fixture (deterministic preview when no real OCR runs)</label>
                      <select className={inputCls} value={fixtureKey} onChange={(e) => setFixtureKey(e.target.value)} data-testid="select-fixture">
                        {FIXTURE_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <div className="md:col-span-2">
                  <label className={labelCls}>Description</label>
                  <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-description" />
                </div>
              </>
            )}

            {path === "mileage" && (
              <>
                <div>
                  <label className={labelCls}>Distance (km)</label>
                  <input type="number" className={inputCls} value={km} onChange={(e) => setKm(Number(e.target.value))} data-testid="input-km" />
                </div>
                <div>
                  <label className={labelCls}>Merchant / route</label>
                  <input className={inputCls} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Riyadh → Jeddah" />
                </div>
              </>
            )}

            {path === "per_diem" && (
              <>
                <div>
                  <label className={labelCls}>Days</label>
                  <input type="number" className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="input-days" />
                </div>
                <div>
                  <label className={labelCls}>Per-diem (USD/day)</label>
                  <input type="number" className={inputCls} value={perDiemUsd} onChange={(e) => setPerDiemUsd(Number(e.target.value))} />
                </div>
                <div>
                  <label className={labelCls}>VAT country</label>
                  <select className={inputCls} value={vatCountry} onChange={(e) => setVatCountry(e.target.value)}>
                    <option value="">— none —</option>
                    <option value="KSA">KSA</option>
                    <option value="UAE">UAE</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {!draft && (
            <button
              onClick={createDraft}
              disabled={busy}
              className="px-4 py-2 rounded bg-gold text-bg font-mono text-xs uppercase tracking-wider disabled:opacity-50"
              data-testid="button-create-draft"
            >
              {busy ? "Auditing…" : "Create draft + run Auditor"}
            </button>
          )}
          {error && <p className="text-xs text-red-400 font-mono">{error}</p>}
        </Card>

        {draft && proposal && (
          <Card className="p-5 space-y-4 border-l-4 border-l-gold">
            <h3 className="font-mono text-sm tracking-widest uppercase text-gold">Auditor proposal</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-text-mute">Category:</span> {proposal.category}</div>
              <div><span className="text-text-mute">VAT treatment:</span> {proposal.vatTreatment}</div>
              <div><span className="text-text-mute">VAT amount:</span> {proposal.vatAmount}</div>
              <div><span className="text-text-mute">Client billable:</span> {proposal.clientBillable ? "yes" : "no"}</div>
              <div><span className="text-text-mute">Markup:</span> {proposal.markupPct}%</div>
              <div><span className="text-text-mute">OCR confidence:</span> <MonoChip tone={proposal.ocrConfidence}>{proposal.ocrConfidence}</MonoChip></div>
            </div>
            {proposal.summary && <p className="text-sm italic text-text-mute">"{proposal.summary}"</p>}
            <div className="pt-2 border-t border-border-soft space-y-2">
              <div className="text-xs font-mono">USD {draft.usdAmount?.toFixed(2)} · policy <MonoChip tone={draft.policyStatus === "red" ? "red" : draft.policyStatus === "amber" ? "gold" : "green"}>{draft.policyStatus}</MonoChip></div>
              {draft.policyFindings?.length > 0 && (
                <ul className="text-xs font-mono">
                  {draft.policyFindings.map((f: Finding, i: number) => (
                    <li key={i} className={f.severity === "red" ? "text-red-400" : "text-amber-400"}>⚑ {f.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              {draft.policyStatus === "red" ? (
                <p className="text-xs text-red-400 font-mono">RED block — edit the inputs above and re-create the draft.</p>
              ) : draft.policyStatus === "amber" ? (
                <SubmitWithRationale onSubmit={submit} busy={busy} />
              ) : (
                <button onClick={() => submit()} disabled={busy} className="px-4 py-2 rounded bg-gold text-bg font-mono text-xs uppercase tracking-wider" data-testid="button-submit">
                  {busy ? "Submitting…" : "Submit for approval"}
                </button>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function SubmitWithRationale({ onSubmit, busy }: { onSubmit: (r: string) => void; busy: boolean }) {
  const [rat, setRat] = React.useState("");
  return (
    <div className="space-y-2 w-full">
      <textarea
        className="w-full bg-bg-deep border border-amber-500/40 rounded px-3 py-2 text-sm text-text"
        placeholder="AMBER override rationale (required to submit)…"
        value={rat}
        rows={2}
        onChange={(e) => setRat(e.target.value)}
        data-testid="input-override-rationale"
      />
      <button
        onClick={() => onSubmit(rat)}
        disabled={busy || rat.trim().length === 0}
        className="px-4 py-2 rounded bg-amber-500 text-bg font-mono text-xs uppercase tracking-wider disabled:opacity-50"
        data-testid="button-submit-with-override"
      >
        {busy ? "Submitting…" : "Submit with override"}
      </button>
    </div>
  );
}
