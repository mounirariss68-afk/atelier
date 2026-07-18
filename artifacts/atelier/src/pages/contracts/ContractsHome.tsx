/**
 * Task #159 — Contract lifecycle: central overview + template management.
 *
 * `/contracts`            → all visible contract records, filterable.
 * `/contracts/templates`  → Word (.docx) templates with LLM-detected
 *                           field schemas: upload, review fields, activate,
 *                           archive, new versions, download.
 *
 * Multipart uploads and file downloads use raw fetch (the established
 * Document Library pattern); JSON reads/writes use the codegen hooks.
 */
import * as React from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  useAtelierListContracts,
  useAtelierListContractTemplates,
  getAtelierListContractTemplatesQueryKey,
  useAtelierUpdateContractTemplate,
  useAtelierReviewContractTemplateFields,
  useAtelierCreateContract,
  getAtelierListContractsQueryKey,
  type AtelierContract,
  type AtelierContractTemplate,
  type AtelierContractTemplateField,
} from "@workspace/api-client-react";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Upload, Download, FileText, Pencil } from "lucide-react";
import {
  ContractRow,
  CONTRACT_STATUS_META,
  CONTRACT_TYPE_LABELS,
} from "@/components/contracts/ContractsPanel";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;
const selectCls =
  "h-9 rounded-md border border-border bg-bg-elevate px-2 text-sm text-text outline-none focus-visible:border-gold";

const CONTRACT_TYPES = Object.keys(CONTRACT_TYPE_LABELS);

// ---------------------------------------------------------------- templates

