/**
 * MeProfileSection — Task #51: self-service profile for the Me lens.
 *
 * Everything here is self-scope (/me/* routes only answer for the caller).
 * Sensitive HR fields (compensation, banking, employment type) render
 * read-only in the Employment card; the editable surface below covers
 * personal contact details, bio, ID documents with scans, dependents,
 * emergency contacts and the profile photo.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatPhoneCell, formatPhoneDisplay } from "@/lib/phone-format";
import {
  useAtelierGetMyProfile,
  getAtelierGetMyProfileQueryKey,
  useAtelierUpdateMyProfile,
  useAtelierListMyDocuments,
  getAtelierListMyDocumentsQueryKey,
  useAtelierUpdateMyDocument,
  useAtelierDeleteMyDocument,
  useAtelierListMyDependents,
  getAtelierListMyDependentsQueryKey,
  useAtelierCreateMyDependent,
  useAtelierUpdateMyDependent,
  useAtelierDeleteMyDependent,
  useAtelierListMyEmergencyContacts,
  getAtelierListMyEmergencyContactsQueryKey,
  useAtelierCreateMyEmergencyContact,
  useAtelierUpdateMyEmergencyContact,
  useAtelierDeleteMyEmergencyContact,
  type AtelierSelfProfile,
  type AtelierDependent,
  type AtelierEmergencyContact,
  type AtelierSelfDocument,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { ConnectedAccountsCard } from "@/components/ms/MsMeetings";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

type Profile = AtelierSelfProfile | undefined;

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-faint shrink-0">
        {label}
      </span>
      <span className="text-text text-right break-words min-w-0">{value ?? "—"}</span>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-border-soft bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold";
const labelCls = "font-mono text-[10px] uppercase tracking-wider text-text-faint";
const btnCls =
  "rounded border border-border-soft px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-text hover:border-gold hover:text-gold transition-colors disabled:opacity-50";
const btnGoldCls =
  "rounded bg-gold/90 hover:bg-gold px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-ink transition-colors disabled:opacity-50";

export default function MeProfileSection({
  loading,
  profile,
}: {
  loading: boolean;
  profile: Profile;
}) {
  return (
    <div className="space-y-4" data-testid="me-profile-section">
      <div className="grid gap-4 md:grid-cols-2">
        <PhotoAndContactCard loading={loading} profile={profile} />
        <EmploymentCard loading={loading} profile={profile} />
      </div>
      <BioAndCardCard />
      {/* Task #327 — Microsoft 365 connect/disconnect. */}
      <ConnectedAccountsCard />
      <DocumentsCard />
      <div className="grid gap-4 md:grid-cols-2">
        <DependentsCard />
        <EmergencyContactsCard />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Photo + editable contact details
