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

/**
 * Task #1173 — preview-as-partner. Internal leadership can open a firm's
 * portal read-only via /partners/preview/:firmId. When rendered inside a
 * PreviewFirmContext, every portal read sends the `x-partner-preview-firm`
 * header so the server scopes responses to that firm; every mutation is
 * blocked client-side too (belt-and-braces; the server also 403s writes in
 * preview) and mutation-only UI is hidden.
 *
 * Real partners render the SAME components with NO provider (firmId = null),
 * so their behaviour is completely unchanged.
 */
export type PreviewFirm = { firmId: string; firmName?: string } | null;
const PreviewFirmContext = React.createContext<PreviewFirm>(null);
export function PreviewFirmProvider({
  value,
  children,
}: {
  value: PreviewFirm;
  children: React.ReactNode;
}) {
  return <PreviewFirmContext.Provider value={value}>{children}</PreviewFirmContext.Provider>;
}
export function usePreviewFirm(): PreviewFirm {
  return React.useContext(PreviewFirmContext);
}

const PREVIEW_HEADER = "x-partner-preview-firm";
/** Sentinel error thrown by mutating helpers while in read-only preview. */
const PREVIEW_DISABLED_MSG = "disabled in preview";

/**
 * Portal fetch helpers, preview-aware. In preview mode reads inject the
 * `x-partner-preview-firm` header; mutations throw before touching the
 * network so a stray form submit can never write as the previewed firm.
 */