function UploadTemplateDialog(props: {
  open: boolean;
  onClose: () => void;
  onUploaded: (templateId: string) => void;
  existing?: AtelierContractTemplate | null;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [contractType, setContractType] = React.useState("other");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const newVersion = !!props.existing;

  React.useEffect(() => {
    if (props.open) {
      setName(props.existing?.name ?? "");
      setContractType(props.existing?.contractType ?? "other");
      setFile(null);
    }
  }, [props.open, props.existing]);

  async function submit() {
    if (!file) {
      toast({ title: "Choose a .docx file first", variant: "destructive" });
      return;
    }
    const finalName = name.trim() || file.name.replace(/\.[^.]+$/, "");
    setBusy(true);
    try {
      const fd = new FormData();
      if (!newVersion) {
        fd.set("name", finalName);
        fd.set("contractType", contractType);
      }
      fd.set("file", file);
      const url = newVersion
        ? `${API_BASE}/contract-templates/${props.existing!.id}/versions`
        : `${API_BASE}/contract-templates`;
      const resp = await fetch(url, { method: "POST", credentials: "include", body: fd });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast({
          title: "Upload failed",
          description: String(body?.message ?? body?.error ?? resp.status),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: newVersion ? "New version uploaded" : `Template "${finalName}" uploaded`,
        description: "Fields were auto-detected — review them before activating.",
      });
      props.onUploaded(String(body?.template?.id ?? props.existing?.id ?? ""));
      props.onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {newVersion ? `New version — ${props.existing!.name}` : "Upload contract template"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!newVersion && (
            <>
              <div>
                <label className="text-xs text-text-faint">Template name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Mutual NDA (2026)"
                  data-testid="input-template-name"
                />
              </div>
              <div>
                <label className="text-xs text-text-faint">Contract type</label>
                <select
                  className={`${selectCls} w-full`}
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value)}
                  data-testid="select-template-type"
                >
                  {CONTRACT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CONTRACT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="text-xs text-text-faint">Word document (.docx)</label>
            <Input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="input-template-file"
            />
          </div>
          <p className="text-[11px] text-text-faint">
            The AI reads the document and proposes fill-in fields (names, dates,
            amounts…). You review and confirm them before the template can be used.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !file} data-testid="button-upload-template">
            {busy ? "Uploading & detecting fields…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewFieldsDialog(props: {
  open: boolean;
  onClose: () => void;
  template: AtelierContractTemplate;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const version = props.template.currentVersion;
  const [fields, setFields] = React.useState<AtelierContractTemplateField[]>([]);
  React.useEffect(() => {
    if (props.open) setFields(version?.fieldSchema ?? []);
  }, [props.open, version]);

  const review = useAtelierReviewContractTemplateFields({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAtelierListContractTemplatesQueryKey() });
        toast({ title: "Fields confirmed", description: "Template is ready to use." });
        props.onClose();
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { message?: string; error?: string } } };
        toast({
          title: "Could not save fields",
          description: e.response?.data?.message ?? e.response?.data?.error ?? "Unexpected error",
          variant: "destructive",
        });
      },
    },
  });

  function setField(i: number, patch: Partial<AtelierContractTemplateField>) {
    setFields((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review detected fields — {props.template.name}</DialogTitle>
        </DialogHeader>
        {(version?.detectionWarnings?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            {version!.detectionWarnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}
        <div className="space-y-3">
          {fields.length === 0 && (
            <div className="text-sm text-text-faint">No fields detected.</div>
          )}
          {fields.map((f, i) => (
            <div
              key={i}
              className="rounded-md border border-border bg-bg-elevate/50 p-3 space-y-2"
              data-testid={`field-editor-${f.key}`}
            >
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-text-faint">Label</label>
                  <Input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
                </div>
                <div>
                  <label className="text-[11px] text-text-faint">Type</label>
                  <select
                    className={`${selectCls} w-full`}
                    value={f.dataType}
                    onChange={(e) =>
                      setField(i, { dataType: e.target.value as AtelierContractTemplateField["dataType"] })
                    }
                  >
                    {(["text", "date", "money", "number"] as const).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="text-[11px] text-text-faint font-mono truncate" title={f.placeholder}>
                Replaces: “{f.placeholder}”
              </div>
              <div className="flex items-center gap-4 text-xs text-text-mute">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => setField(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <span className="text-text-faint">
                  Auto-fill: <span className="font-mono">{f.autoFill || "none"}</span>
                </span>
                <button
                  className="ml-auto text-red-400 hover:text-red-300"
                  onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              review.mutate({ id: props.template.id, data: { fields } })
            }
            disabled={review.isPending}
            data-testid="button-confirm-fields"
          >
            {review.isPending ? "Saving…" : "Confirm fields"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  template,
  canManage,
  onReview,
  onNewVersion,
}: {
  template: AtelierContractTemplate;
  canManage: boolean;
  onReview: () => void;
  onNewVersion: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const patch = useAtelierUpdateContractTemplate({
    mutation: {
      onSuccess: () =>
        void qc.invalidateQueries({ queryKey: getAtelierListContractTemplatesQueryKey() }),
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { message?: string; error?: string } } };
        toast({
          title: "Update failed",
          description: e.response?.data?.message ?? e.response?.data?.error ?? "Unexpected error",
          variant: "destructive",
        });
      },
    },
  });
  const v = template.currentVersion;
  const needsReview = v?.fieldStatus === "detected";
  const statusTone =
    template.status === "active" ? "green" : template.status === "archived" ? "default" : "amber";
  return (
    <Card className="p-4" data-testid={`card-template-${template.id}`}>
      <div className="flex items-start gap-3">
        <FileText className="w-5 h-5 text-text-faint mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-text truncate">{template.name}</span>
            <MonoChip tone={statusTone as "green" | "amber" | "default"}>{template.status}</MonoChip>
            {needsReview && <MonoChip tone="amber">fields need review</MonoChip>}
          </div>
          <div className="text-[11px] text-text-faint mt-0.5">
            {CONTRACT_TYPE_LABELS[template.contractType] ?? template.contractType}
            {v ? ` · v${v.versionNumber} · ${v.fieldSchema.length} fields · ${v.fileName}` : " · no version"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={`${API_BASE}/contract-templates/${template.id}/download`}
            className="p-1.5 text-text-mute hover:text-gold"
            title="Download .docx"
            data-testid={`link-download-template-${template.id}`}
          >
            <Download className="w-4 h-4" />
          </a>
          {canManage && (
            <>
              <Button size="sm" variant="ghost" onClick={onReview} data-testid={`button-review-${template.id}`}>
                <Pencil className="w-3.5 h-3.5 mr-1" />
                Fields
              </Button>
              <Button size="sm" variant="ghost" onClick={onNewVersion}>
                <Upload className="w-3.5 h-3.5 mr-1" />
                New version
              </Button>
              {template.status !== "archived" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => patch.mutate({ id: template.id, data: { status: "archived" } })}
                >
                  Archive
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => patch.mutate({ id: template.id, data: { status: "active" } })}
                >
                  Restore
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function TemplatesSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useAtelierListContractTemplates();
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [versionFor, setVersionFor] = React.useState<AtelierContractTemplate | null>(null);
  const [reviewFor, setReviewFor] = React.useState<AtelierContractTemplate | null>(null);
  const templates = data?.templates ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-faint">
          Word templates the firm fills to produce contracts. Upload a .docx — the AI
          detects fill-in fields for your review.
        </p>
        {canManage && (
          <Button onClick={() => setUploadOpen(true)} data-testid="button-new-template">
            <Plus className="w-4 h-4 mr-1" />
            Upload template
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="text-sm text-text-faint">Loading…</div>
      ) : templates.length === 0 ? (
        <Card className="p-8 text-center text-sm text-text-faint" data-testid="text-templates-empty">
          No templates yet. Upload a Word document to get started.
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              canManage={canManage}
              onReview={() => setReviewFor(t)}
              onNewVersion={() => setVersionFor(t)}
            />
          ))}
        </div>
      )}
      <UploadTemplateDialog
        open={uploadOpen || !!versionFor}
        existing={versionFor}
        onClose={() => {
          setUploadOpen(false);
          setVersionFor(null);
        }}
        onUploaded={() =>
          void qc.invalidateQueries({ queryKey: getAtelierListContractTemplatesQueryKey() })
        }
      />
      {reviewFor && (
        <ReviewFieldsDialog open template={reviewFor} onClose={() => setReviewFor(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- contracts

export function NewContractDialog(props: {
  open: boolean;
  onClose: () => void;
  fixedCounterparty?: { kind: "person" | "contact" | "account"; id: string; label: string };
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: tData } = useAtelierListContractTemplates();
  const templates = (tData?.templates ?? []).filter(
    (t) => t.status === "active" && t.currentVersion?.fieldStatus === "reviewed",
  );
  const [templateId, setTemplateId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [cpKind, setCpKind] = React.useState<"person" | "contact" | "account">(
    props.fixedCounterparty?.kind ?? "contact",
  );
  const [cpId, setCpId] = React.useState(props.fixedCounterparty?.id ?? "");
  const [values, setValues] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (props.open) {
      setTemplateId("");
      setTitle("");
      setCpKind(props.fixedCounterparty?.kind ?? "contact");
      setCpId(props.fixedCounterparty?.id ?? "");
      setValues({});
    }
  }, [props.open, props.fixedCounterparty]);

  const selected = templates.find((t) => t.id === templateId);
  const fields = selected?.currentVersion?.fieldSchema ?? [];

  const create = useAtelierCreateContract({
    mutation: {
      onSuccess: (out) => {
        void qc.invalidateQueries({ queryKey: getAtelierListContractsQueryKey() });
        toast({ title: "Contract prepared", description: "Draft Word document generated." });
        props.onClose();
        navigate(`/contracts/${out.contract.id}`);
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { message?: string; error?: string } } };
        toast({
          title: "Could not prepare contract",
          description: e.response?.data?.message ?? e.response?.data?.error ?? "Unexpected error",
          variant: "destructive",
        });
      },
    },
  });

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prepare a contract</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-faint">Template</label>
            <select
              className={`${selectCls} w-full`}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              data-testid="select-contract-template"
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <p className="text-[11px] text-amber-400 mt-1">
                No active templates with confirmed fields. Upload and review one under
                Templates first.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-text-faint">Title (optional)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selected ? `${selected.name} — …` : ""}
              data-testid="input-contract-title"
            />
          </div>
          {props.fixedCounterparty ? (
            <div className="text-sm text-text-mute">
              Counterparty: <span className="text-text">{props.fixedCounterparty.label}</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-text-faint">Counterparty</label>
                <select
                  className={`${selectCls} w-full`}
                  value={cpKind}
                  onChange={(e) => setCpKind(e.target.value as typeof cpKind)}
                  data-testid="select-counterparty-kind"
                >
                  <option value="person">Team member</option>
                  <option value="contact">Client contact</option>
                  <option value="account">Account</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-text-faint">Counterparty ID</label>
                <Input
                  value={cpId}
                  onChange={(e) => setCpId(e.target.value)}
                  placeholder="Paste the record id"
                  data-testid="input-counterparty-id"
                />
                <p className="text-[10px] text-text-faint mt-0.5">
                  Tip: it’s usually easier to start from the person/contact/account page,
                  or ask the assistant to “prepare an NDA for …”.
                </p>
              </div>
            </div>
          )}
          {fields.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-text-faint">
                Field values (blank values are auto-filled from the CRM where possible)
              </div>
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="text-[11px] text-text-faint">
                    {f.label}
                    {f.required ? " *" : ""}
                    {f.autoFill && f.autoFill !== "none" ? (
                      <span className="ml-1 text-gold/70">(auto-fills)</span>
                    ) : null}
                  </label>
                  <Input
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.dataType === "date" ? "YYYY-MM-DD" : ""}
                    data-testid={`input-field-${f.key}`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              create.mutate({
                data: {
                  templateId,
                  ...(title.trim() ? { title: title.trim() } : {}),
                  counterparty: { kind: cpKind, id: cpId.trim() },
                  values: Object.fromEntries(
                    Object.entries(values).filter(([, v]) => v.trim() !== ""),
                  ),
                },
              })
            }
            disabled={create.isPending || !templateId || !cpId.trim()}
            data-testid="button-create-contract"
          >
            {create.isPending ? "Preparing…" : "Prepare contract"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useDebounced(value: string, ms: number): string {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ContractsSection({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = React.useState("");
  const [ctype, setCtype] = React.useState("");
  const [counterparty, setCounterparty] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const debouncedCounterparty = useDebounced(counterparty, 300);
  const { data, isLoading } = useAtelierListContracts({
    ...(status ? { status } : {}),
    ...(ctype ? { contractType: ctype } : {}),
    ...(debouncedCounterparty.trim() ? { counterparty: debouncedCounterparty.trim() } : {}),
    ...(owner ? { ownerUserId: owner } : {}),
  });
  const contracts: AtelierContract[] = data?.contracts ?? [];
  const owners = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contracts) if (!owner) m.set(c.ownerUserId, c.ownerLabel);
    return m;
  }, [contracts, owner]);
  const [ownerOptions, setOwnerOptions] = React.useState<Array<[string, string]>>([]);
  React.useEffect(() => {
    // Keep the owner dropdown stable while an owner filter is applied.
    if (!owner) setOwnerOptions(Array.from(owners.entries()));
  }, [owners, owner]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className={selectCls}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          data-testid="select-filter-status"
        >
          <option value="">All statuses</option>
          {Object.entries(CONTRACT_STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={ctype}
          onChange={(e) => setCtype(e.target.value)}
          data-testid="select-filter-type"
        >
          <option value="">All types</option>
          {CONTRACT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CONTRACT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          data-testid="select-filter-owner"
        >
          <option value="">All owners</option>
          {ownerOptions.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <input
          className={selectCls}
          placeholder="Counterparty…"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          data-testid="input-filter-counterparty"
        />
        {canManage && (
          <Button className="ml-auto" onClick={() => setNewOpen(true)} data-testid="button-new-contract">
            <Plus className="w-4 h-4 mr-1" />
            New contract
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="text-sm text-text-faint">Loading…</div>
      ) : contracts.length === 0 ? (
        <Card className="p-8 text-center text-sm text-text-faint" data-testid="text-contracts-empty">
          No contracts match.
        </Card>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => (
            <ContractRow key={c.id} c={c} />
          ))}
        </div>
      )}
      <NewContractDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

// ------------------------------------------------------------------- shell

export default function ContractsHome() {
  const [isTemplates] = useRoute("/contracts/templates");
  const { data: me } = useAtelierGetMe();
  const canManage = me?.role === "founding_partner" || me?.role === "partner";

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-6 space-y-6">
      <LensPageHeader
        eyebrow="Firm · Contracts"
        headline="Contracts"
        lede="Prepare, redline, and sign the firm’s contracts — NDAs, MoUs, employment and partnership agreements."
      />
      <TabNav>
        <TabNavLink href="/contracts" active={!isTemplates} data-testid="tab-contracts">
          Contracts
        </TabNavLink>
        {canManage && (
          <TabNavLink href="/contracts/templates" active={!!isTemplates} data-testid="tab-templates">
            Templates
          </TabNavLink>
        )}
      </TabNav>
      {isTemplates && canManage ? (
        <TemplatesSection canManage={canManage} />
      ) : (
        <ContractsSection canManage={canManage} />
      )}
    </div>
  );
}
