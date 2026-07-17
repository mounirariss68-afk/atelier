import * as React from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListTrainingMaterials,
  useAtelierCreateTrainingMaterial,
  useAtelierUpdateTrainingMaterial,
  useAtelierArchiveTrainingMaterial,
  useAtelierListTrainingCompletions,
  getAtelierListTrainingMaterialsQueryKey,
} from "@workspace/api-client-react";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { PeopleEmptyState } from "./PeopleEmptyState";
import {
  useLearningCatalogue, useMyLearning, useCertifications, useMentoringPairs, useSkillGaps,
} from "./peopleSeed";

const SUBS = [
  { id: "library",       label: "Training library" },
  { id: "catalogue",     label: "Learning catalogue" },
  { id: "my-learning",   label: "My learning" },
  { id: "certifications", label: "Certifications" },
  { id: "mentoring",     label: "Mentoring" },
  { id: "skill-gaps",    label: "Skill gaps" },
];

export default function PeopleDevelop() {
  const [, params] = useRoute("/people/develop/:section");
  const section = params?.section ?? "library";

  return (
    <PeopleShell stage="develop">
      <LensPageHeader
        headline="Learning, certifications, mentoring, skill gaps"
        lede="Where the firm grows the people it has. Skill-gap views read directly from the Skill Graph."
      />
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/develop/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "library" && <TrainingLibraryView />}
          {section === "catalogue" && <CatalogueView />}
          {section === "my-learning" && <MyLearningView />}
          {section === "certifications" && <CertificationsView />}
          {section === "mentoring" && <MentoringView />}
          {section === "skill-gaps" && <SkillGapsView />}
        </div>
      </div>
    </PeopleShell>
  );
}

// ---------------------------------------------------------------
// Task #55 — Training library: the REAL HR-managed materials behind the
// employee-facing "My Learning" section. Link or file, audience-targeted.
// ---------------------------------------------------------------
const inputCls =
  "w-full rounded border border-border bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold";
const btnCls =
  "px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest bg-gold text-bg hover:opacity-90 disabled:opacity-50";