function usePortalApi() {
  const preview = usePreviewFirm();
  const previewFirmId = preview?.firmId ?? null;
  return React.useMemo(() => {
    const readHeaders: HeadersInit | undefined = previewFirmId
      ? { [PREVIEW_HEADER]: previewFirmId }
      : undefined;

    async function getJson<T>(path: string): Promise<T> {
      const r = await fetch(`${API}${path}`, {
        credentials: "include",
        headers: readHeaders,
      });
      if (!r.ok) throw new Error(`request-failed:${r.status}`);
      return (await r.json()) as T;
    }

    async function postForm<T>(path: string, form: FormData): Promise<T> {
      if (previewFirmId) throw new Error(PREVIEW_DISABLED_MSG);
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

    async function postJson<T>(path: string, payload: unknown): Promise<T> {
      if (previewFirmId) throw new Error(PREVIEW_DISABLED_MSG);
      const r = await fetch(`${API}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await r.json().catch(() => null)) as
        | (T & { error?: string; message?: string })
        | null;
      if (!r.ok) throw new Error(body?.message ?? body?.error ?? `request-failed:${r.status}`);
      return body as T;
    }

    return { getJson, postForm, postJson, previewFirmId, isPreview: !!previewFirmId };
  }, [previewFirmId]);
}

/** Task #875 — top-level portal navigation (Opportunities / Contracts / Billing). */
function PortalNav() {
  const [location] = useLocation();
  const api = usePortalApi();
  // In preview, tabs live under /partners/preview/:firmId/* so navigation
  // stays inside the read-only preview shell.
  const base = api.isPreview ? `/partners/preview/${api.previewFirmId}` : "/partner";
  const tabs = [
    { href: base, label: "Opportunities", active: location === base || location.startsWith(`${base}/opportunities`) },
    { href: `${base}/delivery`, label: "Delivery", active: location.startsWith(`${base}/delivery`) },
    { href: `${base}/contracts`, label: "Contracts", active: location.startsWith(`${base}/contracts`) },
    { href: `${base}/billing`, label: "Billing", active: location.startsWith(`${base}/billing`) },
    { href: `${base}/documents`, label: "Documents", active: location.startsWith(`${base}/documents`) },
    { href: `${base}/company`, label: "Company", active: location.startsWith(`${base}/company`) },
  ];
  return (
    <div
      className="mb-6 flex items-center gap-2 border-b border-border"
      data-testid="partner-portal-nav"
    >
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
      <div className="ml-auto">
        <NotificationBell />
      </div>
    </div>
  );
}

// ===========================================================================
// Task #1173 — partner-portal notifications (bell + dropdown panel).
// Raw-fetch backed; server contract may not exist yet, so a 404 (or any
// non-OK) is treated as an empty inbox rather than an error surface.
// ===========================================================================

type PortalNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};
type NotificationsResponse = { items: PortalNotification[]; unreadCount: number };

const EMPTY_NOTIFICATIONS: NotificationsResponse = { items: [], unreadCount: 0 };

function fmtRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const secs = Math.round((Date.now() - then) / 1000);
    if (secs < 60) return "just now";
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return fmtDate(iso);
  } catch {
    return fmtDate(iso);
  }
}

function NotificationBell() {
  const api = usePortalApi();
  const [, setLocation] = useLocation();
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "notifications"],
    // Treat a missing/404 endpoint as an empty inbox — the server half of
    // this feature ships in parallel and may not be live yet.
    queryFn: () =>
      api
        .getJson<NotificationsResponse>("/notifications")
        .catch(() => EMPTY_NOTIFICATIONS),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const data = q.data ?? EMPTY_NOTIFICATIONS;
  const unread = data.unreadCount ?? 0;

  // Close the panel on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const markRead = async (id: string) => {
    // Read-marking is a mutation — blocked in preview (client + server).
    if (api.isPreview) return;
    try {
      await api.postJson(`/notifications/${id}/read`, {});
    } catch {
      // best-effort; keep the UI responsive even if the endpoint 404s
    }
    void q.refetch();
  };

  const markAllRead = async () => {
    if (api.isPreview) return;
    try {
      await api.postJson("/notifications/read-all", {});
    } catch {
      // best-effort
    }
    void q.refetch();
  };

  const onClickItem = (n: PortalNotification) => {
    setOpen(false);
    if (!n.readAt) void markRead(n.id);
    if (n.href) {
      // Internal portal routes → wouter navigation; anything else → hard nav.
      if (n.href.startsWith("/")) {
        // In preview keep navigation inside the read-only preview shell by
        // rewriting /partner/* hrefs onto /partners/preview/:firmId/*.
        const href =
          api.isPreview && n.href.startsWith("/partner")
            ? `/partners/preview/${api.previewFirmId}${n.href.slice("/partner".length)}`
            : n.href;
        setLocation(href);
      } else window.location.href = n.href;
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        aria-label="Notifications"
        data-testid="button-notification-bell"
      >
        {/* Inline bell glyph — avoids pulling an icon dep into this raw page. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
            data-testid="badge-notification-unread"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-border bg-background shadow-lg"
          data-testid="notification-panel"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && !api.isPreview && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-primary hover:underline"
                data-testid="button-notification-mark-all"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.items.length === 0 ? (
              <div
                className="px-4 py-8 text-center text-sm text-muted-foreground"
                data-testid="notification-empty"
              >
                You're all caught up.
              </div>
            ) : (
              data.items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onClickItem(n)}
                  className={`block w-full border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/50 ${n.readAt ? "" : "bg-primary/5"}`}
                  data-testid={`notification-item-${n.id}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{n.title}</div>
                      {n.body && (
                        <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {n.body}
                        </div>
                      )}
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {fmtRelative(n.createdAt)}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
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
  const api = usePortalApi();
  const oppBase = api.isPreview
    ? `/partners/preview/${api.previewFirmId}`
    : "/partner";
  const q = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "opportunities"],
    queryFn: () => api.getJson<OppListResponse>("/opportunities"),
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
            href={`${oppBase}/opportunities/${o.id}`}
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
  const api = usePortalApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "contracts"],
    queryFn: () =>
      api.getJson<{ firm: { id: string; name: string }; agreements: PortalAgreement[]; shared: SharedContract[] }>(
        "/contracts",
      ),
  });
  const inboxQ = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "inbox"],
    queryFn: () => api.getJson<{ items: InboxItem[] }>("/inbox"),
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
      await api.postForm("/inbox", form);
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
                {c.canDownload && !api.isPreview && (
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

      {!api.isPreview && (
        <>
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
        </>
      )}
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
  const api = usePortalApi();
  const qc = useQueryClient();
  const invQ = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "invoices"],
    queryFn: () => api.getJson<{ items: PortalInvoice[] }>("/invoices"),
  });
  const issuedQ = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "issued"],
    queryFn: () => api.getJson<{ items: IssuedRcti[] }>("/issued"),
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
      await api.postForm("/invoices", form);
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

      {!api.isPreview && (
        <>
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
        </>
      )}

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
                {i.fileName && !api.isPreview && (
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
  const api = usePortalApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "company-profile"],
    queryFn: () => api.getJson<CompanyProfile>("/company-profile"),
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
      const j = await api.postJson<{ ok?: boolean; message?: string }>(
        "/company-documents",
        {
          kind: upKind,
          fileName: upFile.name,
          mime: upFile.type,
          base64,
          title: upTitle.trim() || null,
          issuedDate: upIssued || null,
          expiryDate: upExpiry || null,
        },
      );
      if (!j?.ok) throw new Error(j?.message ?? "upload-failed");
      setUpTitle("");
      setUpIssued("");
      setUpExpiry("");
      setUpFile(null);
      if (upFileRef.current) upFileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["partner-portal", api.previewFirmId, "company-profile"] });
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
      const j = await api.postJson<{ ok?: boolean; message?: string }>(
        "/contact-suggestions",
        { contacts, note: suggestNote.trim() || null },
      );
      if (!j?.ok) throw new Error(j?.message ?? "request-failed");
      setEditingContacts(false);
      void qc.invalidateQueries({ queryKey: ["partner-portal", api.previewFirmId, "company-profile"] });
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
                    {!api.isPreview && (
                      <a
                        href={`${PARTNER_API}/company-documents/${d.id}/download`}
                        className="text-sm text-primary hover:underline"
                        data-testid={`link-company-doc-download-${d.id}`}
                      >
                        Download
                      </a>
                    )}
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
          {!api.isPreview && (
          <>
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
          </>
          )}

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

          {api.isPreview ? null : !editingContacts ? (
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
  const api = usePortalApi();
  // In preview the route is /partners/preview/:firmId/opportunities/:oppId;
  // otherwise the real partner route /partner/opportunities/:oppId.
  const [, realParams] = useRoute("/partner/opportunities/:oppId");
  const [, previewParams] = useRoute("/partners/preview/:firmId/opportunities/:oppId");
  const oppId = previewParams?.oppId ?? realParams?.oppId ?? "";
  const oppBase = api.isPreview
    ? `/partners/preview/${api.previewFirmId}`
    : "/partner";
  const [tab, setTab] = React.useState<"opportunity" | "client">("opportunity");

  const oppQ = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "opportunity", oppId],
    queryFn: () =>
      api.getJson<{ firm?: { id: string; name: string }; opportunity: PartnerOpp }>(
        `/opportunities/${oppId}`,
      ),
    enabled: !!oppId,
  });
  const acctQ = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "opportunity", oppId, "account"],
    queryFn: () => api.getJson<{ account: AccountOverview }>(`/opportunities/${oppId}/account`),
    enabled: !!oppId && tab === "client",
  });

  const o = oppQ.data?.opportunity;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-portal-opportunity">
      <Link href={oppBase} className="text-sm text-muted-foreground hover:underline">
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

