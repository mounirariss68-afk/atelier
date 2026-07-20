import * as React from "react";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, PillButton, MonoChip } from "@/components/ui/primitives";

interface SigningEntity {
  id: string;
  name: string;
  jurisdiction: string;
  registeredAddress: string;
  country: string;
  governingLaw: string;
  courts: string;
  isDefault: boolean;
  // Task #335 — users allowed to execute the firm-side "Sign & send".
  authorisedSignatories?: { userId: string; name: string; email: string }[];
}

interface OrgUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface FirmPayload {
  firmName: string;
  tagline: string;
  missionStatement: string;
  voiceAttributes: string[];
  principles: { name: string; description: string }[];
  boilerplateShort: string;
  boilerplateLong: string;
  capabilitiesPitch: string;
  differentiators: string[];
  proofPoints: { label: string; metric: string }[];
  legalEntities: { name: string; jurisdiction: string }[];
  contactBlock: string;
  brandColors?: { primary?: string; ink?: string; gold?: string };
}

interface FirmRow {
  id: string;
  version: number;
  status: "draft" | "published" | "superseded";
  payload: FirmPayload;
  runId: string | null;
  notes: string | null;
  publishedAt: string | null;
  publishedByName: string | null;
  createdAt: string;
}

interface FirmProfileResponse {
  published: FirmRow | null;
  latestDraft: FirmRow | null;
  canPublish: boolean;
}