// ------------------------------------------------------------------
function PhotoAndContactCard({ loading, profile }: { loading: boolean; profile: Profile }) {
  const qc = useQueryClient();
  const p = profile?.person;
  const [editing, setEditing] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [form, setForm] = React.useState({
    preferredName: "",
    personalEmail: "",
    homeAddress: "",
    officeAddress: "",
    bio: "",
    cellPhones: [] as { country: string; number: string }[],
  });

  React.useEffect(() => {
    if (!p || editing) return;
    setForm({
      preferredName: p.preferredName ?? "",
      personalEmail: p.personalEmail ?? "",
      homeAddress: p.homeAddress ?? "",
      officeAddress: p.officeAddress ?? "",
      bio: p.bio ?? "",
      cellPhones: (p.cellPhones ?? []).map((c) => ({ country: c.country, number: c.number })),
    });
  }, [p, editing]);

  const save = useAtelierUpdateMyProfile({
    mutation: {
      onSuccess: () => {
        setEditing(false);
        setErr(null);
        void qc.invalidateQueries({ queryKey: getAtelierGetMyProfileQueryKey() });
      },
      onError: (e: unknown) => setErr(String((e as Error)?.message ?? e)),
    },
  });

  async function uploadPhoto(file: File) {
    setPhotoBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(`${API_BASE}/me/photo`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed (${resp.status})`);
      }
      void qc.invalidateQueries({ queryKey: getAtelierGetMyProfileQueryKey() });
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setPhotoBusy(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <p className="text-sm text-text-faint">Loading…</p>
      </Card>
    );
  }
  if (!p) {
    return (
      <Card className="p-4" data-testid="me-profile-no-person">
        <h3 className="text-sm font-semibold text-text mb-2">Contact details</h3>
        <p className="text-sm text-text-mute">
          No roster record is linked to your login yet. Ask HR to link your profile.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4" data-testid="me-contact-card">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="relative h-14 w-14 shrink-0 rounded-full overflow-hidden border border-border-soft bg-surface-2 group"
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
            title="Change photo"
            data-testid="me-photo-button"
          >
            {p.avatarUrl ? (
              <img
                src={`${import.meta.env.BASE_URL}${p.avatarUrl.replace(/^\//, "")}`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-lg text-text-faint">
                {p.fullName?.[0] ?? "?"}
              </span>
            )}
            <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-[9px] font-mono uppercase tracking-wider text-white group-hover:flex">
              {photoBusy ? "…" : "Edit"}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadPhoto(f);
              e.target.value = "";
            }}
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text truncate">{p.fullName}</h3>
            <p className="text-xs text-text-mute truncate">{p.email}</p>
          </div>
        </div>
        {!editing ? (
          <button className={btnCls} onClick={() => setEditing(true)} data-testid="me-edit-profile">
            Edit
          </button>
        ) : null}
      </div>

      {err ? <p className="mb-2 text-xs text-red-400">{err}</p> : null}

      {!editing ? (
        <div className="divide-y divide-border-soft">
          {p.workerType === "employee" && <Field label="Preferred name" value={p.preferredName} />}
          <Field label="Personal email" value={p.personalEmail} />
          <Field
            label="Cell phones"
            value={
              (p.cellPhones ?? []).length > 0
                ? (p.cellPhones ?? []).map((c) => formatPhoneCell(c)).join(" · ")
                : null
            }
          />
          <Field label="Home address" value={p.homeAddress} />
          <Field label="Office address" value={p.officeAddress} />
          <div className="py-1.5 text-sm">
            <span className={labelCls}>Bio</span>
            <p className="mt-1 text-text whitespace-pre-wrap">{p.bio || "—"}</p>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              data: {
                ...(p.workerType === "employee"
                  ? { preferredName: form.preferredName.trim() || null }
                  : {}),
                personalEmail: form.personalEmail.trim() || null,
                homeAddress: form.homeAddress.trim() || null,
                officeAddress: form.officeAddress.trim() || null,
                bio: form.bio.trim() || null,
                cellPhones: form.cellPhones.filter((c) => c.country.trim() && c.number.trim()),
              },
            });
          }}
        >
          {p.workerType === "employee" ? (
            <div>
              <label className={labelCls}>Preferred name</label>
              <input
                className={inputCls}
                value={form.preferredName}
                onChange={(e) => setForm({ ...form, preferredName: e.target.value })}
                data-testid="input-preferred-name"
              />
            </div>
          ) : null}
          <div>
            <label className={labelCls}>Personal email</label>
            <input
              className={inputCls}
              type="email"
              value={form.personalEmail}
              onChange={(e) => setForm({ ...form, personalEmail: e.target.value })}
              data-testid="input-personal-email"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className={labelCls}>Cell phones (max 3)</label>
              {form.cellPhones.length < 3 ? (
                <button
                  type="button"
                  className="text-xs text-gold hover:underline"
                  onClick={() =>
                    setForm({ ...form, cellPhones: [...form.cellPhones, { country: "", number: "" }] })
                  }
                >
                  + add
                </button>
              ) : null}
            </div>
            {form.cellPhones.map((c, i) => (
              <div key={i} className="mt-1 flex gap-2">
                <input
                  className={`${inputCls} !w-24`}
                  placeholder="+971"
                  value={c.country}
                  onChange={(e) => {
                    const next = [...form.cellPhones];
                    next[i] = { ...next[i], country: e.target.value };
                    setForm({ ...form, cellPhones: next });
                  }}
                />
                <input
                  className={inputCls}
                  placeholder="50 123 4567"
                  value={c.number}
                  onChange={(e) => {
                    const next = [...form.cellPhones];
                    next[i] = { ...next[i], number: e.target.value };
                    setForm({ ...form, cellPhones: next });
                  }}
                />
                <button
                  type="button"
                  className="text-xs text-text-faint hover:text-red-400"
                  onClick={() =>
                    setForm({ ...form, cellPhones: form.cellPhones.filter((_, j) => j !== i) })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div>
            <label className={labelCls}>Home address</label>
            <textarea
              className={inputCls}
              rows={2}
              value={form.homeAddress}
              onChange={(e) => setForm({ ...form, homeAddress: e.target.value })}
              data-testid="input-home-address"
            />
          </div>
          <div>
            <label className={labelCls}>Office address</label>
            <textarea
              className={inputCls}
              rows={2}
              value={form.officeAddress}
              onChange={(e) => setForm({ ...form, officeAddress: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Bio</label>
            <textarea
              className={inputCls}
              rows={4}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              data-testid="input-bio"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={btnGoldCls} disabled={save.isPending} data-testid="save-profile">
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={btnCls}
              onClick={() => {
                setEditing(false);
                setErr(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------
// Read-only employment card (sensitive HR fields stay HR-controlled)
// ------------------------------------------------------------------
function EmploymentCard({ loading, profile }: { loading: boolean; profile: Profile }) {
  const p = profile?.person;
  return (
    <Card className="p-4" data-testid="me-employment-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text">Employment</h3>
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-faint">
          HR-managed · read-only
        </span>
      </div>
      {loading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : p ? (
        <div className="divide-y divide-border-soft">
          <Field label="Worker type" value={<MonoChip tone="gold">{p.workerType}</MonoChip>} />
          <Field label="Title" value={p.title} />
          <Field label="Start date" value={p.startDate} />
          <Field label="Type" value={p.employmentType} />
          <Field label="Office" value={p.homeOffice} />
          <Field label="Country" value={p.country} />
          <Field label="Status" value={p.status} />
        </div>
      ) : (
        <p className="text-sm text-text-mute">No roster record linked yet.</p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------
// Task #52 — Biography PPTX template flow + business-card PDF.
// Download the official template, fill it offline, upload the completed
// deck (versioned on re-upload); and generate a print-ready two-sided
// business-card PDF with the person's real vCard QR.
// ------------------------------------------------------------------
interface BioVersion {
  id: string;
  title: string;
  fileName: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
  downloadUrl: string;
}

function fmtBytes(n: number | null): string {
  if (n == null) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function BioAndCardCard() {
  const [bios, setBios] = React.useState<BioVersion[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/me/bio`, { credentials: "include" });
      if (!r.ok) throw new Error(`Could not load biographies (${r.status})`);
      const d = (await r.json()) as { biographies?: BioVersion[] };
      setBios(d.biographies ?? []);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setBios([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API_BASE}/me/bio`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          body?.error === "unsupported-file-type"
            ? "Please upload a .pptx file (the filled-in Cognirise template)."
            : body?.error ?? `Upload failed (${r.status})`,
        );
      }
      await load();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const latest = bios?.[0] ?? null;

  return (
    <Card className="p-4" data-testid="me-bio-card">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-text">Biography &amp; business card</h3>
        <a
          className={btnCls}
          href={`${API_BASE}/me/business-card.pdf`}
          download
          data-testid="me-download-card-pdf"
        >
          Download business card PDF
        </a>
      </div>
      <p className="text-xs text-text-mute mb-3">
        Download the official Cognirise biography template, fill it in offline, then
        upload the completed deck here. Re-uploading keeps every previous version.
        The business-card PDF is generated from your current profile — name, title,
        mobile, email — with a QR code that saves your contact when scanned.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <a
          className={btnCls}
          href={`${API_BASE}/me/bio/template`}
          download
          data-testid="me-download-bio-template"
        >
          Download bio template (.pptx)
        </a>
        <button
          className={btnGoldCls}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          data-testid="me-upload-bio"
        >
          {busy ? "Uploading…" : latest ? "Upload new version" : "Upload completed bio"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}
      {bios === null ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : bios.length === 0 ? (
        <p className="text-sm text-text-mute" data-testid="me-bio-empty">
          No biography uploaded yet.
        </p>
      ) : (
        <ul className="divide-y divide-border-soft" data-testid="me-bio-versions">
          {bios.map((b, i) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">
                <span className="text-text">{b.title}</span>
                {i === 0 && (
                  <span className="ml-2">
                    <MonoChip tone="gold">current</MonoChip>
                  </span>
                )}
                <span className="ml-2 text-text-faint text-xs">
                  {b.fileName ?? ""} {fmtBytes(b.sizeBytes)}
                </span>
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-[10px] text-text-faint">
                  {new Date(b.uploadedAt).toLocaleDateString()}
                </span>
                <a
                  className="text-xs text-gold hover:underline"
                  href={`${import.meta.env.BASE_URL}${b.downloadUrl.replace(/^\//, "")}`}
                  download
                >
                  Download
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------
// ID / residency documents with scans + expiry surfacing
// ------------------------------------------------------------------
const DOC_KINDS = [
  { id: "passport", label: "Passport" },
  { id: "national_id", label: "National ID" },
  { id: "residency", label: "Residency" },
  { id: "visa", label: "Visa" },
  { id: "dependent_doc", label: "Dependent doc" },
  { id: "other", label: "Other" },
] as const;

function expiryTone(days: number | null | undefined): { cls: string; text: string } | null {
  if (days == null) return null;
  if (days < 0) return { cls: "text-red-400", text: `expired ${-days}d ago` };
  if (days <= 90) return { cls: "text-amber-400", text: `expires in ${days}d` };
  return { cls: "text-text-faint", text: `expires in ${days}d` };
}

function DocumentsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useAtelierListMyDocuments();
  const { data: deps } = useAtelierListMyDependents();
  const [adding, setAdding] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListMyDocumentsQueryKey() });

  const del = useAtelierDeleteMyDocument({ mutation: { onSuccess: invalidate } });

  const [form, setForm] = React.useState({
    kind: "passport",
    title: "",
    docNumber: "",
    issuedAt: "",
    expiresAt: "",
    issuingCountry: "",
    dependentId: "",
    file: null as File | null,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("kind", form.kind);
      fd.append("title", form.title.trim());
      if (form.docNumber.trim()) fd.append("docNumber", form.docNumber.trim());
      if (form.issuedAt) fd.append("issuedAt", form.issuedAt);
      if (form.expiresAt) fd.append("expiresAt", form.expiresAt);
      if (form.issuingCountry.trim()) fd.append("issuingCountry", form.issuingCountry.trim());
      if (form.dependentId) fd.append("dependentId", form.dependentId);
      if (form.file) fd.append("file", form.file);
      const resp = await fetch(`${API_BASE}/me/documents`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed (${resp.status})`);
      }
      setAdding(false);
      setForm({
        kind: "passport",
        title: "",
        docNumber: "",
        issuedAt: "",
        expiresAt: "",
        issuingCountry: "",
        dependentId: "",
        file: null,
      });
      invalidate();
    } catch (e2) {
      setErr(String((e2 as Error)?.message ?? e2));
    } finally {
      setBusy(false);
    }
  }

  const docs: AtelierSelfDocument[] = data?.documents ?? [];
  const depList: AtelierDependent[] = deps?.dependents ?? [];

  return (
    <Card className="p-4" data-testid="me-documents-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text">Identity documents</h3>
        <button className={btnCls} onClick={() => setAdding((v) => !v)} data-testid="add-document">
          {adding ? "Close" : "Add document"}
        </button>
      </div>
      <p className="mb-3 text-xs text-text-mute">
        Passport, national ID, residency and visa details with scans. Stored privately —
        visible only to you and HR. Expiry dates feed compliance reminders.
      </p>
      {err ? <p className="mb-2 text-xs text-red-400">{err}</p> : null}

      {adding ? (
        <form className="mb-4 grid gap-3 rounded border border-border-soft p-3 md:grid-cols-3" onSubmit={submit}>
          <div>
            <label className={labelCls}>Kind</label>
            <select
              className={inputCls}
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              data-testid="doc-kind"
            >
              {DOC_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Title *</label>
            <input
              className={inputCls}
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. UAE Residence Visa"
              data-testid="doc-title"
            />
          </div>
          <div>
            <label className={labelCls}>Document number</label>
            <input
              className={inputCls}
              value={form.docNumber}
              onChange={(e) => setForm({ ...form, docNumber: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Issued</label>
            <input
              className={inputCls}
              type="date"
              value={form.issuedAt}
              onChange={(e) => setForm({ ...form, issuedAt: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Expires</label>
            <input
              className={inputCls}
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              data-testid="doc-expires"
            />
          </div>
          <div>
            <label className={labelCls}>Issuing country</label>
            <input
              className={inputCls}
              value={form.issuingCountry}
              onChange={(e) => setForm({ ...form, issuingCountry: e.target.value })}
            />
          </div>
          {form.kind === "dependent_doc" && depList.length > 0 ? (
            <div>
              <label className={labelCls}>For dependent</label>
              <select
                className={inputCls}
                value={form.dependentId}
                onChange={(e) => setForm({ ...form, dependentId: e.target.value })}
              >
                <option value="">—</option>
                {depList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="md:col-span-2">
            <label className={labelCls}>Scan (PDF / JPG / PNG / WebP, ≤15 MB)</label>
            <input
              className="block w-full text-xs text-text-mute file:mr-3 file:rounded file:border file:border-border-soft file:bg-transparent file:px-2 file:py-1 file:text-xs file:text-text"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })}
              data-testid="doc-file"
            />
          </div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className={btnGoldCls} disabled={busy} data-testid="save-document">
              {busy ? "Uploading…" : "Save document"}
            </button>
          </div>
        </form>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-text-mute" data-testid="me-documents-empty">
          No documents recorded yet.
        </p>
      ) : (
        <div className="divide-y divide-border-soft">
          {docs.map((d) => (
            <DocumentRow key={d.id} doc={d} onDelete={() => del.mutate({ id: d.id })} onChanged={invalidate} />
          ))}
        </div>
      )}
    </Card>
  );
}

function DocumentRow({
  doc: d,
  onDelete,
  onChanged,
}: {
  doc: AtelierSelfDocument;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [replacing, setReplacing] = React.useState(false);
  const replaceRef = React.useRef<HTMLInputElement>(null);
  const [form, setForm] = React.useState({
    title: d.title,
    docNumber: d.docNumber ?? "",
    issuedAt: d.issuedAt ?? "",
    expiresAt: d.expiresAt ?? "",
    issuingCountry: d.issuingCountry ?? "",
  });
  const update = useAtelierUpdateMyDocument({
    mutation: {
      onSuccess: () => {
        setEditing(false);
        setErr(null);
        onChanged();
      },
      onError: (e: unknown) => setErr(String((e as Error)?.message ?? e)),
    },
  });

  async function replaceScan(file: File) {
    setReplacing(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(`${API_BASE}/me/documents/${d.id}/file`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed (${resp.status})`);
      }
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setReplacing(false);
    }
  }

  const tone = expiryTone(d.daysToExpiry);
  return (
    <div className="py-2" data-testid={`doc-${d.id}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonoChip tone="gold">{d.kind}</MonoChip>
            <span className="text-sm text-text truncate">{d.title}</span>
          </div>
          <p className="mt-0.5 text-xs text-text-mute">
            {d.docNumber ? `№ ${d.docNumber} · ` : ""}
            {d.issuingCountry ? `${d.issuingCountry} · ` : ""}
            {d.expiresAt ? `expires ${d.expiresAt}` : "no expiry"}
            {tone ? <span className={`ml-2 ${tone.cls}`}>({tone.text})</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {d.hasFile ? (
            <a
              className="text-xs text-gold hover:underline"
              href={`${API_BASE}/me/documents/${d.id}/download`}
              data-testid={`download-${d.id}`}
            >
              Download
            </a>
          ) : null}
          <button
            className="text-xs text-text-mute hover:text-gold"
            onClick={() => replaceRef.current?.click()}
            disabled={replacing}
            data-testid={`replace-scan-${d.id}`}
          >
            {replacing ? "Uploading…" : d.hasFile ? "Replace scan" : "Attach scan"}
          </button>
          <input
            ref={replaceRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void replaceScan(f);
              e.target.value = "";
            }}
          />
          <button
            className="text-xs text-text-mute hover:text-gold"
            onClick={() => setEditing((v) => !v)}
            data-testid={`edit-doc-${d.id}`}
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            className="text-xs text-text-faint hover:text-red-400"
            onClick={() => {
              if (window.confirm(`Remove "${d.title}"?`)) onDelete();
            }}
            data-testid={`delete-doc-${d.id}`}
          >
            Remove
          </button>
        </div>
      </div>
      {err ? <p className="mt-1 text-xs text-red-400">{err}</p> : null}
      {editing ? (
        <form
          className="mt-2 grid gap-2 rounded border border-border-soft p-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              id: d.id,
              data: {
                title: form.title.trim(),
                docNumber: form.docNumber.trim() || null,
                issuedAt: form.issuedAt || null,
                expiresAt: form.expiresAt || null,
                issuingCountry: form.issuingCountry.trim() || null,
              },
            });
          }}
        >
          <div className="md:col-span-3">
            <label className={labelCls}>Title</label>
            <input
              className={inputCls}
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              data-testid={`edit-doc-title-${d.id}`}
            />
          </div>
          <div>
            <label className={labelCls}>Document number</label>
            <input
              className={inputCls}
              value={form.docNumber}
              onChange={(e) => setForm({ ...form, docNumber: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Issued</label>
            <input
              className={inputCls}
              type="date"
              value={form.issuedAt}
              onChange={(e) => setForm({ ...form, issuedAt: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Expires</label>
            <input
              className={inputCls}
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Issuing country</label>
            <input
              className={inputCls}
              value={form.issuingCountry}
              onChange={(e) => setForm({ ...form, issuingCountry: e.target.value })}
            />
          </div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className={btnGoldCls} disabled={update.isPending} data-testid={`save-doc-${d.id}`}>
              {update.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnCls} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// Dependents
// ------------------------------------------------------------------
function DependentsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useAtelierListMyDependents();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListMyDependentsQueryKey() });
  const create = useAtelierCreateMyDependent({ mutation: { onSuccess: () => { setAdding(false); invalidate(); } } });
  const del = useAtelierDeleteMyDependent({ mutation: { onSuccess: invalidate } });
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ fullName: "", relationship: "spouse", dateOfBirth: "" });

  const rows: AtelierDependent[] = data?.dependents ?? [];
  return (
    <Card className="p-4" data-testid="me-dependents-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text">Dependents</h3>
        <button className={btnCls} onClick={() => setAdding((v) => !v)} data-testid="add-dependent">
          {adding ? "Close" : "Add"}
        </button>
      </div>
      {adding ? (
        <form
          className="mb-3 space-y-2 rounded border border-border-soft p-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              data: {
                fullName: form.fullName.trim(),
                relationship: form.relationship as "spouse" | "child" | "parent" | "other",
                dateOfBirth: form.dateOfBirth || null,
              },
            });
            setForm({ fullName: "", relationship: "spouse", dateOfBirth: "" });
          }}
        >
          <input
            className={inputCls}
            required
            placeholder="Full name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            data-testid="dependent-name"
          />
          <div className="flex gap-2">
            <select
              className={inputCls}
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            >
              <option value="spouse">Spouse</option>
              <option value="child">Child</option>
              <option value="parent">Parent</option>
              <option value="other">Other</option>
            </select>
            <input
              className={inputCls}
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            />
          </div>
          <button type="submit" className={btnGoldCls} disabled={create.isPending} data-testid="save-dependent">
            {create.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-mute">No dependents recorded.</p>
      ) : (
        <div className="divide-y divide-border-soft">
          {rows.map((d) => (
            <DependentRow
              key={d.id}
              dep={d}
              onDelete={() => {
                if (window.confirm(`Remove ${d.fullName}? Their documents are removed too.`))
                  del.mutate({ id: d.id });
              }}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function DependentRow({
  dep: d,
  onDelete,
  onChanged,
}: {
  dep: AtelierDependent;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({
    fullName: d.fullName,
    relationship: d.relationship as string,
    dateOfBirth: d.dateOfBirth ?? "",
  });
  const update = useAtelierUpdateMyDependent({
    mutation: {
      onSuccess: () => {
        setEditing(false);
        onChanged();
      },
    },
  });
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm text-text">{d.fullName}</span>
          <p className="text-xs text-text-mute">
            {d.relationship}
            {d.dateOfBirth ? ` · born ${d.dateOfBirth}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            className="text-xs text-text-mute hover:text-gold"
            onClick={() => setEditing((v) => !v)}
            data-testid={`edit-dependent-${d.id}`}
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            className="text-xs text-text-faint hover:text-red-400"
            onClick={onDelete}
            data-testid={`delete-dependent-${d.id}`}
          >
            Remove
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="mt-2 space-y-2 rounded border border-border-soft p-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              id: d.id,
              data: {
                fullName: form.fullName.trim(),
                relationship: form.relationship as "spouse" | "child" | "parent" | "other",
                dateOfBirth: form.dateOfBirth || null,
              },
            });
          }}
        >
          <input
            className={inputCls}
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            data-testid={`edit-dependent-name-${d.id}`}
          />
          <div className="flex gap-2">
            <select
              className={inputCls}
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            >
              <option value="spouse">Spouse</option>
              <option value="child">Child</option>
              <option value="parent">Parent</option>
              <option value="other">Other</option>
            </select>
            <input
              className={inputCls}
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className={btnGoldCls}
              disabled={update.isPending}
              data-testid={`save-edit-dependent-${d.id}`}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnCls} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// Emergency contacts (HR-visible)
// ------------------------------------------------------------------
function EmergencyContactsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useAtelierListMyEmergencyContacts();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListMyEmergencyContactsQueryKey() });
  const create = useAtelierCreateMyEmergencyContact({
    mutation: { onSuccess: () => { setAdding(false); invalidate(); } },
  });
  const del = useAtelierDeleteMyEmergencyContact({ mutation: { onSuccess: invalidate } });
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", relationship: "", phone: "", email: "" });

  const rows: AtelierEmergencyContact[] = data?.contacts ?? [];
  return (
    <Card className="p-4" data-testid="me-emergency-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text">Emergency contacts</h3>
        <button className={btnCls} onClick={() => setAdding((v) => !v)} data-testid="add-emergency-contact">
          {adding ? "Close" : "Add"}
        </button>
      </div>
      <p className="mb-2 text-xs text-text-mute">Shared with HR for emergencies only.</p>
      {adding ? (
        <form
          className="mb-3 space-y-2 rounded border border-border-soft p-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              data: {
                name: form.name.trim(),
                relationship: form.relationship.trim(),
                phones: [form.phone.trim()],
                email: form.email.trim() || null,
              },
            });
            setForm({ name: "", relationship: "", phone: "", email: "" });
          }}
        >
          <input
            className={inputCls}
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="emergency-name"
          />
          <div className="flex gap-2">
            <input
              className={inputCls}
              required
              placeholder="Relationship"
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            />
            <input
              className={inputCls}
              required
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              data-testid="emergency-phone"
            />
          </div>
          <input
            className={inputCls}
            type="email"
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <button type="submit" className={btnGoldCls} disabled={create.isPending} data-testid="save-emergency-contact">
            {create.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-mute">No emergency contacts recorded.</p>
      ) : (
        <div className="divide-y divide-border-soft">
          {rows.map((c) => (
            <EmergencyContactRow
              key={c.id}
              contact={c}
              onDelete={() => {
                if (window.confirm(`Remove ${c.name}?`)) del.mutate({ id: c.id });
              }}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function EmergencyContactRow({
  contact: c,
  onDelete,
  onChanged,
}: {
  contact: AtelierEmergencyContact;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({
    name: c.name,
    relationship: c.relationship,
    phone: (c.phones ?? [])[0] ?? "",
    email: c.email ?? "",
  });
  const update = useAtelierUpdateMyEmergencyContact({
    mutation: {
      onSuccess: () => {
        setEditing(false);
        onChanged();
      },
    },
  });
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm text-text">{c.name}</span>
          <p className="text-xs text-text-mute">
            {c.relationship} · {(c.phones ?? []).map(formatPhoneDisplay).join(" · ")}
            {c.email ? ` · ${c.email}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            className="text-xs text-text-mute hover:text-gold"
            onClick={() => setEditing((v) => !v)}
            data-testid={`edit-emergency-${c.id}`}
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            className="text-xs text-text-faint hover:text-red-400"
            onClick={onDelete}
            data-testid={`delete-emergency-${c.id}`}
          >
            Remove
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="mt-2 space-y-2 rounded border border-border-soft p-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({
              id: c.id,
              data: {
                name: form.name.trim(),
                relationship: form.relationship.trim(),
                phones: [form.phone.trim()],
                email: form.email.trim() || null,
              },
            });
          }}
        >
          <input
            className={inputCls}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid={`edit-emergency-name-${c.id}`}
          />
          <div className="flex gap-2">
            <input
              className={inputCls}
              required
              placeholder="Relationship"
              value={form.relationship}
              onChange={(e) => setForm({ ...form, relationship: e.target.value })}
            />
            <input
              className={inputCls}
              required
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <input
            className={inputCls}
            type="email"
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className={btnGoldCls}
              disabled={update.isPending}
              data-testid={`save-edit-emergency-${c.id}`}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnCls} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
