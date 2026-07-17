/**
 * Task #61 — Document Library.
 *
 * Firm-wide surface at `/documents` plus an embeddable
 * `DocumentLibraryPanel` reused on account/engagement detail pages
 * (pre-scoped, picker hidden). Uploads and version uploads go through
 * raw `fetch` + FormData (the established multipart pattern); reads and
 * JSON mutations use the generated hooks.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListDocuments,
  getAtelierListDocumentsQueryKey,
  useAtelierGetDocument,
  getAtelierGetDocumentQueryKey,
  useAtelierUpdateDocument,
  useAtelierDeleteDocument,
  useAtelierGrantDocumentAccess,
  useAtelierRevokeDocumentAccess,
  useAtelierListAccounts,
  useAtelierListEngagements,
  useAtelierGetMe,
} from "@workspace/api-client-react";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Card } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Upload,
  Download,
  Trash2,
  History,
  ShieldCheck,
  Users,
} from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

const CATEGORIES = [
  { value: "proposal", label: "Proposal" },
  { value: "client_deliverable", label: "Client deliverable" },
  { value: "contract", label: "Contract" },
  { value: "template", label: "Template" },
  { value: "other", label: "Other" },
] as const;

function catLabel(v: string | undefined): string {
  return CATEGORIES.find((c) => c.value === v)?.label ?? "Other";
}

function fmtBytes(n: number | undefined): string {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(s: string | undefined | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const selectCls =
  "h-9 rounded-md border border-border bg-bg-elevate px-2 text-sm text-text outline-none focus-visible:border-gold";

// ---------------------------------------------------------------------------
// Upload dialog (new document)
// ---------------------------------------------------------------------------

function UploadDialog(props: {
  open: boolean;
  onClose: () => void;
  fixedAccountId?: string;
  fixedEngagementId?: string;
  onUploaded: () => void;
}) {
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const privileged = me?.role === "founding_partner" || me?.role === "partner";
  const { data: accounts } = useAtelierListAccounts();
  const { data: engagements } = useAtelierListEngagements();
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState<string>("other");
  const [accountId, setAccountId] = React.useState(props.fixedAccountId ?? "");
  const [engagementId, setEngagementId] = React.useState(props.fixedEngagementId ?? "");
  const [aiRetrieval, setAiRetrieval] = React.useState(true);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (props.open) {
      setTitle("");
      setCategory("other");
      setAccountId(props.fixedAccountId ?? "");
      setEngagementId(props.fixedEngagementId ?? "");
      setAiRetrieval(true);
      setFile(null);
    }
  }, [props.open, props.fixedAccountId, props.fixedEngagementId]);

  const scoped = !!props.fixedAccountId || !!props.fixedEngagementId;
  const engOptions = (engagements ?? []).filter(
    (e) => !accountId || (e as { accountId?: string }).accountId === accountId,
  );

  async function submit() {
    if (!file) {
      toast({ title: "Choose a file first", variant: "destructive" });
      return;
    }
    const finalTitle = title.trim() || file.name.replace(/\.[^.]+$/, "");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("title", finalTitle);
      fd.set("category", category);
      if (accountId) fd.set("accountId", accountId);
      if (engagementId) fd.set("engagementId", engagementId);
      fd.set("aiRetrieval", aiRetrieval ? "true" : "false");
      fd.set("file", file);
      const resp = await fetch(`${API_BASE}/documents`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast({
          title: "Upload failed",
          description: String(body?.error ?? resp.status),
          variant: "destructive",
        });
        return;
      }
      toast({ title: `Uploaded "${finalTitle}"` });
      props.onUploaded();
      props.onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-upload-document">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-text-mute">
              File
            </label>
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="input-document-file"
            />
            <p className="text-[11px] text-text-faint mt-1">
              PDF, DOCX, XLSX, PPTX and similar — up to 50 MB.
            </p>
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-text-mute">
              Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={file ? file.name.replace(/\.[^.]+$/, "") : "Document title"}
              data-testid="input-document-title"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-mono uppercase tracking-widest text-text-mute">
                Category
              </label>
              <select
                className={`${selectCls} w-full`}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid="select-document-category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!scoped && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-mono uppercase tracking-widest text-text-mute">
                  Account
                </label>
                <select
                  className={`${selectCls} w-full`}
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setEngagementId("");
                  }}
                  data-testid="select-document-account"
                >
                  <option value="">
                    {privileged ? "None (org-level)" : "Select account…"}
                  </option>
                  {(accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs font-mono uppercase tracking-widest text-text-mute">
                  Engagement
                </label>
                <select
                  className={`${selectCls} w-full`}
                  value={engagementId}
                  onChange={(e) => setEngagementId(e.target.value)}
                  data-testid="select-document-engagement"
                >
                  <option value="">None</option>
                  {engOptions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {(e as { name?: string }).name ?? e.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {!scoped && !accountId && !engagementId && !privileged && (
            <p className="text-[11px] text-warning">
              Org-level documents (no account link) can only be created by partners.
            </p>
          )}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text">Available to AI retrieval</p>
              <p className="text-[11px] text-text-faint">
                Off = stored and shared normally, but never surfaced to agents.
              </p>
            </div>
            <Switch
              checked={aiRetrieval}
              onCheckedChange={setAiRetrieval}
              data-testid="switch-ai-retrieval"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !file} data-testid="button-upload-submit">
              <Upload className="w-4 h-4 mr-1.5" />
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detail dialog — versions, access, audit
// ---------------------------------------------------------------------------

function DetailDialog(props: {
  docId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useAtelierGetMe();
  const { data: detail } = useAtelierGetDocument(props.docId ?? "", {
    query: {
      enabled: !!props.docId,
      queryKey: getAtelierGetDocumentQueryKey(props.docId ?? ""),
    },
  });
  const updateDoc = useAtelierUpdateDocument();
  const deleteDoc = useAtelierDeleteDocument();
  const grantAccess = useAtelierGrantDocumentAccess();
  const revokeAccess = useAtelierRevokeDocumentAccess();
  const [grantUserId, setGrantUserId] = React.useState("");
  const [versionBusy, setVersionBusy] = React.useState(false);
  const versionInputRef = React.useRef<HTMLInputElement>(null);

  const doc = detail?.document;
  const canManage =
    !!me &&
    !!doc &&
    (me.role === "founding_partner" || me.role === "partner" || doc.uploaderUserId === me.id);
  const orgLevel = !!doc && !doc.accountId && !doc.engagementId;

  function refresh() {
    if (props.docId) {
      qc.invalidateQueries({ queryKey: getAtelierGetDocumentQueryKey(props.docId) });
    }
    props.onChanged();
  }

  async function uploadVersion(file: File) {
    if (!props.docId) return;
    setVersionBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const resp = await fetch(`${API_BASE}/documents/${props.docId}/versions`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast({
          title: "Version upload failed",
          description: String(body?.error ?? resp.status),
          variant: "destructive",
        });
        return;
      }
      toast({ title: `Uploaded v${body?.version?.versionNumber ?? ""}` });
      refresh();
    } finally {
      setVersionBusy(false);
      if (versionInputRef.current) versionInputRef.current.value = "";
    }
  }

  function download(versionId?: string) {
    if (!props.docId) return;
    const qs = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
    window.open(`${API_BASE}/documents/${props.docId}/download${qs}`, "_blank");
  }

  return (
    <Dialog open={!!props.docId} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-document-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gold" />
            {doc?.title ?? "Document"}
          </DialogTitle>
        </DialogHeader>
        {doc && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-text-mute">
                {catLabel(doc.category)} · uploaded by {doc.uploaderLabel} ·{" "}
                {fmtDate(doc.createdAt)}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border-soft px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck className="w-4 h-4 text-text-mute" />
                Available to AI retrieval
              </div>
              <Switch
                checked={doc.aiRetrieval}
                disabled={!canManage || updateDoc.isPending}
                onCheckedChange={(on) => {
                  updateDoc.mutate(
                    { id: doc.id, data: { aiRetrieval: on } },
                    { onSuccess: refresh },
                  );
                }}
                data-testid="switch-detail-ai-retrieval"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-mono uppercase tracking-widest text-text-mute flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> Versions
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    ref={versionInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadVersion(f);
                    }}
                    data-testid="input-version-file"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={versionBusy}
                    onClick={() => versionInputRef.current?.click()}
                    data-testid="button-upload-version"
                  >
                    <Upload className="w-3.5 h-3.5 mr-1" />
                    {versionBusy ? "Uploading…" : "New version"}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                {(detail?.versions ?? []).map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded-md border border-border-soft px-3 py-1.5 text-sm"
                    data-testid={`row-version-${v.versionNumber}`}
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-gold mr-2">v{v.versionNumber}</span>
                      <span className="text-text truncate">{v.fileName}</span>
                      <span className="text-text-faint ml-2 text-xs">
                        {fmtBytes(v.sizeBytes)} · {fmtDate(v.createdAt)}
                        {v.id === doc.currentVersionId ? " · current" : ""}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => download(v.id)}
                      data-testid={`button-download-v${v.versionNumber}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {orgLevel && canManage && (
              <div>
                <h3 className="text-xs font-mono uppercase tracking-widest text-text-mute mb-2 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Access grants
                </h3>
                <div className="space-y-1.5">
                  {(detail?.access ?? []).map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between rounded-md border border-border-soft px-3 py-1.5 text-sm"
                    >
                      <span className="font-mono text-xs">{g.userId}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          revokeAccess.mutate(
                            { id: doc.id, userId: g.userId },
                            { onSuccess: refresh },
                          )
                        }
                        data-testid={`button-revoke-${g.userId}`}
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      value={grantUserId}
                      onChange={(e) => setGrantUserId(e.target.value)}
                      placeholder="User id (u_…)"
                      className="h-8 text-sm"
                      data-testid="input-grant-user"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!grantUserId.trim() || grantAccess.isPending}
                      onClick={() =>
                        grantAccess.mutate(
                          { id: doc.id, data: { userId: grantUserId.trim() } },
                          {
                            onSuccess: () => {
                              setGrantUserId("");
                              refresh();
                            },
                            onError: () =>
                              toast({ title: "Grant failed", variant: "destructive" }),
                          },
                        )
                      }
                      data-testid="button-grant-access"
                    >
                      Grant
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-mono uppercase tracking-widest text-text-mute mb-2">
                Activity
              </h3>
              <div className="space-y-1 text-xs text-text-mute max-h-40 overflow-y-auto">
                {(detail?.audit ?? []).map((a) => (
                  <div key={a.id} className="flex justify-between gap-4">
                    <span className="truncate">{a.summary ?? a.action}</span>
                    <span className="text-text-faint whitespace-nowrap">
                      {fmtDate(a.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between pt-1">
              <Button
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={!canManage || deleteDoc.isPending}
                onClick={() => {
                  if (!window.confirm(`Delete "${doc.title}" and all its versions?`)) return;
                  deleteDoc.mutate(
                    { id: doc.id },
                    {
                      onSuccess: () => {
                        toast({ title: "Document deleted" });
                        props.onChanged();
                        props.onClose();
                      },
                      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
                    },
                  );
                }}
                data-testid="button-delete-document"
              >
                <Trash2 className="w-4 h-4 mr-1.5" /> Delete
              </Button>
              <Button onClick={() => download()} data-testid="button-download-current">
                <Download className="w-4 h-4 mr-1.5" /> Download
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reusable panel + page
// ---------------------------------------------------------------------------

export function DocumentLibraryPanel(props: {
  accountId?: string;
  engagementId?: string;
  compact?: boolean;
  /** Deep-link: open this document's detail dialog on mount (`/documents?open=<id>`). */
  initialOpenId?: string | null;
}) {
  const qc = useQueryClient();
  const params = {
    ...(props.accountId ? { accountId: props.accountId } : {}),
    ...(props.engagementId ? { engagementId: props.engagementId } : {}),
  };
  const { data, isLoading } = useAtelierListDocuments(
    Object.keys(params).length ? params : undefined,
  );
  const [q, setQ] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(props.initialOpenId ?? null);

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: getAtelierListDocumentsQueryKey() });
    qc.invalidateQueries({
      queryKey: getAtelierListDocumentsQueryKey(
        Object.keys(params).length ? params : undefined,
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, props.accountId, props.engagementId]);

  const docs = (data?.documents ?? []).filter((d) => {
    if (category && d.category !== category) return false;
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${d.title} ${d.currentVersion?.fileName ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search documents…"
          className="h-9 w-56"
          data-testid="input-documents-search"
        />
        <select
          className={selectCls}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          data-testid="select-documents-category-filter"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button onClick={() => setUploadOpen(true)} data-testid="button-open-upload">
          <Upload className="w-4 h-4 mr-1.5" /> Upload
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-faint font-mono">Loading…</p>
      ) : docs.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="w-8 h-8 mx-auto text-text-faint mb-2" />
          <p className="text-sm text-text-mute">No documents yet.</p>
          <p className="text-xs text-text-faint mt-1">
            Upload proposals, deliverables, contracts or templates produced outside Atelier.
          </p>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {docs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setOpenId(d.id)}
              className="w-full text-left rounded-md border border-border-soft hover:border-gold/40 px-3 py-2 flex items-center gap-3 transition-colors"
              data-testid={`row-document-${d.id}`}
            >
              <FileText className="w-4 h-4 text-gold shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text truncate">{d.title}</p>
                <p className="text-[11px] text-text-faint truncate">
                  {catLabel(d.category)} · {d.currentVersion?.fileName ?? "—"} ·{" "}
                  {fmtBytes(d.currentVersion?.sizeBytes)} · v
                  {d.currentVersion?.versionNumber ?? 1} · {d.uploaderLabel}
                </p>
              </div>
              {!d.aiRetrieval && (
                <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint border border-border-soft rounded px-1.5 py-0.5">
                  no&nbsp;AI
                </span>
              )}
              <span className="text-[11px] text-text-faint whitespace-nowrap">
                {fmtDate(d.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        fixedAccountId={props.accountId}
        fixedEngagementId={props.engagementId}
        onUploaded={refresh}
      />
      <DetailDialog docId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />
    </div>
  );
}

export default function Documents() {
  // Deep-link support: `/documents?open=<docId>` (used by e-sign
  // notifications to jump straight to the archived signed contract).
  const initialOpenId = React.useMemo(
    () => new URLSearchParams(window.location.search).get("open"),
    [],
  );
  return (
    <div className="space-y-6">
      <LensPageHeader
        headline="Documents"
        lede="The firm's library of externally-produced files — proposals, deliverables, contracts and templates — versioned, access-controlled, and available to AI retrieval."
      />
      <div className="container-atelier py-6">
        <DocumentLibraryPanel initialOpenId={initialOpenId} />
      </div>
    </div>
  );
}
