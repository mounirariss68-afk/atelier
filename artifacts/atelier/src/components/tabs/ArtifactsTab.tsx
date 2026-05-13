import * as React from "react";
import {
  useAtelierListArtifacts,
  useAtelierCreateArtifact,
  useAtelierTranslateArtifact,
  getAtelierListArtifactsQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Languages } from "lucide-react";

export function ArtifactsTab({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: items, isLoading } = useAtelierListArtifacts(engId);
  const create = useAtelierCreateArtifact();
  const translate = useAtelierTranslateArtifact();
  const [showForm, setShowForm] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [source, setSource] = React.useState<"upload" | "synthesis" | "external">("upload");

  function inv() {
    qc.invalidateQueries({ queryKey: getAtelierListArtifactsQueryKey(engId) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
  }

  async function onCreate() {
    if (!title.trim()) return;
    await create.mutateAsync({ engId, data: { title, body, source, tags: [] } });
    setTitle(""); setBody(""); setShowForm(false);
    inv();
    toast({ title: "Artifact saved" });
  }

  async function onTranslate(id: string) {
    await translate.mutateAsync({ artifactId: id });
    inv();
    toast({ title: "Stub translation saved" });
  }

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
          {(items ?? []).length} artifact{(items ?? []).length === 1 ? "" : "s"}
        </div>
        <PillButton variant="primary" onClick={() => setShowForm((s) => !s)} data-testid="btn-add-artifact">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> New artifact
        </PillButton>
      </div>

      {showForm && (
        <Card className="p-5 space-y-3 bg-bg-deep">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
            data-testid="input-artifact-title"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Body (English or Arabic — auto-detected)"
            rows={4}
            className="w-full bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
            data-testid="input-artifact-body"
          />
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as never)}
            className="bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
          >
            <option value="upload">upload</option>
            <option value="synthesis">synthesis</option>
            <option value="external">external</option>
          </select>
          <div className="flex justify-end gap-2">
            <PillButton variant="ghost" onClick={() => setShowForm(false)}>Cancel</PillButton>
            <PillButton variant="primary" onClick={onCreate} disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save"}
            </PillButton>
          </div>
        </Card>
      )}

      {(items ?? []).length === 0 && (
        <Card className="p-12 text-center border-dashed bg-bg-deep">
          <p className="text-text-mute">No artifacts yet.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(items ?? []).map((a) => (
          <Card key={a.id} className="p-5 space-y-2" data-testid={`artifact-card-${a.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-text">{a.title}</div>
              <div className="flex items-center gap-1.5">
                <MonoChip tone={a.language === "ar" ? "amber" : "default"}>{a.language}</MonoChip>
                <MonoChip tone="default">{a.source}</MonoChip>
              </div>
            </div>
            {a.abstract && <div className="text-sm text-text-mute">{a.abstract}</div>}
            {a.body && (
              <div className="text-xs text-text-mute font-mono whitespace-pre-wrap line-clamp-4" dir={a.language === "ar" ? "rtl" : "ltr"}>
                {a.body}
              </div>
            )}
            {a.translatedBody && (
              <div className="text-xs text-gold font-mono whitespace-pre-wrap line-clamp-4 border-t border-border-soft pt-2 mt-1" dir={a.language === "ar" ? "ltr" : "rtl"}>
                {a.translatedBody}
              </div>
            )}
            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] font-mono text-text-mute">
                {new Date(a.createdAt).toLocaleString()}
              </span>
              {!a.translatedAt && (
                <button
                  onClick={() => onTranslate(a.id)}
                  className="inline-flex items-center gap-1 text-xs font-mono text-text-mute hover:text-gold"
                  disabled={translate.isPending}
                  data-testid={`btn-translate-${a.id}`}
                >
                  <Languages className="w-3 h-3" /> Translate
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
