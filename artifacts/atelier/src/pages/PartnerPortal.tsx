/**
 * Task #873 — Alliance-partner portal (the ENTIRE app surface for the
 * external `alliance_partner` role).
 *
 * Two pages, raw-fetch backed (the /partner-portal routes are bespoke —
 * not in the OpenAPI spec, mirroring the account-agent UI precedent):
 *   /partner                      — assigned opportunities list
 *   /partner/opportunities/:id    — opportunity detail + redacted
 *                                   client-overview tab
 *
 * Everything shown here is grant-scoped server-side; this UI never
 * receives (and must never render) contacts, financials, strategy or
 * documents for the client account.
 */

import * as React from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const API = `${import.meta.env.BASE_URL}api/atelier/partner-portal`;

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`request-failed:${r.status}`);
  return (await r.json()) as T;
}

async function postForm<T>(path: string, form: FormData): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const body = (await r.json().catch(() => null)) as
    | (T & { error?: string; message?: string })
    | null;
  if (!r.ok) throw new Error(body?.message ?? body?.error ?? `request-failed:${r.status}`);
  return body as T;
}

/** Task #875 — top-level portal navigation (Opportunities / Contracts / Billing). */
function PortalNav() {
  const [location] = useLocation();
  const tabs = [
    { href: "/partner", label: "Opportunities", active: location === "/partner" || location.startsWith("/partner/opportunities") },
    { href: "/partner/contracts", label: "Contracts", active: location.startsWith("/partner/contracts") },
    { href: "/partner/billing", label: "Billing", active: location.startsWith("/partner/billing") },
    { href: "/partner/company", label: "Company", active: location.startsWith("/partner/company") },
  ];
  return (
    <div className="mb-6 flex gap-2 border-b border-border" data-testid="partner-portal-nav">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`px-3 py-2 text-sm font-medium ${t.active ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          data-testid={`nav-partner-${t.label.toLowerCase()}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

type PartnerOpp = {
  id: string;
  name: string;
  salesStage: string;
  subStatus: string | null;
  nextMilestone: string;
  nextMilestoneDate: string | null;
  closeDate: string | null;
  accountId: string;
  createdAt: string;
  /** When the opportunity was shared with the firm (grant record). */
  sharedAt: string | null;
};

type OppListResponse = {
  firm: { id: string; name: string };
  opportunities: PartnerOpp[];
};

type AccountOverview = {
  name: string;
  brandName: string | null;
  sector: string;
  country: string;
  hqCity: string | null;
  size: string | null;
  employeeCount: number | null;
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium capitalize">
      {stage.replace(/_/g, " ")}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function PartnerPortalHome() {
  const q = useQuery({
    queryKey: ["partner-portal", "opportunities"],
    queryFn: () => getJson<OppListResponse>("/opportunities"),
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-portal-home">
      <PortalNav />
      <h1 className="text-2xl font-semibold">Your opportunities</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {q.data?.firm
          ? `Opportunities assigned to ${q.data.firm.name}.`
          : "Opportunities assigned to your firm."}
      </p>
      {q.isLoading && (
        <div className="mt-8 text-sm text-muted-foreground">Loading…</div>
      )}
      {q.isError && (
        <div className="mt-8 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          We couldn't load your assigned opportunities. If this persists,
          contact your Cognirise counterpart.
        </div>
      )}
      {q.data && q.data.opportunities.length === 0 && (
        <div
          className="mt-8 rounded-lg border border-border p-8 text-center"
          data-testid="partner-portal-empty"
        >
          <div className="text-base font-medium">
            {q.data.firm
              ? `Nothing is shared with ${q.data.firm.name} right now`
              : "Nothing is shared with your firm right now"}
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            This portal is where Cognirise shares the opportunities your firm is
            collaborating on. When an opportunity is assigned to your firm it
            will appear here automatically — there's nothing you need to set up.
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Expecting to see something? Contact your Cognirise counterpart and
            ask them to share the opportunity with your firm.
          </p>
        </div>
      )}
      <div className="mt-6 space-y-3">
        {q.data?.opportunities.map((o) => (
          <Link
            key={o.id}
            href={`/partner/opportunities/${o.id}`}
            className="block rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
            data-testid={`link-partner-opp-${o.id}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{o.name}</div>
              <StageBadge stage={o.salesStage} />
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              Next milestone: {o.nextMilestone || "—"}
              {o.nextMilestoneDate ? ` · ${fmtDate(o.nextMilestoneDate)}` : ""}
            </div>
            {o.sharedAt && (
              <div
                className="mt-1 text-xs text-muted-foreground"
                data-testid={`text-shared-at-${o.id}`}
              >
                Shared with you on {fmtDate(o.sharedAt)}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Task #875 — Contracts tab
// ===========================================================================

type PortalAgreement = {
  id: string;
  title: string;
  instrumentType: string;
  status: string;
  governingLaw: string;
  termStart: string | null;
  termEnd: string | null;
  fullyExecutedAt: string | null;
};
type SharedContract = {
  id: string;
  title: string;
  contractType: string;
  status: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  sharedAt: string;
  note: string | null;
  canDownload: boolean;
};
type InboxItem = {
  id: string;
  fileName: string;
  sizeBytes: number;
  note: string | null;
  status: "pending" | "accepted" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

function StatusChip({ value }: { value: string }) {
  const tone =
    value === "paid" || value === "accepted" || value === "signed" || value === "approved"
      ? "border-emerald-500/40 text-emerald-600"
      : value === "rejected" || value === "declined"
        ? "border-destructive/40 text-destructive"
        : "border-border text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function PartnerPortalContracts() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["partner-portal", "contracts"],
    queryFn: () =>
      getJson<{ firm: { id: string; name: string }; agreements: PortalAgreement[]; shared: SharedContract[] }>(
        "/contracts",
      ),
  });
  const inboxQ = useQuery({
    queryKey: ["partner-portal", "inbox"],
    queryFn: () => getJson<{ items: InboxItem[] }>("/inbox"),
  });
  const [note, setNote] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onUpload = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (note.trim()) form.append("note", note.trim());
      await postForm("/inbox", form);
      setFile(null);
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["partner-portal", "inbox"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-portal-contracts">
      <PortalNav />
      <h1 className="text-2xl font-semibold">Contracts</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Agreements between {q.data?.firm?.name ?? "your firm"} and Cognirise, plus documents shared with you.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Agreements</h2>
      {q.isLoading && <div className="mt-3 text-sm text-muted-foreground">Loading…</div>}
      {q.data && q.data.agreements.length === 0 && (
        <div className="mt-3 text-sm text-muted-foreground" data-testid="portal-agreements-empty">
          No agreements on file yet.
        </div>
      )}
      <div className="mt-3 space-y-2">
        {q.data?.agreements.map((a) => (
          <div key={a.id} className="rounded-lg border border-border p-4" data-testid={`portal-agreement-${a.id}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{a.title}</div>
              <StatusChip value={a.status} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground capitalize">
              {a.instrumentType.replace(/_/g, " ")}
              {a.governingLaw ? ` · ${a.governingLaw}` : ""}
              {a.termStart || a.termEnd
                ? ` · ${a.termStart?.slice(0, 10) ?? "—"} → ${a.termEnd?.slice(0, 10) ?? "open-ended"}`
                : ""}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Shared with you</h2>
      {q.data && q.data.shared.length === 0 && (
        <div className="mt-3 text-sm text-muted-foreground" data-testid="portal-shared-empty">
          No contracts have been shared with your firm yet.
        </div>
      )}
      <div className="mt-3 space-y-2">
        {q.data?.shared.map((c) => (
          <div key={c.id} className="rounded-lg border border-border p-4" data-testid={`portal-shared-${c.id}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{c.title}</div>
              <div className="flex items-center gap-2">
                <StatusChip value={c.status} />
                {c.canDownload && (
                  <a
                    href={`${API}/contracts/${c.id}/download`}
                    className="text-sm text-primary hover:underline"
                    data-testid={`link-download-${c.id}`}
                  >
                    Download PDF
                  </a>
                )}
              </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground capitalize">
              {c.contractType.replace(/_/g, " ")} · shared {fmtDate(c.sharedAt)}
            </div>
            {c.note && <div className="mt-1 text-xs text-muted-foreground">{c.note}</div>}
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Send a document for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a countersigned copy or other contract document. The Cognirise team reviews it before it is added to
        the contract record.
      </p>
      <div className="mt-3 rounded-lg border border-border p-4 space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
          data-testid="input-inbox-file"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for the reviewer (optional)"
          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          data-testid="input-inbox-note"
        />
        {err && <div className="text-sm text-destructive">{err}</div>}
        <button
          onClick={onUpload}
          disabled={!file || busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          data-testid="button-inbox-upload"
        >
          {busy ? "Uploading…" : "Upload for review"}
        </button>
      </div>
      {(inboxQ.data?.items.length ?? 0) > 0 && (
        <div className="mt-4 space-y-2">
          {inboxQ.data?.items.map((it) => (
            <div key={it.id} className="rounded-lg border border-border p-3 text-sm" data-testid={`portal-inbox-${it.id}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{it.fileName}</span>
                <StatusChip value={it.status} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Uploaded {fmtDate(it.createdAt)}
                {it.status === "rejected" && it.reviewNote ? ` · Reason: ${it.reviewNote}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Task #875 — Billing tab
// ===========================================================================

type PortalInvoice = {
  id: string;
  reference: string | null;
  periodLabel: string | null;
  invoiceDate: string | null;
  amount: number;
  currency: string;
  status: string;
  notes: string | null;
  fileName: string | null;
  submittedAt: string | null;
  rejectedReason: string | null;
  paidAt: string | null;
  remittanceRef: string | null;
};
type IssuedRcti = {
  id: string;
  invoiceNumber: string;
  weekIso: string;
  currency: string;
  totalAmount: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

export function PartnerPortalBilling() {
  const qc = useQueryClient();
  const invQ = useQuery({
    queryKey: ["partner-portal", "invoices"],
    queryFn: () => getJson<{ items: PortalInvoice[] }>("/invoices"),
  });
  const issuedQ = useQuery({
    queryKey: ["partner-portal", "issued"],
    queryFn: () => getJson<{ items: IssuedRcti[] }>("/issued"),
  });
  const [file, setFile] = React.useState<File | null>(null);
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [reference, setReference] = React.useState("");
  const [period, setPeriod] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onSubmit = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("amount", amount);
      form.append("currency", currency);
      form.append("reference", reference);
      if (period.trim()) form.append("periodLabel", period.trim());
      if (notes.trim()) form.append("notes", notes.trim());
      await postForm("/invoices", form);
      setFile(null);
      setAmount("");
      setReference("");
      setPeriod("");
      setNotes("");
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["partner-portal", "invoices"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-portal-billing">
      <PortalNav />
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Submit invoices to Cognirise and track their review, scheduling and payment.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Submit an invoice</h2>
      <div className="mt-3 rounded-lg border border-border p-4 space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
          data-testid="input-invoice-file"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            data-testid="input-invoice-amount"
          />
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            placeholder="Currency (e.g. USD)"
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            data-testid="input-invoice-currency"
          />
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Invoice reference"
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            data-testid="input-invoice-reference"
          />
        </div>
        <input
          type="text"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="Billing period (e.g. July 2026)"
          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          data-testid="input-invoice-period"
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          data-testid="input-invoice-notes"
        />
        {err && <div className="text-sm text-destructive">{err}</div>}
        <button
          onClick={onSubmit}
          disabled={!file || !amount || !reference.trim() || busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          data-testid="button-invoice-submit"
        >
          {busy ? "Submitting…" : "Submit invoice"}
        </button>
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your submitted invoices</h2>
      {invQ.data && invQ.data.items.length === 0 && (
        <div className="mt-3 text-sm text-muted-foreground" data-testid="portal-invoices-empty">
          No invoices submitted yet.
        </div>
      )}
      <div className="mt-3 space-y-2">
        {invQ.data?.items.map((i) => (
          <div key={i.id} className="rounded-lg border border-border p-4" data-testid={`portal-invoice-${i.id}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">
                {i.reference ?? i.id} · {i.currency} {i.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="flex items-center gap-2">
                <StatusChip value={i.status} />
                {i.fileName && (
                  <a
                    href={`${API}/invoices/${i.id}/file`}
                    className="text-sm text-primary hover:underline"
                    data-testid={`link-invoice-file-${i.id}`}
                  >
                    PDF
                  </a>
                )}
              </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {i.periodLabel ? `Period ${i.periodLabel} · ` : ""}
              Submitted {fmtDate(i.submittedAt)}
              {i.status === "rejected" && i.rejectedReason ? ` · Reason: ${i.rejectedReason}` : ""}
              {i.status === "paid" && i.paidAt ? ` · Paid ${fmtDate(i.paidAt)}${i.remittanceRef ? ` (ref ${i.remittanceRef})` : ""}` : ""}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Issued to you by Cognirise</h2>
      {issuedQ.data && issuedQ.data.items.length === 0 && (
        <div className="mt-3 text-sm text-muted-foreground" data-testid="portal-issued-empty">
          No Cognirise-issued invoices yet.
        </div>
      )}
      <div className="mt-3 space-y-2">
        {issuedQ.data?.items.map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-4" data-testid={`portal-issued-${r.id}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">
                {r.invoiceNumber} · {r.currency} {r.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <StatusChip value={r.status} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Period {r.weekIso}
              {r.paidAt ? ` · Paid ${fmtDate(r.paidAt)}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Task #1172 — Company profile tab (firm details, documents, contacts).
// These routes are under /api/atelier/partner/* (not partner-portal).
// ===========================================================================

const PARTNER_API = `${import.meta.env.BASE_URL}api/atelier/partner-portal`;

type FirmDoc = {
  id: string;
  kind: string;
  title: string | null;
  fileName: string;
  sizeBytes: number;
  issuedDate: string | null;
  expiryDate: string | null;
  reviewStatus: "pending" | "accepted" | "rejected";
  reviewNote?: string | null;
  createdAt: string;
};
type FirmContact = { id?: string; name: string; role?: string | null; email?: string | null };
type CompanyProfile = {
  firm: {
    name: string;
    legalName: string | null;
    registrationNumber: string | null;
    taxId: string | null;
    registeredAddress: string | null;
    bankIbanMasked: string | null;
    bankName: string | null;
    bankCurrency: string | null;
  };
  documents: FirmDoc[];
  contacts: FirmContact[];
  pendingContactSuggestion:
    | { id: string; proposedContacts: FirmContact[]; note: string | null; createdAt: string }
    | null;
};

const DOC_KIND_LABELS: Record<string, string> = {
  trade_license: "Trade license",
  certificate: "Certificate",
  insurance: "Insurance",
  vat_trn: "VAT / TRN registration",
  signatory_id: "Signatory ID",
  other: "Other",
};
function docKindLabel(kind: string): string {
  return DOC_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      const res = reader.result;
      if (typeof res !== "string") return reject(new Error("Could not read the file."));
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.readAsDataURL(file);
  });
}

const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DOC_MIME_ALLOW = ["application/pdf", "image/png", "image/jpeg"];
const DOC_KIND_OPTIONS = [
  { value: "trade_license", label: "Trade license" },
  { value: "certificate", label: "Certificate" },
  { value: "insurance", label: "Insurance" },
  { value: "vat_trn", label: "VAT / TRN registration" },
  { value: "signatory_id", label: "Signatory ID" },
  { value: "other", label: "Other" },
];

function ReviewChip({ status }: { status: FirmDoc["reviewStatus"] }) {
  const tone =
    status === "accepted"
      ? "border-emerald-500/40 text-emerald-600"
      : status === "rejected"
        ? "border-destructive/40 text-destructive"
        : "border-amber-500/40 text-amber-600";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>
      {status}
    </span>
  );
}

export function PartnerPortalCompany() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["partner-portal", "company-profile"],
    queryFn: async () => {
      const r = await fetch(`${PARTNER_API}/company-profile`, { credentials: "include" });
      if (!r.ok) throw new Error(`request-failed:${r.status}`);
      return (await r.json()) as CompanyProfile;
    },
  });

  // ---- document upload ----
  const [upKind, setUpKind] = React.useState("trade_license");
  const [upTitle, setUpTitle] = React.useState("");
  const [upIssued, setUpIssued] = React.useState("");
  const [upExpiry, setUpExpiry] = React.useState("");
  const [upFile, setUpFile] = React.useState<File | null>(null);
  const [upBusy, setUpBusy] = React.useState(false);
  const [upErr, setUpErr] = React.useState<string | null>(null);
  const upFileRef = React.useRef<HTMLInputElement>(null);

  const uploadDoc = async () => {
    setUpErr(null);
    if (!upFile) return setUpErr("Choose a file to upload.");
    if (!DOC_MIME_ALLOW.includes(upFile.type)) return setUpErr("Only PDF, PNG or JPEG files are accepted.");
    if (upFile.size > MAX_DOC_BYTES) return setUpErr("File is larger than 10MB.");
    setUpBusy(true);
    try {
      const base64 = await fileToBase64(upFile);
      const r = await fetch(`${PARTNER_API}/company-documents`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: upKind,
          fileName: upFile.name,
          mime: upFile.type,
          base64,
          title: upTitle.trim() || null,
          issuedDate: upIssued || null,
          expiryDate: upExpiry || null,
        }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!r.ok || !j?.ok) throw new Error(j?.message ?? `upload-failed:${r.status}`);
      setUpTitle("");
      setUpIssued("");
      setUpExpiry("");
      setUpFile(null);
      if (upFileRef.current) upFileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["partner-portal", "company-profile"] });
    } catch (e) {
      setUpErr((e as Error).message);
    } finally {
      setUpBusy(false);
    }
  };

  // ---- contact suggestion editor ----
  const [editingContacts, setEditingContacts] = React.useState(false);
  const [draftContacts, setDraftContacts] = React.useState<FirmContact[]>([]);
  const [suggestNote, setSuggestNote] = React.useState("");
  const [suggestBusy, setSuggestBusy] = React.useState(false);
  const [suggestErr, setSuggestErr] = React.useState<string | null>(null);

  const openContactEditor = () => {
    setDraftContacts((q.data?.contacts ?? []).map((c) => ({ ...c })));
    setSuggestNote("");
    setSuggestErr(null);
    setEditingContacts(true);
  };
  const submitSuggestion = async () => {
    setSuggestErr(null);
    const contacts = draftContacts
      .map((c) => ({
        name: c.name.trim(),
        role: (c.role ?? "").trim() || null,
        email: (c.email ?? "").trim() || null,
      }))
      .filter((c) => c.name.length > 0);
    if (contacts.length === 0) return setSuggestErr("Add at least one contact.");
    setSuggestBusy(true);
    try {
      const r = await fetch(`${PARTNER_API}/contact-suggestions`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contacts, note: suggestNote.trim() || null }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!r.ok || !j?.ok) throw new Error(j?.message ?? `request-failed:${r.status}`);
      setEditingContacts(false);
      void qc.invalidateQueries({ queryKey: ["partner-portal", "company-profile"] });
    } catch (e) {
      setSuggestErr((e as Error).message);
    } finally {
      setSuggestBusy(false);
    }
  };

  const firm = q.data?.firm;
  const pending = q.data?.pendingContactSuggestion ?? null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-portal-company">
      <PortalNav />
      <h1 className="text-2xl font-semibold">Company profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your firm's details on record with Cognirise, plus firm documents and contact people.
      </p>

      {q.isLoading && <div className="mt-8 text-sm text-muted-foreground">Loading…</div>}
      {q.isError && (
        <div className="mt-8 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          We couldn't load your company profile. If this persists, contact your Cognirise counterpart.
        </div>
      )}

      {firm && (
        <>
          {/* Firm details (read-only) */}
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Firm details</h2>
          <dl className="mt-3 grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2" data-testid="company-firm-details">
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Legal name</dt>
              <dd className="mt-1">{firm.legalName ?? firm.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Registration number</dt>
              <dd className="mt-1">{firm.registrationNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Tax / VAT ID</dt>
              <dd className="mt-1">{firm.taxId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Registered address</dt>
              <dd className="mt-1 whitespace-pre-wrap">{firm.registeredAddress ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Bank</dt>
              <dd className="mt-1">
                {firm.bankName ?? "—"}
                {firm.bankIbanMasked ? ` · ${firm.bankIbanMasked}` : ""}
                {firm.bankCurrency ? ` · ${firm.bankCurrency}` : ""}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            To change bank details, contact your Cognirise counterpart — changes are reviewed by finance.
          </p>

          {/* Documents */}
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Documents</h2>
          <div className="mt-3 space-y-2" data-testid="company-documents">
            {q.data && q.data.documents.length === 0 && (
              <div className="text-sm text-muted-foreground" data-testid="company-documents-empty">
                No documents uploaded yet.
              </div>
            )}
            {q.data?.documents.map((d) => (
              <div key={d.id} className="rounded-lg border border-border p-4" data-testid={`company-doc-${d.id}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{d.title || docKindLabel(d.kind)}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {docKindLabel(d.kind)} · {d.fileName} · {fmtBytes(d.sizeBytes)}
                      {d.expiryDate ? ` · expires ${d.expiryDate}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ReviewChip status={d.reviewStatus} />
                    <a
                      href={`${PARTNER_API}/company-documents/${d.id}/download`}
                      className="text-sm text-primary hover:underline"
                      data-testid={`link-company-doc-download-${d.id}`}
                    >
                      Download
                    </a>
                  </div>
                </div>
                {d.reviewStatus === "rejected" && d.reviewNote && (
                  <div className="mt-2 text-xs text-destructive" data-testid={`company-doc-note-${d.id}`}>
                    Reviewer note: {d.reviewNote}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Upload */}
          <h3 className="mt-6 text-sm font-semibold text-muted-foreground">Upload a document</h3>
          <div className="mt-3 space-y-3 rounded-lg border border-border p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                value={upKind}
                onChange={(e) => setUpKind(e.target.value)}
                className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                data-testid="input-company-doc-kind"
              >
                {DOC_KIND_OPTIONS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={upTitle}
                onChange={(e) => setUpTitle(e.target.value)}
                placeholder="Title (optional)"
                className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                data-testid="input-company-doc-title"
              />
              <input
                type="date"
                value={upIssued}
                onChange={(e) => setUpIssued(e.target.value)}
                placeholder="Issued"
                className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                data-testid="input-company-doc-issued"
              />
              <input
                type="date"
                value={upExpiry}
                onChange={(e) => setUpExpiry(e.target.value)}
                placeholder="Expiry"
                className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                data-testid="input-company-doc-expiry"
              />
            </div>
            <input
              ref={upFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              onChange={(e) => setUpFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
              data-testid="input-company-doc-file"
            />
            {upErr && <div className="text-sm text-destructive">{upErr}</div>}
            <button
              onClick={uploadDoc}
              disabled={!upFile || upBusy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              data-testid="button-company-doc-upload"
            >
              {upBusy ? "Uploading…" : "Upload document"}
            </button>
          </div>

          {/* Contacts */}
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contact people</h2>
          {pending && (
            <div
              className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
              data-testid="company-contact-suggestion-pending"
            >
              You have a pending contact change awaiting Cognirise review (submitted{" "}
              {fmtDate(pending.createdAt)}). It will apply once approved.
            </div>
          )}
          <div className="mt-3 space-y-2" data-testid="company-contacts">
            {q.data && q.data.contacts.length === 0 && (
              <div className="text-sm text-muted-foreground" data-testid="company-contacts-empty">
                No contacts on record yet.
              </div>
            )}
            {q.data?.contacts.map((c, i) => (
              <div key={c.id ?? i} className="rounded-lg border border-border p-3 text-sm" data-testid={`company-contact-${i}`}>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.role || "—"}
                  {c.email ? ` · ${c.email}` : ""}
                </div>
              </div>
            ))}
          </div>

          {!editingContacts ? (
            <button
              onClick={openContactEditor}
              disabled={!!pending}
              className="mt-3 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
              data-testid="button-suggest-contacts"
            >
              Suggest changes
            </button>
          ) : (
            <div className="mt-3 space-y-3 rounded-lg border border-border p-4" data-testid="company-contact-editor">
              <div className="text-sm font-medium">Suggest contact changes</div>
              <p className="text-xs text-muted-foreground">
                Cognirise reviews your proposed contact list before it replaces the current one.
              </p>
              {draftContacts.map((c, i) => (
                <div key={i} className="space-y-2 rounded-md border border-border p-3" data-testid={`draft-contact-${i}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase text-muted-foreground">Person {i + 1}</span>
                    <button
                      onClick={() => setDraftContacts((cs) => cs.filter((_, idx) => idx !== i))}
                      className="text-xs text-destructive hover:underline"
                      data-testid={`button-remove-draft-contact-${i}`}
                    >
                      remove
                    </button>
                  </div>
                  <input
                    value={c.name}
                    onChange={(e) =>
                      setDraftContacts((cs) => cs.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                    }
                    placeholder="Full name"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                    data-testid={`input-draft-contact-name-${i}`}
                  />
                  <input
                    value={c.role ?? ""}
                    onChange={(e) =>
                      setDraftContacts((cs) => cs.map((x, idx) => (idx === i ? { ...x, role: e.target.value } : x)))
                    }
                    placeholder="Role / title"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                    data-testid={`input-draft-contact-role-${i}`}
                  />
                  <input
                    type="email"
                    value={c.email ?? ""}
                    onChange={(e) =>
                      setDraftContacts((cs) => cs.map((x, idx) => (idx === i ? { ...x, email: e.target.value } : x)))
                    }
                    placeholder="Email"
                    className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                    data-testid={`input-draft-contact-email-${i}`}
                  />
                </div>
              ))}
              <button
                onClick={() => setDraftContacts((cs) => [...cs, { name: "", role: "", email: "" }])}
                className="w-full rounded-md border border-border px-3 py-2 text-sm text-primary"
                data-testid="button-add-draft-contact"
              >
                + Add a person
              </button>
              <input
                value={suggestNote}
                onChange={(e) => setSuggestNote(e.target.value)}
                placeholder="Note for the reviewer (optional)"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                data-testid="input-suggest-note"
              />
              {suggestErr && <div className="text-sm text-destructive">{suggestErr}</div>}
              <div className="flex items-center gap-3">
                <button
                  onClick={submitSuggestion}
                  disabled={suggestBusy}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  data-testid="button-submit-contact-suggestion"
                >
                  {suggestBusy ? "Submitting…" : "Submit for review"}
                </button>
                <button
                  onClick={() => setEditingContacts(false)}
                  className="rounded-md border border-border px-4 py-2 text-sm"
                  data-testid="button-cancel-contact-suggestion"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PartnerPortalOpportunity() {
  const [, params] = useRoute("/partner/opportunities/:oppId");
  const oppId = params?.oppId ?? "";
  const [tab, setTab] = React.useState<"opportunity" | "client">("opportunity");

  const oppQ = useQuery({
    queryKey: ["partner-portal", "opportunity", oppId],
    queryFn: () =>
      getJson<{ firm?: { id: string; name: string }; opportunity: PartnerOpp }>(
        `/opportunities/${oppId}`,
      ),
    enabled: !!oppId,
  });
  const acctQ = useQuery({
    queryKey: ["partner-portal", "opportunity", oppId, "account"],
    queryFn: () => getJson<{ account: AccountOverview }>(`/opportunities/${oppId}/account`),
    enabled: !!oppId && tab === "client",
  });

  const o = oppQ.data?.opportunity;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-portal-opportunity">
      <Link href="/partner" className="text-sm text-muted-foreground hover:underline">
        ← All opportunities
      </Link>
      {oppQ.isLoading && (
        <div className="mt-6 text-sm text-muted-foreground">Loading…</div>
      )}
      {oppQ.isError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          This opportunity is not available.
        </div>
      )}
      {o && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">{o.name}</h1>
            <StageBadge stage={o.salesStage} />
          </div>
          <div className="mt-1 text-sm text-muted-foreground" data-testid="text-opp-shared-context">
            {oppQ.data?.firm ? `Shared with ${oppQ.data.firm.name}` : "Shared with your firm"}
            {o.sharedAt ? ` on ${fmtDate(o.sharedAt)}` : ""}
          </div>
          <div className="mt-4 flex gap-2 border-b border-border">
            {(["opportunity", "client"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-sm font-medium ${
                  tab === t
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground"
                }`}
                data-testid={`tab-partner-${t}`}
              >
                {t === "opportunity" ? "Opportunity" : "Client overview"}
              </button>
            ))}
          </div>
          {tab === "opportunity" && (
            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Stage</dt>
                <dd className="mt-1 capitalize">{o.salesStage.replace(/_/g, " ")}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Sub-status</dt>
                <dd className="mt-1">{o.subStatus ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Next milestone</dt>
                <dd className="mt-1">
                  {o.nextMilestone || "—"}
                  {o.nextMilestoneDate ? ` (${fmtDate(o.nextMilestoneDate)})` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Expected close</dt>
                <dd className="mt-1">{fmtDate(o.closeDate)}</dd>
              </div>
            </dl>
          )}
          {tab === "client" && (
            <div className="mt-6">
              {acctQ.isLoading && (
                <div className="text-sm text-muted-foreground">Loading…</div>
              )}
              {acctQ.data && (
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Client</dt>
                    <dd className="mt-1">
                      {acctQ.data.account.name}
                      {acctQ.data.account.brandName
                        ? ` (${acctQ.data.account.brandName})`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Sector</dt>
                    <dd className="mt-1">{acctQ.data.account.sector}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Country</dt>
                    <dd className="mt-1">
                      {acctQ.data.account.country}
                      {acctQ.data.account.hqCity ? ` · ${acctQ.data.account.hqCity}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Size</dt>
                    <dd className="mt-1">
                      {acctQ.data.account.size ?? "—"}
                      {acctQ.data.account.employeeCount != null
                        ? ` · ~${acctQ.data.account.employeeCount.toLocaleString()} employees`
                        : ""}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