function TrainingLibraryView() {
  const qc = useQueryClient();
  const { data: materials, isLoading, error } = useAtelierListTrainingMaterials();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListTrainingMaterialsQueryKey() });
  };
  const update = useAtelierUpdateTrainingMaterial({ mutation: { onSuccess: invalidate } });
  const archive = useAtelierArchiveTrainingMaterial({ mutation: { onSuccess: invalidate } });
  const [openCompletions, setOpenCompletions] = React.useState<string | null>(null);

  if (error) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="training-library-restricted">
        <MonoChip tone="amber">Restricted</MonoChip>
        <div className="mt-2">The training library is managed by HR and partner-tier personas.</div>
      </Card>
    );
  }
  return (
    <div className="space-y-6" data-testid="training-library">
      <NewMaterialForm onSaved={invalidate} />
      {isLoading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : !materials || materials.length === 0 ? (
        <Card className="p-4 text-sm text-text-mute">
          No training materials yet — add a link or upload a file above. Items
          appear on each person's "My Learning" page based on the audience you pick.
        </Card>
      ) : (
        <div className="space-y-2">
          {materials.map((m) => (
            <Card key={m.id} className="p-3" data-testid={`material-${m.id}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-text truncate">{m.title}</span>
                    {m.topic ? <MonoChip>{m.topic}</MonoChip> : null}
                    <MonoChip tone="default">{m.kind}</MonoChip>
                  </div>
                  {m.description ? (
                    <div className="text-sm text-text-mute mt-0.5 truncate">{m.description}</div>
                  ) : null}
                </div>
                <MonoChip tone="green">{m.completionCount} done</MonoChip>
                <select
                  className="rounded border border-border bg-transparent px-2 py-1 text-xs text-text"
                  value={m.audience}
                  onChange={(e) =>
                    update.mutate({
                      id: m.id,
                      data: { audience: e.target.value as "all" | "employees" | "contractors" },
                    })
                  }
                  data-testid={`material-audience-${m.id}`}
                >
                  <option value="all">everyone</option>
                  <option value="employees">employees</option>
                  <option value="contractors">contractors</option>
                </select>
                <button
                  className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text"
                  onClick={() => setOpenCompletions(openCompletions === m.id ? null : m.id)}
                  data-testid={`material-completions-${m.id}`}
                >
                  Who's done it
                </button>
                <button
                  className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-red-400"
                  onClick={() => archive.mutate({ id: m.id })}
                  disabled={archive.isPending}
                  data-testid={`material-archive-${m.id}`}
                >
                  Archive
                </button>
              </div>
              {openCompletions === m.id ? <CompletionList materialId={m.id} /> : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CompletionList({ materialId }: { materialId: string }) {
  const { data: rows, isLoading } = useAtelierListTrainingCompletions(materialId);
  if (isLoading) return <p className="mt-2 text-xs text-text-faint">Loading…</p>;
  if (!rows || rows.length === 0) {
    return <p className="mt-2 text-xs text-text-mute">No one in the audience holds a login yet.</p>;
  }
  return (
    <div className="mt-3 border-t border-border-soft pt-2 space-y-1">
      {rows.map((p) => (
        <div key={p.userId} className="flex items-center justify-between text-xs">
          <span className="text-text-mute">
            {p.name} <span className="text-text-faint">· {p.workerType}</span>
          </span>
          <MonoChip tone={p.completed ? "green" : "default"}>
            {p.completed ? "completed" : "not yet"}
          </MonoChip>
        </div>
      ))}
    </div>
  );
}

function NewMaterialForm({ onSaved }: { onSaved: () => void }) {
  const [mode, setMode] = React.useState<"link" | "file">("link");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [audience, setAudience] = React.useState<"all" | "employees" | "contractors">("all");
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setTitle(""); setDescription(""); setTopic(""); setUrl("");
    setFile(null); setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const createLink = useAtelierCreateTrainingMaterial({
    mutation: { onSuccess: () => { reset(); onSaved(); } },
  });

  const uploadFile = async () => {
    if (!file || !title.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("topic", topic.trim());
      fd.append("audience", audience);
      const res = await fetch(`/api/atelier/people/training-materials/upload`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Upload failed (${res.status})`);
      }
      reset();
      onSaved();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="p-4 space-y-2" data-testid="new-material-form">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Add training material</h3>
        <div className="flex gap-1">
          {(["link", "file"] as const).map((k) => (
            <button
              key={k}
              className={`px-2 py-1 rounded font-mono text-[10px] uppercase tracking-wider border ${mode === k ? "border-gold text-gold" : "border-border text-text-faint hover:text-text"}`}
              onClick={() => setMode(k)}
              data-testid={`material-mode-${k}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <input className={inputCls} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="material-title" />
      <textarea className={inputCls} rows={2} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Topic (e.g. Security)" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <select className={inputCls} value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} data-testid="material-audience">
          <option value="all">Everyone</option>
          <option value="employees">Employees only</option>
          <option value="contractors">Contractors only</option>
        </select>
      </div>
      {mode === "link" ? (
        <input className={inputCls} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="material-url" />
      ) : (
        <input
          ref={fileInputRef}
          type="file"
          className="block w-full text-sm text-text-mute file:mr-3 file:rounded file:border-0 file:bg-gold file:px-3 file:py-1.5 file:font-mono file:text-[10px] file:uppercase file:tracking-widest file:text-bg"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          data-testid="material-file"
        />
      )}
      <button
        className={btnCls}
        disabled={
          !title.trim() ||
          (mode === "link" ? !url.trim() || createLink.isPending : !file || uploading)
        }
        onClick={() => {
          if (mode === "link") {
            createLink.mutate({
              data: {
                title: title.trim(),
                description: description.trim() || undefined,
                topic: topic.trim() || undefined,
                kind: "link",
                url: url.trim(),
                audience,
              },
            });
          } else {
            void uploadFile();
          }
        }}
        data-testid="material-save"
      >
        {mode === "link" ? "Add link" : uploading ? "Uploading…" : "Upload file"}
      </button>
      {createLink.error ? <p className="text-xs text-red-400">Could not add the material.</p> : null}
      {uploadError ? <p className="text-xs text-red-400">{uploadError}</p> : null}
    </Card>
  );
}

function CatalogueView() {
  const rows = useLearningCatalogue();
  if (rows.length === 0) {
    return <PeopleEmptyState message="No catalogue courses yet. External course records will appear here once they are added." />;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((c) => (
        <Card key={c.id} className="p-4 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium text-text">{c.title}</div>
              <div className="text-xs text-text-faint">{c.provider} · {c.durationHours}h · {c.format}</div>
            </div>
            <MonoChip tone={c.level === "advanced" ? "gold" : c.level === "core" ? "green" : "default"}>{c.level}</MonoChip>
          </div>
          <div className="flex gap-1 flex-wrap">
            {c.skillTagIds.map((s) => <MonoChip key={s}>{s}</MonoChip>)}
          </div>
        </Card>
      ))}
    </div>
  );
}

function MyLearningView() {
  const rows = useMyLearning();
  if (rows.length === 0) {
    return <PeopleEmptyState message="No learning enrolments yet. Assign training from the Training library to see progress here." />;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="text-text">{r.courseTitle}</div>
              <div className="text-xs text-text-faint">
                {r.status === "completed" ? `completed ${r.completedAt}` : r.dueDate ? `due ${r.dueDate}` : "—"}
              </div>
            </div>
            <div className="w-32 h-2 bg-border rounded overflow-hidden">
              <div className="h-full bg-gold" style={{ width: `${r.progressPct}%` }} />
            </div>
            <MonoChip tone={r.status === "completed" ? "green" : r.status === "in-progress" ? "gold" : "default"}>
              {r.status}
            </MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function CertificationsView() {
  const rows = useCertifications();
  if (rows.length === 0) {
    return <PeopleEmptyState message="No certification records yet." />;
  }
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-mute font-mono uppercase">
          <tr><th className="text-left py-2">Person</th><th className="text-left">Certification</th><th>Issued</th><th>Expires</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border-soft">
              <td className="py-2 text-text">{c.personName}</td>
              <td className="text-text">{c.certName} <span className="text-text-faint text-xs">· {c.issuer}</span></td>
              <td className="text-center text-text-mute">{c.issuedOn}</td>
              <td className="text-center text-text-mute">{c.expiresOn ?? "—"}</td>
              <td className="text-center">
                <MonoChip tone={c.status === "active" ? "green" : c.status === "expiring" ? "amber" : "red"}>{c.status}</MonoChip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function MentoringView() {
  const rows = useMentoringPairs();
  if (rows.length === 0) {
    return <PeopleEmptyState message="No mentoring pairings recorded yet." />;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text">{p.mentor} → {p.mentee}</div>
              <div className="text-xs text-text-faint">started {p.startedOn}</div>
            </div>
            <MonoChip>{p.cadence}</MonoChip>
          </div>
          <div className="mt-2 text-sm text-text-mute">Focus: {p.focus}</div>
        </Card>
      ))}
    </div>
  );
}

function SkillGapsView() {
  const rows = useSkillGaps();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute">
        Reads from the firm Skill Graph. <Link href="/people/skills" className="text-gold hover:underline">Open Skill graph →</Link>
      </p>
      {rows.length === 0 && (
        <PeopleEmptyState message="No skill-gap analysis yet. Gaps appear once demand roles and the Skill Graph carry enough data." />
      )}
      {rows.map((g) => (
        <Card key={g.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text font-medium">{g.skill}</div>
              <div className="text-xs text-text-faint">demand {g.demandRoles} · supply {g.internalSupply}</div>
            </div>
            <MonoChip tone={g.gap >= 4 ? "red" : g.gap >= 2 ? "amber" : "default"}>gap {g.gap}</MonoChip>
          </div>
          {g.topCandidates.length > 0 && (
            <div className="mt-2 text-xs text-text-mute">Top internal candidates: {g.topCandidates.join(", ")}</div>
          )}
        </Card>
      ))}
    </div>
  );
}