// ===========================================================================
// Task #1174 — Delivery view (shared engagements) + shared documents.
// Raw-fetch backed; the server half ships in parallel, so any non-OK read is
// treated as an EMPTY result (mirroring the #1173 notification bell) rather
// than an error surface — the partner sees a friendly empty state instead.
// ===========================================================================

type PartnerEngagement = {
  id: string;
  name: string;
  plmStage: string | null;
  raidStatus: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  sharedAt: string | null;
};
type DeliveryListResponse = {
  firm?: { id: string; name: string };
  engagements: PartnerEngagement[];
};
const EMPTY_DELIVERY: DeliveryListResponse = { engagements: [] };

type PartnerDeliverable = {
  name: string;
  type: string | null;
  status: string;
  dueDate: string | null;
  sentAt: string | null;
};
type PartnerOpenItem = {
  kind: string;
  severity: string | null;
  status: string;
  dueDate: string | null;
  description: string;
};
type PartnerMeeting = {
  title: string;
  date: string | null;
  kind: string | null;
};
type DeliveryDetailResponse = {
  engagement: PartnerEngagement & { account?: AccountOverview | null };
  account?: AccountOverview | null;
  deliverables: PartnerDeliverable[];
  openItems: PartnerOpenItem[];
  upcomingMeetings: PartnerMeeting[];
};