const API_BASE = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"}api/atelier`;
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export default function FirmProfile() {
  const { data: me } = useAtelierGetMe();
  const [, navigate] = useLocation();
  const [profile, setProfile] = React.useState<FirmProfileResponse | null>(null);
  const [versions, setVersions] = React.useState<FirmRow[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [brief, setBrief] = React.useState("");

  const allowed = me?.role === "founding_partner" || me?.role === "hr";

  const reload = React.useCallback(async () => {
    try {
      const [p, v] = await Promise.all([
        api<FirmProfileResponse>("/firm-profile"),
        api<{ versions: FirmRow[] }>("/firm-profile/versions"),
      ]);
      setProfile(p);
      setVersions(v.versions);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    if (!me) return;
    if (!allowed) return;
    reload();
  }, [me, allowed, reload]);

  if (!me) return <div className="p-6 text-sm text-text-mute">Loading…</div>;
  if (!allowed) {
    return (
      <div className="p-6">
        <Card className="p-6 max-w-xl">
          <div className="text-base font-medium text-text">Restricted</div>
          <div className="text-sm text-text-mute mt-1">
            The Firm Profile is editable only by founding partners and HR.
          </div>
          <button
            className="mt-4 text-sm underline text-text-mute"
            onClick={() => navigate("/")}
          >Back to home</button>
        </Card>
      </div>
    );
  }

  async function runWriter() {
    setLoading(true); setErr(null);
    try {
      await api("/firm-profile/run-writer", {
        method: "POST",
        body: JSON.stringify({ firmName: profile?.published?.payload.firmName ?? "Cognirise", userBrief: brief.trim() || null }),
      });
      setBrief("");
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  async function publish(id: string) {
    setLoading(true); setErr(null);
    try {
      await api(`/firm-profile/${id}/publish`, { method: "POST" });
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  async function saveDraft(payload: FirmPayload, notes: string | null) {
    setLoading(true); setErr(null);
    try {
      await api("/firm-profile/draft", {
        method: "POST",
        body: JSON.stringify({ payload, notes }),
      });
      await reload();
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  function DraftEditor({
    row,
    loading,
    onSave,
    onPublish,
  }: {
    row: FirmRow;
    loading: boolean;
    onSave: (payload: FirmPayload, notes: string | null) => void;
    onPublish: () => void;
  }) {
    const [draft, setDraft] = React.useState<FirmPayload>(row.payload);
    const [notes, setNotes] = React.useState<string>(row.notes ?? "");
    const [dirty, setDirty] = React.useState(false);
    React.useEffect(() => { setDraft(row.payload); setNotes(row.notes ?? ""); setDirty(false); }, [row.id]);
    function patch<K extends keyof FirmPayload>(k: K, v: FirmPayload[K]) {
      setDraft((d) => ({ ...d, [k]: v }));
      setDirty(true);
    }
    return (
      <Card className="p-5 space-y-4" data-testid="firm-profile-draft-editor">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Latest draft · v{row.version}</div>
            <div className="text-base font-medium text-text">Edit canonical brand copy before publishing.</div>
          </div>
          <MonoChip>{row.status}</MonoChip>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <label className="space-y-1">
            <div className="text-xs uppercase text-text-mute">Firm name</div>
            <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.firmName} onChange={(e) => patch("firmName", e.target.value)}
              data-testid="firm-profile-edit-firmName" />
          </label>
          <label className="space-y-1">
            <div className="text-xs uppercase text-text-mute">Tagline</div>
            <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.tagline} onChange={(e) => patch("tagline", e.target.value)}
              data-testid="firm-profile-edit-tagline" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className="text-xs uppercase text-text-mute">Mission statement</div>
            <textarea rows={3} className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.missionStatement} onChange={(e) => patch("missionStatement", e.target.value)}
              data-testid="firm-profile-edit-mission" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className="text-xs uppercase text-text-mute">Boilerplate (short)</div>
            <textarea rows={2} className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.boilerplateShort} onChange={(e) => patch("boilerplateShort", e.target.value)}
              data-testid="firm-profile-edit-boilerplateShort" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className="text-xs uppercase text-text-mute">Boilerplate (long)</div>
            <textarea rows={4} className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.boilerplateLong} onChange={(e) => patch("boilerplateLong", e.target.value)}
              data-testid="firm-profile-edit-boilerplateLong" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className="text-xs uppercase text-text-mute">Capabilities pitch</div>
            <textarea rows={3} className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.capabilitiesPitch} onChange={(e) => patch("capabilitiesPitch", e.target.value)}
              data-testid="firm-profile-edit-capabilitiesPitch" />
          </label>
          <label className="space-y-1">
            <div className="text-xs uppercase text-text-mute">Differentiators (one per line)</div>
            <textarea rows={4} className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.differentiators.join("\n")}
              onChange={(e) => patch("differentiators", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
              data-testid="firm-profile-edit-differentiators" />
          </label>
          <label className="space-y-1">
            <div className="text-xs uppercase text-text-mute">Voice attributes (one per line)</div>
            <textarea rows={4} className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.voiceAttributes.join("\n")}
              onChange={(e) => patch("voiceAttributes", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
              data-testid="firm-profile-edit-voiceAttributes" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className="text-xs uppercase text-text-mute">Contact block</div>
            <textarea rows={2} className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={draft.contactBlock} onChange={(e) => patch("contactBlock", e.target.value)}
              data-testid="firm-profile-edit-contact" />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className="text-xs uppercase text-text-mute">Editor notes (versioning)</div>
            <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
              value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              placeholder="What changed in this draft?"
              data-testid="firm-profile-edit-notes" />
          </label>
        </div>
        <div className="pt-3 border-t border-border-soft flex items-center gap-2">
          <PillButton onClick={() => onSave(draft, notes.trim() || null)} disabled={loading || !dirty}
            data-testid="save-firm-profile-draft">
            {loading ? "Saving…" : dirty ? "Save edits as new draft" : "No edits to save"}
          </PillButton>
          <PillButton onClick={onPublish} disabled={loading || dirty}
            data-testid={`publish-firm-profile-${row.id}`}>
            Publish v{row.version}
          </PillButton>
          <span className="text-xs text-text-mute">
            Saving creates a new draft version. Publishing supersedes the current published row.
          </span>
        </div>
      </Card>
    );
  }

  function SigningEntitiesCard() {
    const [entities, setEntities] = React.useState<SigningEntity[] | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [seErr, setSeErr] = React.useState<string | null>(null);
    const [dirty, setDirty] = React.useState(false);
    // Task #335 — org users for the authorised-signatory pickers.
    const [users, setUsers] = React.useState<OrgUser[]>([]);
    const [sigBusy, setSigBusy] = React.useState<string | null>(null);

    const load = React.useCallback(async () => {
      try {
        const r = await api<{ entities: SigningEntity[] }>("/signing-entities");
        setEntities(r.entities);
        setDirty(false);
      } catch (e) {
        setSeErr((e as Error).message);
      }
    }, []);
    React.useEffect(() => { void load(); }, [load]);
    React.useEffect(() => {
      api<OrgUser[]>("/users")
        .then((rows) => setUsers(rows))
        .catch(() => setUsers([]));
    }, []);

    // Task #335 — persist an entity's authorised-signatories list.
    async function saveSignatories(entityId: string, userIds: string[]) {
      setSigBusy(entityId); setSeErr(null);
      try {
        const r = await api<{ authorisedSignatories: SigningEntity["authorisedSignatories"] }>(
          `/signing-entities/${entityId}/signatories`,
          { method: "PUT", body: JSON.stringify({ userIds }) },
        );
        setEntities((prev) =>
          prev?.map((e) =>
            e.id === entityId ? { ...e, authorisedSignatories: r.authorisedSignatories ?? [] } : e,
          ) ?? prev,
        );
      } catch (e) { setSeErr((e as Error).message); }
      finally { setSigBusy(null); }
    }

    function patchEntity(i: number, p: Partial<SigningEntity>) {
      setEntities((prev) => {
        if (!prev) return prev;
        let next = prev.map((e, j) => (j === i ? { ...e, ...p } : e));
        if (p.isDefault) next = next.map((e, j) => ({ ...e, isDefault: j === i }));
        return next;
      });
      setDirty(true);
    }

    async function save() {
      if (!entities) return;
      setSaving(true); setSeErr(null);
      try {
        const r = await api<{ entities: SigningEntity[] }>("/firm-profile/legal-entities", {
          method: "PUT",
          body: JSON.stringify({
            entities: entities.map(({ id, ...rest }) => ({
              ...(id.startsWith("new-") ? {} : { id }),
              ...rest,
            })),
          }),
        });
        setEntities(r.entities);
        setDirty(false);
      } catch (e) { setSeErr((e as Error).message); }
      finally { setSaving(false); }
    }

    return (
      <Card className="p-5 space-y-3" data-testid="firm-profile-signing-entities">
        <div>
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Signing entities</div>
          <p className="text-sm text-text-mute">
            Legal entities Cognirise signs contracts under. The default is preselected when a
            contract is prepared; the entity drives firm-name, address and governing-law auto-fill.
          </p>
        </div>
        {seErr ? <div className="text-sm text-red-400" data-testid="signing-entities-error">{seErr}</div> : null}
        {entities === null ? (
          <div className="text-sm text-text-mute">Loading…</div>
        ) : (
          <div className="space-y-4">
            {entities.length === 0 ? (
              <div className="text-sm text-text-mute" data-testid="signing-entities-empty">
                No signing entities yet — add the firm's registered legal entity below.
              </div>
            ) : null}
            {entities.map((e, i) => (
              <div key={e.id} className="border border-border-soft rounded p-3 space-y-2" data-testid={`signing-entity-${i}`}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <label className="space-y-1 md:col-span-2">
                    <div className="text-xs uppercase text-text-mute">Legal name</div>
                    <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
                      value={e.name} onChange={(ev) => patchEntity(i, { name: ev.target.value })}
                      data-testid={`signing-entity-name-${i}`} />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <div className="text-xs uppercase text-text-mute">Registered address</div>
                    <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
                      value={e.registeredAddress} onChange={(ev) => patchEntity(i, { registeredAddress: ev.target.value })}
                      data-testid={`signing-entity-address-${i}`} />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs uppercase text-text-mute">Country</div>
                    <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
                      value={e.country} onChange={(ev) => patchEntity(i, { country: ev.target.value })}
                      data-testid={`signing-entity-country-${i}`} />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs uppercase text-text-mute">Jurisdiction</div>
                    <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
                      value={e.jurisdiction} onChange={(ev) => patchEntity(i, { jurisdiction: ev.target.value })}
                      data-testid={`signing-entity-jurisdiction-${i}`} />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs uppercase text-text-mute">Governing law</div>
                    <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
                      value={e.governingLaw} onChange={(ev) => patchEntity(i, { governingLaw: ev.target.value })}
                      data-testid={`signing-entity-law-${i}`} />
                  </label>
                  <label className="space-y-1">
                    <div className="text-xs uppercase text-text-mute">Courts / dispute forum</div>
                    <input className="w-full rounded border border-border-soft bg-bg-deep px-2 py-1 text-text"
                      value={e.courts} onChange={(ev) => patchEntity(i, { courts: ev.target.value })}
                      data-testid={`signing-entity-courts-${i}`} />
                  </label>
                </div>
                {(() => {
                  const blank: string[] = [];
                  if (!e.registeredAddress.trim()) blank.push("registered address");
                  if (!e.governingLaw.trim()) blank.push("governing law");
                  if (!e.jurisdiction.trim()) blank.push("jurisdiction");
                  if (!e.courts.trim()) blank.push("courts / dispute forum");
                  return blank.length > 0 ? (
                    <div className="text-xs text-amber-400" data-testid={`signing-entity-warning-${i}`}>
                      Missing {blank.join(", ")} — contracts prepared under this entity will ask for
                      {blank.length > 1 ? " these details" : " this detail"} manually. You can still save.
                    </div>
                  ) : null;
                })()}
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1.5 text-text">
                    <input type="radio" name="signing-entity-default" checked={e.isDefault}
                      onChange={() => patchEntity(i, { isDefault: true })}
                      data-testid={`signing-entity-default-${i}`} />
                    Default entity
                  </label>
                  <button className="text-xs text-red-400 underline ml-auto"
                    onClick={() => { setEntities((prev) => prev?.filter((_, j) => j !== i) ?? prev); setDirty(true); }}
                    data-testid={`signing-entity-remove-${i}`}>
                    Remove
                  </button>
                </div>
                {/* Task #335 — authorised signatories for this entity */}
                {e.id.startsWith("new-") ? (
                  <div className="text-xs text-text-mute" data-testid={`signing-entity-signatories-pending-${i}`}>
                    Save the registry first, then pick this entity's authorised signatories.
                  </div>
                ) : (
                  <div className="space-y-1" data-testid={`signing-entity-signatories-${i}`}>
                    <div className="text-xs uppercase text-text-mute">Authorised signatories</div>
                    <p className="text-xs text-text-mute">
                      Only these people can sign contracts under this entity ("Sign &amp; send").
                      Leave empty to allow any partner.
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {users.map((u) => {
                        const selected = (e.authorisedSignatories ?? []).some((s) => s.userId === u.id);
                        return (
                          <label key={u.id} className="flex items-center gap-1.5 text-sm text-text">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={sigBusy === e.id}
                              onChange={() => {
                                const current = (e.authorisedSignatories ?? []).map((s) => s.userId);
                                const next = selected
                                  ? current.filter((idn) => idn !== u.id)
                                  : [...current, u.id];
                                void saveSignatories(e.id, next);
                              }}
                              data-testid={`signing-entity-${i}-signatory-${u.id}`}
                            />
                            {u.name}
                          </label>
                        );
                      })}
                      {users.length === 0 ? (
                        <span className="text-xs text-text-mute">No users found.</span>
                      ) : null}
                    </div>
                    {sigBusy === e.id ? (
                      <div className="text-xs text-text-mute">Saving signatories…</div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <PillButton
                onClick={() => {
                  setEntities((prev) => [
                    ...(prev ?? []),
                    {
                      id: `new-${Date.now()}`,
                      name: "",
                      jurisdiction: "",
                      registeredAddress: "",
                      country: "",
                      governingLaw: "",
                      courts: "",
                      isDefault: (prev ?? []).length === 0,
                    },
                  ]);
                  setDirty(true);
                }}
                data-testid="signing-entity-add"
              >
                Add entity
              </PillButton>
              <PillButton onClick={save} disabled={saving || !dirty} data-testid="signing-entities-save">
                {saving ? "Saving…" : dirty ? "Save registry" : "Saved"}
              </PillButton>
              <span className="text-xs text-text-mute">Exactly one entity must be the default.</span>
            </div>
          </div>
        )}
      </Card>
    );
  }

  function PayloadView({ row, label }: { row: FirmRow; label: string }) {
    const p = row.payload;
    return (
      <Card className="p-5 space-y-4" data-testid={`firm-profile-${label}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute">{label} · v{row.version}</div>
            <div className="text-base font-medium text-text">{p.firmName} — {p.tagline}</div>
          </div>
          <MonoChip>{row.status}</MonoChip>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
          <div>
            <div className="text-xs uppercase text-text-mute mb-1">Mission</div>
            <p className="text-text">{p.missionStatement}</p>
            <div className="text-xs uppercase text-text-mute mt-3 mb-1">Boilerplate (short)</div>
            <p className="text-text">{p.boilerplateShort}</p>
            <div className="text-xs uppercase text-text-mute mt-3 mb-1">Capabilities pitch</div>
            <p className="text-text">{p.capabilitiesPitch}</p>
          </div>
          <div>
            <div className="text-xs uppercase text-text-mute mb-1">Differentiators</div>
            <ul className="list-disc list-inside text-text space-y-1">
              {p.differentiators.map((d, i) => (<li key={i}>{d}</li>))}
            </ul>
            <div className="text-xs uppercase text-text-mute mt-3 mb-1">Proof points</div>
            <ul className="space-y-1 text-text">
              {p.proofPoints.map((pp, i) => (
                <li key={i}><strong>{pp.label}</strong> — {pp.metric}</li>
              ))}
            </ul>
            <div className="text-xs uppercase text-text-mute mt-3 mb-1">Legal entities</div>
            <ul className="text-text">
              {p.legalEntities.map((le, i) => (<li key={i}>{le.name} <span className="text-text-mute">({le.jurisdiction})</span></li>))}
            </ul>
          </div>
        </div>
        {row.status === "draft" ? (
          <div className="pt-3 border-t border-border-soft flex items-center gap-2">
            <PillButton onClick={() => publish(row.id)} disabled={loading} data-testid={`publish-firm-profile-${row.id}`}>
              Publish v{row.version}
            </PillButton>
            <span className="text-xs text-text-mute">Publishes as the canonical brand-copy source for proposals + decks.</span>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Front of House</div>
        <h1 className="text-xl font-semibold text-text">Firm Profile</h1>
        <p className="text-sm text-text-mute max-w-2xl">
          Canonical source of brand copy. The Brand Profile Writer drafts new versions; founding partners and HR publish.
          Every proposal, deck and Salon page reads from the latest <strong>published</strong> row.
        </p>
      </div>

      {err ? (
        <div className="text-sm text-red-400 border border-red-700 rounded p-3" data-testid="firm-profile-error">{err}</div>
      ) : null}

      <Card className="p-5 space-y-3">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Run the Brand Profile Writer</div>
        <textarea
          rows={2}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Optional brief: what should change vs. the published version? (e.g. 'add ISO27001 to differentiators')"
          className="w-full rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text"
          data-testid="firm-profile-brief"
        />
        <PillButton onClick={runWriter} disabled={loading} data-testid="run-brand-profile-writer">
          {loading ? "Drafting…" : "Draft a new version"}
        </PillButton>
      </Card>

      <SigningEntitiesCard />

      {profile?.latestDraft ? (
        <DraftEditor
          row={profile.latestDraft}
          loading={loading}
          onSave={(payload, notes) => saveDraft(payload, notes)}
          onPublish={() => publish(profile.latestDraft!.id)}
        />
      ) : (
        <Card className="p-5 text-sm text-text-mute">No drafts yet — click <em>Draft a new version</em> to seed one.</Card>
      )}

      {profile?.published ? (
        <PayloadView row={profile.published} label="Published" />
      ) : null}
      {!profile?.published ? (
        <Card className="p-5 text-sm text-text-mute">Nothing published yet — proposals will fall back to a stub Company Profile.</Card>
      ) : null}

      {versions && versions.length > 0 ? (
        <Card className="p-5">
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute mb-2">All versions</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-text-mute">
              <tr><th className="text-left py-1">v</th><th className="text-left py-1">status</th><th className="text-left py-1">name</th><th className="text-left py-1">created</th><th className="text-left py-1">published</th></tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-border-soft">
                  <td className="py-1">{v.version}</td>
                  <td className="py-1"><MonoChip>{v.status}</MonoChip></td>
                  <td className="py-1">{v.payload.firmName}</td>
                  <td className="py-1 text-text-mute">{new Date(v.createdAt).toLocaleString()}</td>
                  <td className="py-1 text-text-mute">{v.publishedAt ? `${v.publishedByName ?? "?"} · ${new Date(v.publishedAt).toLocaleString()}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
