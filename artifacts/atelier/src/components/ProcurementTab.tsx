// Task #722 — Procurement registration section on the account page.
// Shows the human-tracked registration status (editable, audited), the
// Procurement Navigator's approved guide (channel/portal, responsible
// contact, step-by-step registration guide, required info & documents,
// fees/timelines/renewal, source links) and the run/refresh + review flow
// (draft → approve / dismiss), following the account-agent conventions.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAtelierUpdateAccountProcurement,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierAccountProcurement,
  type AtelierProcurementGuide,
} from "@workspace/api-client-react";
import {
  Landmark,
  RefreshCw,
  Link2,
  FileText,
  ListChecks,
  Building2,
  Clock,
  BadgeCheck,
  AlertTriangle,
  PenLine,
  Check,
  X,
} from "lucide-react";

type NavigatorStatus = {
  status: "idle" | "running" | "drafted" | "failed";
  phase: string | null;
  progressPct: number | null;
  runId: string | null;
  draft: { guide: AtelierProcurementGuide; rationale: string } | null;
  procurement: AtelierAccountProcurement | null;
};

const STATUS_META: Record<
  string,
  { label: string; tone: string }
> = {
  not_registered: {
    label: "Not registered",
    tone: "text-white/60 border-white/15 bg-white/5",
  },
  in_progress: {
    label: "In progress",
    tone: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  },
  registered: {
    label: "Registered",
    tone: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  },
  renewal_due: {
    label: "Renewal due",
    tone: "text-red-300 border-red-400/30 bg-red-400/10",
  },
};

const base = () => import.meta.env.BASE_URL as string;