/** Health dot keyed off the engagement RAID status (green/amber/red). */
function HealthDot({ status }: { status: string | null }) {
  const tone =
    status === "green"
      ? "bg-emerald-500"
      : status === "amber"
        ? "bg-amber-500"
        : status === "red"
          ? "bg-destructive"
          : "bg-muted-foreground/40";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone}`}
      title={status ? `Health: ${status}` : "Health: unknown"}
      data-testid="partner-health-dot"
      aria-label={status ? `Health ${status}` : "Health unknown"}
    />
  );
}

export function PartnerPortalDelivery() {
  const api = usePortalApi();
  const engBase = api.isPreview
    ? `/partners/preview/${api.previewFirmId}`
    : "/partner";
  const q = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "delivery"],
    // Server half ships in parallel; treat a 404/non-OK as an empty list.
    queryFn: () =>
      api.getJson<DeliveryListResponse>("/delivery").catch(() => EMPTY_DELIVERY),
  });

  const data = q.data ?? EMPTY_DELIVERY;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-delivery-home">
      <PortalNav />
      <h1 className="text-2xl font-semibold">Delivery</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {data.firm
          ? `Engagements shared with ${data.firm.name}.`
          : "Engagements shared with your firm."}
      </p>
      {q.isLoading && <div className="mt-8 text-sm text-muted-foreground">Loading…</div>}
      {!q.isLoading && data.engagements.length === 0 && (
        <div
          className="mt-8 rounded-lg border border-border p-8 text-center"
          data-testid="partner-delivery-empty"
        >
          <div className="text-base font-medium">
            {data.firm
              ? `Nothing is shared with ${data.firm.name} right now`
              : "Nothing is shared with your firm right now"}
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            This is where Cognirise shares the engagements your firm is helping
            deliver. When an engagement is shared with your firm it will appear
            here automatically — there's nothing you need to set up.
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Expecting to see something? Contact your Cognirise counterpart and
            ask them to share the engagement with your firm.
          </p>
        </div>
      )}
      <div className="mt-6 space-y-3">
        {data.engagements.map((e) => (
          <Link
            key={e.id}
            href={`${engBase}/delivery/${e.id}`}
            className="block rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
            data-testid={`link-partner-eng-${e.id}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <HealthDot status={e.raidStatus} />
                <span className="font-medium">{e.name}</span>
              </div>
              {e.plmStage && <StageBadge stage={e.plmStage} />}
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {fmtDate(e.startDate)} → {e.plannedEndDate ? fmtDate(e.plannedEndDate) : "open-ended"}
            </div>
            {e.sharedAt && (
              <div className="mt-1 text-xs text-muted-foreground">
                Shared with you on {fmtDate(e.sharedAt)}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function SeverityBadge({ value }: { value: string | null }) {
  if (!value) return null;
  const tone =
    value === "high" || value === "critical"
      ? "border-destructive/40 text-destructive"
      : value === "medium"
        ? "border-amber-500/40 text-amber-600"
        : "border-border text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function PartnerPortalDeliveryDetail() {
  const api = usePortalApi();
  const [, realParams] = useRoute("/partner/delivery/:engId");
  const [, previewParams] = useRoute("/partners/preview/:firmId/delivery/:engId");
  const engId = previewParams?.engId ?? realParams?.engId ?? "";
  const engBase = api.isPreview
    ? `/partners/preview/${api.previewFirmId}`
    : "/partner";

  const q = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "delivery", engId],
    queryFn: () => api.getJson<DeliveryDetailResponse>(`/delivery/${engId}`),
    enabled: !!engId,
  });

  const eng = q.data?.engagement;
  // Server nests the redacted account overview under engagement.account.
  const account = q.data?.engagement?.account ?? q.data?.account ?? null;
  const deliverables = q.data?.deliverables ?? [];
  const openItems = q.data?.openItems ?? [];
  const meetings = q.data?.upcomingMeetings ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-delivery-detail">
      <Link href={`${engBase}/delivery`} className="text-sm text-muted-foreground hover:underline">
        ← All engagements
      </Link>
      {q.isLoading && <div className="mt-6 text-sm text-muted-foreground">Loading…</div>}
      {q.isError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          This engagement is not available.
        </div>
      )}
      {eng && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <HealthDot status={eng.raidStatus} />
              <h1 className="text-2xl font-semibold">{eng.name}</h1>
            </div>
            {eng.plmStage && <StageBadge stage={eng.plmStage} />}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {fmtDate(eng.startDate)} → {eng.plannedEndDate ? fmtDate(eng.plannedEndDate) : "open-ended"}
            {eng.sharedAt ? ` · shared ${fmtDate(eng.sharedAt)}` : ""}
          </div>
          {account && (
            <div className="mt-4 flex flex-wrap gap-2" data-testid="delivery-account-chips">
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                {account.name}
                {account.brandName ? ` (${account.brandName})` : ""}
              </span>
              {account.sector && (
                <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {account.sector}
                </span>
              )}
              {account.country && (
                <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {account.country}
                  {account.hqCity ? ` · ${account.hqCity}` : ""}
                </span>
              )}
              {account.size && (
                <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {account.size}
                </span>
              )}
            </div>
          )}

          {/* Deliverables */}
          <section className="mt-8" data-testid="section-deliverables">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Deliverables
            </h2>
            {deliverables.length === 0 ? (
              <div className="mt-3 text-sm text-muted-foreground" data-testid="deliverables-empty">
                No deliverables have been shared yet.
              </div>
            ) : (
              <div className="mt-3 overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliverables.map((d, i) => (
                      <tr key={`${d.name}-${i}`} className="border-t border-border" data-testid={`row-deliverable-${i}`}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{d.name}</div>
                          {d.type && (
                            <div className="text-xs capitalize text-muted-foreground">
                              {d.type.replace(/_/g, " ")}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusChip value={d.status} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{fmtDate(d.dueDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Open items */}
          <section className="mt-8" data-testid="section-open-items">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Open items
            </h2>
            {openItems.length === 0 ? (
              <div className="mt-3 text-sm text-muted-foreground" data-testid="open-items-empty">
                No open items shared with your firm.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {openItems.map((it, i) => (
                  <div key={i} className="rounded-lg border border-border p-3 text-sm" data-testid={`row-open-item-${i}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                        {it.kind.replace(/_/g, " ")}
                      </span>
                      <SeverityBadge value={it.severity} />
                      <StatusChip value={it.status} />
                    </div>
                    <div className="mt-1.5">{it.description}</div>
                    {it.dueDate && (
                      <div className="mt-1 text-xs text-muted-foreground">Due {fmtDate(it.dueDate)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Upcoming shared meetings */}
          <section className="mt-8" data-testid="section-meetings">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Upcoming shared meetings
            </h2>
            {meetings.length === 0 ? (
              <div className="mt-3 text-sm text-muted-foreground" data-testid="meetings-empty">
                No upcoming meetings shared with your firm.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {meetings.map((m, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm" data-testid={`row-meeting-${i}`}>
                    <div>
                      <div className="font-medium">{m.title}</div>
                      {m.kind && (
                        <div className="text-xs capitalize text-muted-foreground">
                          {m.kind.replace(/_/g, " ")}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{fmtDate(m.date)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Task #1174 — Documents (shared with the firm + firm's own uploads).
// ===========================================================================

type SharedDoc = {
  id: string;
  title: string;
  fileName: string | null;
  sizeBytes: number | null;
  sharedAt: string | null;
  note: string | null;
};
type DocUpload = {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  status: "pending_review" | "accepted" | "rejected" | string;
  createdAt: string | null;
};
type DocumentsResponse = {
  firm?: { id: string; name: string };
  shared: SharedDoc[];
  uploads: DocUpload[];
};
const EMPTY_DOCUMENTS: DocumentsResponse = { shared: [], uploads: [] };

/**
 * Download a shared document. For real partners a plain anchor to the API
 * (with cookie credentials) works. In preview the server only authorises the
 * download via the x-partner-preview-firm header, which an anchor can't send,
 * so preview fetches the bytes with the header and triggers a blob download.
 */
function DownloadDocButton({ id, fileName }: { id: string; fileName: string | null }) {
  const api = usePortalApi();
  const [busy, setBusy] = React.useState(false);

  if (!api.isPreview) {
    return (
      <a
        href={`${API}/documents/${id}/download`}
        className="text-sm text-primary hover:underline"
        data-testid={`button-download-doc-${id}`}
      >
        Download
      </a>
    );
  }

  const onDownload = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/documents/${id}/download`, {
        credentials: "include",
        headers: { [PREVIEW_HEADER]: api.previewFirmId ?? "" },
      });
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName ?? "document";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* best-effort in preview */
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onDownload}
      disabled={busy}
      className="text-sm text-primary hover:underline disabled:opacity-50"
      data-testid={`button-download-doc-${id}`}
    >
      {busy ? "Downloading…" : "Download"}
    </button>
  );
}

export function PartnerPortalDocuments() {
  const api = usePortalApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["partner-portal", api.previewFirmId, "documents"],
    // Server half ships in parallel; treat a 404/non-OK as empty.
    queryFn: () =>
      api.getJson<DocumentsResponse>("/documents").catch(() => EMPTY_DOCUMENTS),
  });

  const data = q.data ?? EMPTY_DOCUMENTS;

  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState("");
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
      await api.postForm("/documents", form);
      setFile(null);
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({
        queryKey: ["partner-portal", api.previewFirmId, "documents"],
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-documents">
      <PortalNav />
      <h1 className="text-2xl font-semibold">Documents</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Documents Cognirise has shared with {data.firm?.name ?? "your firm"}, plus files your firm has sent for review.
      </p>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Shared with your firm
      </h2>
      {q.isLoading && <div className="mt-3 text-sm text-muted-foreground">Loading…</div>}
      {!q.isLoading && data.shared.length === 0 && (
        <div className="mt-3 text-sm text-muted-foreground" data-testid="shared-docs-empty">
          No documents have been shared with your firm yet.
        </div>
      )}
      <div className="mt-3 space-y-2">
        {data.shared.map((d) => (
          <div key={d.id} className="rounded-lg border border-border p-4" data-testid={`shared-doc-${d.id}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{d.title}</div>
                <div className="text-xs text-muted-foreground">
                  {d.fileName ? `${d.fileName}` : ""}
                  {d.sizeBytes != null ? ` · ${fmtBytes(d.sizeBytes)}` : ""}
                  {d.sharedAt ? ` · shared ${fmtDate(d.sharedAt)}` : ""}
                </div>
              </div>
              <DownloadDocButton id={d.id} fileName={d.fileName} />
            </div>
            {d.note && <div className="mt-1 text-xs text-muted-foreground">{d.note}</div>}
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Your uploads
      </h2>
      {data.uploads.length === 0 && (
        <div className="mt-3 text-sm text-muted-foreground" data-testid="uploads-empty">
          Your firm hasn't uploaded any documents for review yet.
        </div>
      )}
      <div className="mt-3 space-y-2">
        {data.uploads.map((u) => (
          <div key={u.id} className="rounded-lg border border-border p-3 text-sm" data-testid={`upload-status-${u.id}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{u.fileName}</span>
              <div className="flex items-center gap-2">
              <DownloadDocButton id={u.id} fileName={u.fileName} />
              <StatusChip
                value={
                  u.status === "pending_review"
                    ? "pending review"
                    : u.status === "accepted"
                      ? "accepted"
                      : u.status === "rejected"
                        ? "rejected"
                        : u.status
                }
              />
              </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {u.sizeBytes != null ? `${fmtBytes(u.sizeBytes)} · ` : ""}
              Uploaded {fmtDate(u.createdAt)}
            </div>
          </div>
        ))}
      </div>

      {/* Upload-for-review — hidden entirely in read-only preview. */}
      {!api.isPreview && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Send a document for review
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a document for the Cognirise team to review. It stays pending
            until they accept it.
          </p>
          <div className="mt-3 space-y-3 rounded-lg border border-border p-4">
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
              data-testid="input-doc-file"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the reviewer (optional)"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              data-testid="input-doc-note"
            />
            {err && <div className="text-sm text-destructive">{err}</div>}
            <button
              onClick={onUpload}
              disabled={!file || busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              data-testid="button-upload-doc"
            >
              {busy ? "Uploading…" : "Upload for review"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Task #1173 — Preview-as-partner shell (internal leadership only).
// Renders the SAME portal pages inside a PreviewFirmProvider so every read
// carries the x-partner-preview-firm header and every mutation is blocked.
// Route: /partners/preview/:firmId(/contracts|/billing|/company|
//        /opportunities/:oppId). Mounted under the INTERNAL shell (not the
// external /partner routes), so SelfOnlyRouteGuard treats it as an org page.
// ===========================================================================

/** Fetches the previewed firm's display name for the banner (best-effort). */
function usePreviewFirmName(firmId: string): string | null {
  const [name, setName] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void fetch(`${API}/opportunities`, {
      credentials: "include",
      headers: { [PREVIEW_HEADER]: firmId },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { firm?: { name?: string } }) => {
        if (!cancelled && j?.firm?.name) setName(j.firm.name);
      })
      .catch(() => {
        /* banner falls back to the firm id */
      });
    return () => {
      cancelled = true;
    };
  }, [firmId]);
  return name;
}

function PreviewBanner({ firmId }: { firmId: string }) {
  const [, setLocation] = useLocation();
  const name = usePreviewFirmName(firmId);
  return (
    <div
      className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-6 py-2 text-sm text-amber-900 dark:text-amber-200"
      data-testid="partner-preview-banner"
    >
      <span className="font-medium">
        Read-only preview of {name ?? firmId} portal — actions disabled
      </span>
      <button
        type="button"
        onClick={() => setLocation("/partners/identify")}
        className="rounded-md border border-amber-500/50 px-3 py-1 text-xs font-semibold hover:bg-amber-500/20"
        data-testid="button-exit-preview"
      >
        Exit preview
      </button>
    </div>
  );
}

/**
 * Preview host. Renders one portal page based on the sub-path, all wrapped in
 * the PreviewFirmProvider + sticky banner. Leadership-gating lives in App.tsx
 * (the route sits under the internal shell / SelfOnlyRouteGuard).
 */
export function PartnerPortalPreview() {
  const [homeMatch, homeParams] = useRoute("/partners/preview/:firmId");
  const [contractsMatch, contractsParams] = useRoute("/partners/preview/:firmId/contracts");
  const [billingMatch, billingParams] = useRoute("/partners/preview/:firmId/billing");
  const [companyMatch, companyParams] = useRoute("/partners/preview/:firmId/company");
  const [oppMatch, oppParams] = useRoute("/partners/preview/:firmId/opportunities/:oppId");
  const [deliveryDetailMatch, deliveryDetailParams] = useRoute("/partners/preview/:firmId/delivery/:engId");
  const [deliveryMatch, deliveryParams] = useRoute("/partners/preview/:firmId/delivery");
  const [documentsMatch, documentsParams] = useRoute("/partners/preview/:firmId/documents");

  const firmId =
    homeParams?.firmId ??
    contractsParams?.firmId ??
    billingParams?.firmId ??
    companyParams?.firmId ??
    oppParams?.firmId ??
    deliveryDetailParams?.firmId ??
    deliveryParams?.firmId ??
    documentsParams?.firmId ??
    "";

  if (!firmId) return null;

  let page: React.ReactNode = null;
  if (oppMatch) page = <PartnerPortalOpportunity />;
  else if (deliveryDetailMatch) page = <PartnerPortalDeliveryDetail />;
  else if (deliveryMatch) page = <PartnerPortalDelivery />;
  else if (documentsMatch) page = <PartnerPortalDocuments />;
  else if (contractsMatch) page = <PartnerPortalContracts />;
  else if (billingMatch) page = <PartnerPortalBilling />;
  else if (companyMatch) page = <PartnerPortalCompany />;
  else if (homeMatch) page = <PartnerPortalHome />;

  return (
    <PreviewFirmProvider value={{ firmId }}>
      <div data-testid="partner-portal-preview">
        <PreviewBanner firmId={firmId} />
        {page}
      </div>
    </PreviewFirmProvider>
  );
}
