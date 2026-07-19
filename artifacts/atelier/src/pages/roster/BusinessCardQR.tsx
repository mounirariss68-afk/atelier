import * as React from "react";
import QRCode from "qrcode";
import { useAtelierGetMyProfile } from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { buildVCard, vcardFilename, type VCardCell } from "@/lib/vcard";
import { formatPhoneCell } from "@/lib/phone-format";

const FIRM = "Cognirise";

interface ContactPerson {
  id: string;
  fullName: string;
  title?: string | null;
  email: string | null;
  cellPhones?: VCardCell[] | null;
  officeAddress?: string | null;
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Task #645 — Offline business-card QR. The QR encodes the vCard string
 * directly (no hosted page / no server endpoint), so scanning a printed card
 * saves the contact instantly. Only public, card-safe fields are encoded.
 */
export function BusinessCardQR({
  person,
  onUpdated,
}: {
  person: ContactPerson;
  onUpdated: (patch: Partial<ContactPerson>) => void;
}) {
  const cells = React.useMemo(
    () => (person.cellPhones ?? []).filter((c) => c.number?.trim()),
    [person.cellPhones],
  );

  const vcard = React.useMemo(
    () =>
      buildVCard({
        fullName: person.fullName,
        title: person.title,
        org: FIRM,
        email: person.email,
        cellPhones: cells,
        officeAddress: person.officeAddress,
      }),
    [person.fullName, person.title, person.email, cells, person.officeAddress],
  );

  const [pngUrl, setPngUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    QRCode.toDataURL(vcard, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 1024,
      color: { dark: "#0b1220", light: "#ffffff" },
    })
      .then((url) => {
        if (alive) {
          setPngUrl(url);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) setError("Could not render QR.");
      });
    return () => {
      alive = false;
    };
  }, [vcard]);

  const downloadPng = () => {
    if (pngUrl) triggerDownload(pngUrl, `${vcardFilename(person.fullName).replace(/\.vcf$/, "")}-qr.png`);
  };

  const downloadSvg = async () => {
    const svg = await QRCode.toString(vcard, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      color: { dark: "#0b1220", light: "#ffffff" },
    });
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    triggerDownload(url, `${vcardFilename(person.fullName).replace(/\.vcf$/, "")}-qr.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadVcf = () => {
    const url = URL.createObjectURL(new Blob([vcard], { type: "text/vcard" }));
    triggerDownload(url, vcardFilename(person.fullName));
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Task #52 — the printable card PDF is generated server-side from the
  // caller's own profile (self-scoped endpoint), so the button only shows
  // when the viewed person IS the signed-in person.
  const { data: myProfile } = useAtelierGetMyProfile();
  const isSelf = myProfile?.person?.id === person.id;
  const cardPdfHref = `${import.meta.env.BASE_URL}api/atelier/me/business-card.pdf`;

  const hasContact = cells.length > 0;

  return (
    <Card className="p-4 space-y-4 md:col-span-2" data-testid="business-card-qr">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-mono text-xs uppercase text-text-mute">
          Business-card QR · scan to save contact (offline)
        </h3>
        <MonoChip>public fields only</MonoChip>
      </div>

      {!hasContact ? (
        <p className="text-sm text-text-mute">
          No cell phone on file yet — add at least one mobile number below to
          generate a scannable contact QR.
        </p>
      ) : (
        <div className="flex flex-col md:flex-row gap-6">
          <div className="shrink-0">
            <div className="bg-white rounded-lg p-3 w-[200px] h-[200px] flex items-center justify-center">
              {error ? (
                <span className="text-xs text-warn">{error}</span>
              ) : pngUrl ? (
                <img
                  src={pngUrl}
                  alt={`Contact QR code for ${person.fullName}`}
                  className="w-full h-full"
                  data-testid="qr-image"
                />
              ) : (
                <span className="text-xs text-text-mute">Rendering…</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <DownloadBtn onClick={downloadPng} disabled={!pngUrl} testid="qr-download-png">
                QR · PNG
              </DownloadBtn>
              <DownloadBtn onClick={downloadSvg} testid="qr-download-svg">
                QR · SVG
              </DownloadBtn>
              <DownloadBtn onClick={downloadVcf} testid="qr-download-vcf">
                .vcf
              </DownloadBtn>
              {isSelf && (
                <a
                  href={cardPdfHref}
                  download
                  data-testid="qr-download-card-pdf"
                  className="text-[10px] font-mono uppercase tracking-widest border border-line rounded px-2 py-1 hover:border-gold hover:text-gold"
                >
                  Card · PDF
                </a>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="text-sm text-text font-medium">{person.fullName}</div>
            {person.title && (
              <div className="text-xs text-text-mute">{person.title}</div>
            )}
            <div className="text-xs text-text-mute">{FIRM}</div>
            {person.email && (
              <PreviewRow label="Email" value={person.email} />
            )}
            {cells.map((c, i) => (
              <PreviewRow
                key={i}
                label={c.country ? `Cell · ${c.country}` : "Cell"}
                value={formatPhoneCell(c)}
              />
            ))}
            {person.officeAddress && (
              <PreviewRow label="Office" value={person.officeAddress} />
            )}
          </div>
        </div>
      )}

      <ContactEditor person={person} onUpdated={onUpdated} />
    </Card>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-text-mute">{label}</span>
      <span className="text-text text-right">{value}</span>
    </div>
  );
}

function DownloadBtn({
  onClick,
  disabled,
  testid,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  testid?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="text-[10px] font-mono uppercase tracking-widest border border-line rounded px-2 py-1 hover:border-gold hover:text-gold disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * HR / Partner inline editor for the public business-card contact fields.
 * Mirrors the DemographicsEditor pattern: visible to everyone, but the PATCH
 * returns 403 for non-HR/Partner personas, which flips back to read-only with
 * a hint. Enforces at least one cell phone and up to three.
 */
const MAX_CELLS = 3;
function ContactEditor({
  person,
  onUpdated,
}: {
  person: ContactPerson;
  onUpdated: (patch: Partial<ContactPerson>) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [cells, setCells] = React.useState<VCardCell[]>([]);
  const [office, setOffice] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    const existing = (person.cellPhones ?? []).filter((c) => c.number?.trim());
    setCells(existing.length > 0 ? existing.map((c) => ({ ...c })) : [{ country: "", number: "" }]);
    setOffice(person.officeAddress ?? "");
  }, [person.cellPhones, person.officeAddress]);

  React.useEffect(() => {
    reset();
  }, [reset]);

  if (!editing) {
    return (
      <button
        onClick={() => {
          setError(null);
          reset();
          setEditing(true);
        }}
        className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-gold"
        data-testid="contact-edit"
      >
        Edit contact card
      </button>
    );
  }

  const setCell = (i: number, patch: Partial<VCardCell>) =>
    setCells((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const addCell = () =>
    setCells((prev) => (prev.length < MAX_CELLS ? [...prev, { country: "", number: "" }] : prev));
  const removeCell = (i: number) =>
    setCells((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    const cleaned = cells
      .map((c) => ({ country: c.country.trim(), number: c.number.trim() }))
      .filter((c) => c.number || c.country);
    if (cleaned.length === 0 || cleaned.every((c) => !c.number)) {
      setError("At least one cell phone is required.");
      return;
    }
    if (cleaned.some((c) => !c.number)) {
      setError("Every cell needs a number (or remove the empty row).");
      return;
    }
    if (cleaned.some((c) => !c.country)) {
      setError("Label each cell with the country it belongs to.");
      return;
    }
    if (!office.trim()) {
      setError("Office address is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/atelier/roster/people/${person.id}/contact`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cellPhones: cleaned,
          officeAddress: office.trim(),
        }),
      });
      if (r.status === 403) {
        setError("HR / Partner only.");
        setEditing(false);
        return;
      }
      if (!r.ok) {
        setError(`Save failed (${r.status}).`);
        return;
      }
      const d = await r.json();
      if (d.person) {
        onUpdated({
          cellPhones: d.person.cellPhones ?? cleaned,
          officeAddress: d.person.officeAddress ?? (office.trim() || null),
        });
      }
      setEditing(false);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="space-y-3 border border-border-soft rounded p-3"
      data-testid="contact-editor"
    >
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-mute">
        Cell phones — at least one, labelled by country (max {MAX_CELLS})
      </div>
      {cells.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={c.country}
            onChange={(e) => setCell(i, { country: e.target.value })}
            placeholder="Country (e.g. UAE)"
            className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-xs w-32"
            data-testid={`contact-cell-country-${i}`}
          />
          <input
            value={c.number}
            onChange={(e) => setCell(i, { number: e.target.value })}
            placeholder="+971 50 123 4567"
            className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text font-mono text-xs flex-1"
            data-testid={`contact-cell-number-${i}`}
          />
          {cells.length > 1 && (
            <button
              onClick={() => removeCell(i)}
              className="text-[10px] font-mono uppercase text-text-faint hover:text-warn px-1"
              data-testid={`contact-cell-remove-${i}`}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {cells.length < MAX_CELLS && (
        <button
          onClick={addCell}
          className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-gold"
          data-testid="contact-cell-add"
        >
          + Add cell
        </button>
      )}
      <label className="block space-y-1">
        <span className="text-[10px] font-mono uppercase tracking-widest text-text-mute">
          Office address — required
        </span>
        <textarea
          value={office}
          onChange={(e) => setOffice(e.target.value)}
          rows={2}
          placeholder="Cognirise, One Central, Dubai, United Arab Emirates"
          className="w-full bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-xs"
          data-testid="contact-office-address"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        {error && <span className="text-warn text-[10px] mr-auto">{error}</span>}
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-text px-2 py-0.5"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="text-[10px] font-mono uppercase tracking-widest bg-gold text-bg px-2 py-0.5 rounded disabled:opacity-50"
          data-testid="contact-save"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