async function navFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}api/atelier${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as {
      error?: string;
      reason?: string;
    };
    throw new Error(detail.reason ?? detail.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center gap-2 mb-3 text-white/80">
        {icon}
        <h3 className="text-sm font-semibold tracking-wide">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function SourceLinks({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <span className="inline-flex items-center gap-1.5 ml-1 align-middle">
      {urls.map((u, i) => (
        <a
          key={u + i}
          href={u}
          target="_blank"
          rel="noreferrer"
          title={u}
          className="text-sky-300/80 hover:text-sky-200"
        >
          <Link2 className="w-3 h-3 inline" />
        </a>
      ))}
    </span>
  );
}

function GuideView({ guide }: { guide: AtelierProcurementGuide }) {
  const contact = guide.responsibleContact ?? null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-white/70 leading-relaxed">{guide.summary}</p>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Channel & portal" icon={<Landmark className="w-4 h-4" />}>
          <div className="text-sm text-white/80 font-medium">{guide.channel.name}</div>
          <div className="text-xs text-white/50 mt-0.5 capitalize">
            {guide.channel.type.replace(/_/g, " ")}
          </div>
          {guide.channel.portalUrl && (
            <a
              href={guide.channel.portalUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200"
            >
              <Link2 className="w-3.5 h-3.5" /> {guide.channel.portalUrl}
            </a>
          )}
        </Card>
        <Card title="Responsible contact" icon={<Building2 className="w-4 h-4" />}>
          {contact && (contact.department || contact.title || contact.email || contact.phone || contact.notes) ? (
            <div className="text-sm text-white/70 space-y-1">
              {contact.department && <div>{contact.department}</div>}
              {contact.title && <div className="text-white/50 text-xs">{contact.title}</div>}
              {contact.email && (
                <div className="text-xs">
                  <a href={`mailto:${contact.email}`} className="text-sky-300 hover:text-sky-200">
                    {contact.email}
                  </a>
                </div>
              )}
              {contact.phone && <div className="text-xs text-white/50">{contact.phone}</div>}
              {contact.notes && <div className="text-xs text-white/50">{contact.notes}</div>}
            </div>
          ) : (
            <div className="text-xs text-white/40">
              No published registration contact — use the portal channel.
            </div>
          )}
        </Card>
      </div>

      <Card title="Registration steps" icon={<ListChecks className="w-4 h-4" />}>
        <ol className="space-y-3">
          {[...guide.steps]
            .sort((a, b) => a.order - b.order)
            .map((s) => (
              <li key={s.order + s.title} className="flex gap-3">
                <span className="flex-none w-6 h-6 rounded-full border border-white/15 bg-white/5 text-xs text-white/60 flex items-center justify-center mt-0.5">
                  {s.order}
                </span>
                <div>
                  <div className="text-sm text-white/80 font-medium">
                    {s.title}
                    <SourceLinks urls={s.sourceUrls ?? []} />
                  </div>
                  <div className="text-xs text-white/50 leading-relaxed mt-0.5">{s.detail}</div>
                </div>
              </li>
            ))}
        </ol>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Required company information" icon={<FileText className="w-4 h-4" />}>
          <ul className="space-y-1.5">
            {guide.requiredInformation.map((r, i) => (
              <li key={i} className="text-xs text-white/60 flex gap-2">
                <span className="text-white/30 flex-none">•</span> {r}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Required documents" icon={<FileText className="w-4 h-4" />}>
          <ul className="space-y-1.5">
            {guide.requiredDocuments.map((r, i) => (
              <li key={i} className="text-xs text-white/60 flex gap-2">
                <span className="text-white/30 flex-none">•</span> {r}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {(guide.fees || guide.timeline || guide.renewal) && (
        <Card title="Fees, timeline & renewal" icon={<Clock className="w-4 h-4" />}>
          <dl className="grid md:grid-cols-3 gap-4 text-xs">
            {guide.fees && (
              <div>
                <dt className="text-white/40 uppercase tracking-wider mb-1">Fees</dt>
                <dd className="text-white/70 leading-relaxed">{guide.fees}</dd>
              </div>
            )}
            {guide.timeline && (
              <div>
                <dt className="text-white/40 uppercase tracking-wider mb-1">Timeline</dt>
                <dd className="text-white/70 leading-relaxed">{guide.timeline}</dd>
              </div>
            )}
            {guide.renewal && (
              <div>
                <dt className="text-white/40 uppercase tracking-wider mb-1">Renewal</dt>
                <dd className="text-white/70 leading-relaxed">{guide.renewal}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      <Card title="Sources" icon={<Link2 className="w-4 h-4" />}>
        <ul className="space-y-1.5">
          {guide.sources.map((s, i) => (
            <li key={s.url + i} className="text-xs truncate">
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-300/90 hover:text-sky-200"
              >
                {s.title || s.url}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function ProcurementTab({
  accountId,
  procurement,
  canEdit,
}: {
  accountId: string;
  procurement: AtelierAccountProcurement | null;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [statusDraft, setStatusDraft] = useState<string>("not_registered");
  const [notesDraft, setNotesDraft] = useState("");

  const statusQuery = useQuery({
    queryKey: ["procurement-navigator-status", accountId],
    queryFn: () =>
      navFetch<NavigatorStatus>(`/accounts/${accountId}/agents/procurement-navigator/status`),
    refetchInterval: (q) =>
      (q.state.data as NavigatorStatus | undefined)?.status === "running" ? 4000 : false,
  });
  const nav = statusQuery.data ?? null;
  const running = nav?.status === "running";

  // Prefer the freshest procurement payload (the poll returns it too).
  const p = nav?.procurement ?? procurement;
  const guide = p?.guide ?? null;
  const statusKey = p?.status ?? "not_registered";
  const meta = STATUS_META[statusKey] ?? STATUS_META.not_registered;

  useEffect(() => {
    if (editing) {
      setStatusDraft(statusKey);
      setNotesDraft(p?.statusNotes ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const patchMut = useAtelierUpdateAccountProcurement({
    mutation: {
      onSuccess: () => {
        setEditing(false);
        qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });
        qc.invalidateQueries({ queryKey: ["procurement-navigator-status", accountId] });
      },
      onError: (e: unknown) => setError(e instanceof Error ? e.message : "Update failed"),
    },
  });

  const act = async (action: "run" | "approve" | "dismiss", body?: Record<string, unknown>) => {
    setBusy(action);
    setError(null);
    try {
      await navFetch(`/accounts/${accountId}/agents/procurement-navigator/${action}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      await qc.invalidateQueries({ queryKey: ["procurement-navigator-status", accountId] });
      if (action === "approve") {
        await qc.invalidateQueries({
          queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };

  const lastResearched = useMemo(() => {
    if (!p?.lastResearchedAt) return null;
    try {
      return new Date(p.lastResearchedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return null;
    }
  }, [p?.lastResearchedAt]);

  return (
    <div className="space-y-5" data-testid="procurement-tab">
      {/* ---- status tracker ---- */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-white/90">
                Vendor registration
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.tone}`}
                data-testid="procurement-status-badge"
              >
                {statusKey === "registered" ? (
                  <BadgeCheck className="w-3.5 h-3.5" />
                ) : statusKey === "renewal_due" ? (
                  <AlertTriangle className="w-3.5 h-3.5" />
                ) : null}
                {meta.label}
              </span>
            </div>
            <p className="text-xs text-white/50 mt-1">
              How Cognirise gets registered as a supplier in this account's procurement
              system{lastResearched ? ` · last researched ${lastResearched}` : ""}.
            </p>
            {p?.statusNotes && !editing && (
              <p className="text-xs text-white/60 mt-2 whitespace-pre-wrap">{p.statusNotes}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
                data-testid="button-edit-procurement-status"
              >
                <PenLine className="w-3.5 h-3.5" /> Update status
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => act("run")}
                disabled={running || busy === "run"}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-400/20 disabled:opacity-50"
                data-testid="button-run-procurement-navigator"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${running ? "animate-spin" : ""}`} />
                {running ? "Researching…" : guide ? "Refresh research" : "Run research"}
              </button>
            )}
          </div>
        </div>

        {editing && (
          <div className="mt-4 border-t border-white/10 pt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATUS_META).map(([k, m]) => (
                <button
                  key={k}
                  onClick={() => setStatusDraft(k)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    statusDraft === k ? m.tone : "text-white/40 border-white/10"
                  }`}
                  data-testid={`option-procurement-status-${k}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder='Tracking notes, e.g. "Submitted on Etimad 12 Jun — awaiting approval"'
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 placeholder:text-white/30 focus:outline-none focus:border-sky-400/40"
              data-testid="input-procurement-notes"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  patchMut.mutate({
                    accountId,
                    data: {
                      status: statusDraft as AtelierAccountProcurement["status"],
                      statusNotes: notesDraft.trim() || null,
                    },
                  })
                }
                disabled={patchMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/80 px-3 py-1.5 text-xs text-white hover:bg-sky-500 disabled:opacity-50"
                data-testid="button-save-procurement-status"
              >
                <Check className="w-3.5 h-3.5" /> Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-2.5 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* ---- run in progress ---- */}
      {running && (
        <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-4 flex items-center gap-3">
          <RefreshCw className="w-4 h-4 text-sky-300 animate-spin flex-none" />
          <div>
            <div className="text-sm text-sky-200">Procurement Navigator is researching…</div>
            <div className="text-xs text-white/50 mt-0.5">
              {nav?.phase ?? "Identifying the procurement channel"}
              {typeof nav?.progressPct === "number" ? ` · ${nav.progressPct}%` : ""}
            </div>
          </div>
        </div>
      )}

      {nav?.status === "failed" && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4">
          <div className="text-sm text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Research run failed
          </div>
          <div className="text-xs text-white/50 mt-1">{nav.phase}</div>
        </div>
      )}

      {/* ---- pending draft review ---- */}
      {nav?.status === "drafted" && nav.draft && (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-5" data-testid="procurement-draft-review">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-sm font-semibold text-amber-200">
                New research ready for review
              </div>
              <div className="text-xs text-white/50 mt-0.5">
                {nav.draft.rationale}
              </div>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => act("approve", { runId: nav.runId })}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/80 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
                  data-testid="button-approve-procurement-draft"
                >
                  <Check className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  onClick={() => act("dismiss", { runId: nav.runId })}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5 disabled:opacity-50"
                  data-testid="button-dismiss-procurement-draft"
                >
                  <X className="w-3.5 h-3.5" /> Dismiss
                </button>
              </div>
            )}
          </div>
          <GuideView guide={nav.draft.guide} />
        </div>
      )}

      {/* ---- approved guide ---- */}
      {guide && nav?.status !== "drafted" && <GuideView guide={guide} />}

      {!guide && !running && nav?.status !== "drafted" && nav?.status !== "failed" && (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
          <Landmark className="w-6 h-6 text-white/25 mx-auto mb-3" />
          <div className="text-sm text-white/60">No procurement research yet</div>
          <div className="text-xs text-white/40 mt-1 max-w-md mx-auto">
            Run the Procurement Navigator to research how Cognirise gets registered as a
            vendor with this account — the channel, steps, documents, fees and timelines.
          </div>
        </div>
      )}
    </div>
  );
}
