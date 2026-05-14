import * as React from "react";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, PillButton, MonoChip } from "@/components/ui/primitives";

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
        body: JSON.stringify({ firmName: profile?.published?.payload.firmName ?? "AICo", userBrief: brief.trim() || null }),
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
