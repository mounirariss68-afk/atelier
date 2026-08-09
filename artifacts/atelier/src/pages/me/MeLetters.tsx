/**
 * MeLetters — Task #850: self-service employment & salary letters page.
 *
 * Lists the caller's letter issuances (type, language, date, ref number,
 * delivery status) with one-click re-download of the stored PDF, plus a
 * "Request a letter" form with chat parity (POST /me/letters).
 *
 * The bespoke /me/letters routes (Task #845) are not in the openapi spec,
 * so this page uses raw fetch with the base-path-aware API_BASE pattern.
 * Downloads stream the stored person document via
 * GET /me/documents/:id/download (letters are person_documents rows of
 * kind "employment_letter" — self-scope, same route the Profile tab uses).
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

interface LetterTypeDef {
  id: string;
  label: string;
  hint: string;
  salaryBearing: boolean;
  travelDates: boolean;
}

interface LetterWire {
  id: string;
  letterType: string;
  letterLabel: string;
  language: "en" | "ar" | "tr";
  deliveryMode: "digital" | "wet_signature";
  addresseeName: string | null;
  addresseeInstitution: string | null;
  purpose: string | null;
  travelStart: string | null;
  travelEnd: string | null;
  refNumber: string;
  entityName: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  status: string;
  emailVia: string | null;
  emailTo: string | null;
  delivered: boolean;
  documentId: string | null;
  fileName: string | null;
  createdAt: string;
}

interface LettersResponse {
  letters: LetterWire[];
  catalog: LetterTypeDef[];
  entity: {
    id: string;
    name: string;
    via: string;
    signatoryName: string | null;
    signatoryTitle: string | null;
    hasSignature: boolean;
    hasStamp: boolean;
    wetSignatureAvailable: boolean;
  } | null;
}

const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  ar: "Arabic",
  tr: "Turkish",
};

/** Honest delivery status copy — mirrors the chat card semantics. */
function statusText(l: LetterWire): { label: string; tone: "ok" | "pending" | "muted" } {
  if (l.deliveryMode === "wet_signature") {
    if (l.status === "sent_to_signatory")
      return {
        label: `Sent to ${l.signatoryName ?? "signatory"} — awaiting hand-over`,
        tone: "pending",
      };
    return { label: l.status.replace(/_/g, " "), tone: "muted" };
  }
  if (l.delivered) return { label: `Emailed to ${l.emailTo ?? "you"}`, tone: "ok" };
  // sendEmail log-only semantics: ok but NOT delivered.
  return { label: "Issued — email delivery unavailable, download below", tone: "muted" };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function MeLetters() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<
    LettersResponse,
    Error & { httpStatus?: number; serverMessage?: string }
  >({
    queryKey: ["me-letters"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/me/letters`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        const err = new Error(body?.message ?? body?.error ?? `Request failed (${res.status})`) as
          Error & { httpStatus?: number; serverMessage?: string };
        err.httpStatus = res.status;
        err.serverMessage = body?.message;
        throw err;
      }
      return (await res.json()) as LettersResponse;
    },
    retry: (count, err) => (err.httpStatus === 403 ? false : count < 2),
  });

  const [showForm, setShowForm] = React.useState(false);
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [downloadErr, setDownloadErr] = React.useState<string | null>(null);

  const download = React.useCallback(async (l: LetterWire) => {
    if (!l.documentId) return;
    setDownloading(l.id);
    setDownloadErr(null);
    try {
      const res = await fetch(`${API_BASE}/me/documents/${l.documentId}/download`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "The stored PDF is no longer available."
            : `Download failed (${res.status}).`,
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = l.fileName || `${l.refNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadErr((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }, []);

  if (isLoading) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="me-letters-loading">
        Loading your letters…
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="me-letters-restricted">
        {error.httpStatus === 403
          ? (error.serverMessage ??
            "Official employment and salary letters are issued to employees only.")
          : `Couldn't load your letters: ${error.message}`}
      </Card>
    );
  }
  if (!data) return null;

  const letters = data.letters;

  return (
    <div className="space-y-6" data-testid="me-letters">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-text">Official letters</h2>
            <p className="mt-1 text-sm text-text-mute max-w-prose">
              Salary certificates, employment verification and visa no-objection letters,
              issued on Cognirise letterhead
              {data.entity ? (
                <>
                  {" "}by <span className="text-text">{data.entity.name}</span>
                  {data.entity.signatoryName ? `, signed by ${data.entity.signatoryName}` : ""}
                </>
              ) : null}
              . Digital letters are emailed to your Cognirise inbox; wet-signature letters go
              to the signatory to print, sign and hand over.
            </p>
          </div>
          <PillButton
            type="button"
            className="shrink-0"
            onClick={() => setShowForm((v) => !v)}
            data-testid="me-letters-request-toggle"
          >
            {showForm ? "Close form" : "Request a letter"}
          </PillButton>
        </div>
        {showForm && (
          <div className="mt-5 border-t border-border pt-5">
            <RequestLetterForm
              catalog={data.catalog}
              wetAvailable={!!data.entity?.wetSignatureAvailable}
              signatoryName={data.entity?.signatoryName ?? null}
              onDone={() => {
                setShowForm(false);
                void qc.invalidateQueries({ queryKey: ["me-letters"] });
              }}
            />
          </div>
        )}
      </Card>

      {downloadErr && (
        <Card className="p-4 text-sm text-red-700" data-testid="me-letters-download-error">
          {downloadErr}
        </Card>
      )}

      {letters.length === 0 ? (
        <Card className="p-6 text-sm text-text-mute" data-testid="me-letters-empty">
          No letters yet. Use “Request a letter” above — or ask Riser in chat — and your
          issued letters will appear here for re-download.
        </Card>
      ) : (
        <div className="space-y-3" data-testid="me-letters-list">
          {letters.map((l) => {
            const st = statusText(l);
            return (
              <Card key={l.id} className="p-4" data-testid={`me-letter-${l.id}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text">{l.letterLabel}</span>
                      <MonoChip>{l.refNumber}</MonoChip>
                    </div>
                    <div className="mt-1 text-xs text-text-mute">
                      {fmtDate(l.createdAt)} · {LANGUAGE_LABEL[l.language] ?? l.language} ·{" "}
                      {l.deliveryMode === "wet_signature" ? "Wet signature" : "Digital"} ·{" "}
                      {l.entityName}
                      {l.addresseeInstitution ? ` · To: ${l.addresseeInstitution}` : ""}
                      {l.travelStart && l.travelEnd
                        ? ` · Travel ${l.travelStart} → ${l.travelEnd}`
                        : ""}
                    </div>
                    <div
                      className={`mt-1 text-xs ${
                        st.tone === "ok"
                          ? "text-emerald-700"
                          : st.tone === "pending"
                            ? "text-amber-700"
                            : "text-text-mute"
                      }`}
                      data-testid={`me-letter-status-${l.id}`}
                    >
                      {st.label}
                    </div>
                  </div>
                  {l.documentId ? (
                    <PillButton
                      type="button"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => void download(l)}
                      disabled={downloading === l.id}
                      data-testid={`me-letter-download-${l.id}`}
                    >
                      {downloading === l.id ? "Downloading…" : "Download PDF"}
                    </PillButton>
                  ) : (
                    <span className="text-xs text-text-mute shrink-0">No stored PDF</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RequestLetterForm({
  catalog,
  wetAvailable,
  signatoryName,
  onDone,
}: {
  catalog: LetterTypeDef[];
  wetAvailable: boolean;
  signatoryName: string | null;
  onDone: () => void;
}) {
  const [letterType, setLetterType] = React.useState(catalog[0]?.id ?? "");
  const [language, setLanguage] = React.useState<"en" | "ar" | "tr">("en");
  const [deliveryMode, setDeliveryMode] = React.useState<"digital" | "wet_signature">("digital");
  const [addresseeName, setAddresseeName] = React.useState("");
  const [addresseeInstitution, setAddresseeInstitution] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [travelStart, setTravelStart] = React.useState("");
  const [travelEnd, setTravelEnd] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<LetterWire | null>(null);

  const def = catalog.find((t) => t.id === letterType) ?? null;
  const needsTravel = !!def?.travelDates;
  const travelMissing = needsTravel && (!travelStart || !travelEnd);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!letterType || busy || travelMissing) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, string> = { letterType, language, deliveryMode };
      if (addresseeName.trim()) body.addresseeName = addresseeName.trim();
      if (addresseeInstitution.trim()) body.addresseeInstitution = addresseeInstitution.trim();
      if (purpose.trim()) body.purpose = purpose.trim();
      if (needsTravel) {
        body.travelStart = travelStart;
        body.travelEnd = travelEnd;
        if (destination.trim()) body.destination = destination.trim();
      }
      const res = await fetch(`${API_BASE}/me/letters`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as
        | { letter?: LetterWire; message?: string; error?: string }
        | null;
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `Request failed (${res.status})`);
      setIssued(j?.letter ?? null);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  if (issued) {
    const st = statusText(issued);
    return (
      <div className="space-y-3" data-testid="me-letters-issued">
        <p className="text-sm text-text">
          <span className="font-semibold">{issued.letterLabel}</span> issued —{" "}
          <span className="font-mono text-xs">{issued.refNumber}</span>. {st.label}.
        </p>
        <PillButton type="button" variant="ghost" onClick={onDone}>
          Done
        </PillButton>
      </div>
    );
  }

  const labelCls = "block text-xs font-medium text-text-mute mb-1";
  const inputCls =
    "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text min-h-[44px] focus:outline-none focus:ring-1 focus:ring-gold/50";

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="me-letters-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="letter-type">Letter type</label>
          <select
            id="letter-type"
            className={inputCls}
            value={letterType}
            onChange={(e) => setLetterType(e.target.value)}
            data-testid="me-letters-type"
          >
            {catalog.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {def && <p className="mt-1 text-xs text-text-mute">Use {def.hint}.</p>}
        </div>
        <div>
          <label className={labelCls} htmlFor="letter-language">Language</label>
          <select
            id="letter-language"
            className={inputCls}
            value={language}
            onChange={(e) => setLanguage(e.target.value as "en" | "ar" | "tr")}
          >
            <option value="en">English</option>
            <option value="ar">Arabic</option>
            <option value="tr">Turkish</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="letter-delivery">Delivery</label>
          <select
            id="letter-delivery"
            className={inputCls}
            value={deliveryMode}
            onChange={(e) => setDeliveryMode(e.target.value as "digital" | "wet_signature")}
          >
            <option value="digital">Digital — emailed to my Cognirise inbox</option>
            {wetAvailable && (
              <option value="wet_signature">
                Wet signature — printed &amp; signed{signatoryName ? ` by ${signatoryName}` : ""}
              </option>
            )}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="letter-addressee">Addressee name (optional)</label>
          <input
            id="letter-addressee"
            className={inputCls}
            value={addresseeName}
            onChange={(e) => setAddresseeName(e.target.value)}
            maxLength={200}
            placeholder="e.g. The Manager"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="letter-institution">Institution (optional)</label>
          <input
            id="letter-institution"
            className={inputCls}
            value={addresseeInstitution}
            onChange={(e) => setAddresseeInstitution(e.target.value)}
            maxLength={300}
            placeholder="e.g. Emirates NBD"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="letter-purpose">Purpose (optional)</label>
          <input
            id="letter-purpose"
            className={inputCls}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            maxLength={500}
            placeholder="e.g. Home loan application"
          />
        </div>
        {needsTravel && (
          <>
            <div>
              <label className={labelCls} htmlFor="letter-travel-start">Travel start</label>
              <input
                id="letter-travel-start"
                type="date"
                className={inputCls}
                value={travelStart}
                onChange={(e) => setTravelStart(e.target.value)}
                data-testid="me-letters-travel-start"
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="letter-travel-end">Travel end</label>
              <input
                id="letter-travel-end"
                type="date"
                className={inputCls}
                value={travelEnd}
                onChange={(e) => setTravelEnd(e.target.value)}
                data-testid="me-letters-travel-end"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="letter-destination">Destination (optional)</label>
              <input
                id="letter-destination"
                className={inputCls}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                maxLength={200}
                placeholder="e.g. Germany"
              />
            </div>
          </>
        )}
      </div>
      {err && (
        <p className="text-sm text-red-700" data-testid="me-letters-form-error">
          {err}
        </p>
      )}
      <div className="flex items-center gap-3">
        <PillButton
          type="submit"
          disabled={busy || !letterType || travelMissing}
          data-testid="me-letters-submit"
        >
          {busy ? "Issuing…" : "Issue letter"}
        </PillButton>
        {travelMissing && (
          <span className="text-xs text-text-mute">Visa letters need a travel window.</span>
        )}
      </div>
    </form>
  );
}
