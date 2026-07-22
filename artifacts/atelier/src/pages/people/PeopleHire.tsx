import * as React from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListHireRoles,
  useAtelierCreateHireRole,
  useAtelierUpdateHireRole,
  useAtelierListHireCandidates,
  useAtelierCreateHireCandidate,
  useAtelierUpdateHireCandidate,
  useAtelierListCandidateDocuments,
  useAtelierUploadCandidateDocument,
  useAtelierListHireInterviews,
  useAtelierCreateHireInterview,
  useAtelierUpdateHireInterview,
  useAtelierListHireOffers,
  useAtelierCreateHireOffer,
  useAtelierUpdateHireOffer,
  getAtelierListHireRolesQueryKey,
  getAtelierListHireCandidatesQueryKey,
  getAtelierListCandidateDocumentsQueryKey,
  getAtelierListHireInterviewsQueryKey,
  getAtelierListHireOffersQueryKey,
} from "@workspace/api-client-react";
import type {
  AtelierHireRole,
  AtelierHireCandidate,
  AtelierHireInterview,
  AtelierHireOffer,
} from "@workspace/api-client-react";
import { TabNav, TabNavLink, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { useToast } from "@/hooks/use-toast";
import { useReferenceChecks } from "@/lib/v5-hooks";
import { formatPhoneDisplay } from "@/lib/phone-format";
import { PeopleShell } from "./PeopleShell";

const SUBS = [
  { id: "roles",       label: "Open Roles" },
  { id: "candidates",  label: "Candidates" },
  { id: "interviews",  label: "Interviews" },
  { id: "references",  label: "References" },
  { id: "offers",      label: "Offers" },
];

const inputCls =
  "w-full rounded border border-border bg-bg-elevate px-3 py-2 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold";
const smallBtnCls =
  "font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text disabled:opacity-50";
const goldBtnCls =
  "font-mono text-[10px] uppercase tracking-wider text-gold/80 hover:text-gold disabled:opacity-50";

function errMsg(err: unknown, fallback: string): string {
  return (err as { data?: { message?: string } })?.data?.message ?? fallback;
}

export default function PeopleHire() {
  const [, params] = useRoute("/people/hire/:section");
  const section = params?.section ?? "roles";

  return (
    <PeopleShell stage="hire">
      <LensPageHeader
        headline="Hiring — positions, candidates, interviews, offers"
        lede="Open a position, add candidates and their CVs, schedule interview panels and record feedback, then send the offer. An accepted offer hands off straight to onboarding."
      />
      <div className="container-atelier py-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/hire/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-8">
          {section === "roles" && <RolesView />}
          {section === "candidates" && <CandidatesView />}
          {section === "interviews" && <InterviewsView />}
          {section === "references" && <ReferencesView />}
          {section === "offers" && <OffersView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function AccessNote() {
  return (
    <Card className="p-4 text-sm text-text-mute" data-testid="hire-access-note">
      Hiring is managed by HR and the partners. Ask them if you need something
      from a candidate file.
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Open roles
// ---------------------------------------------------------------------------

function RolesView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useAtelierListHireRoles();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListHireRolesQueryKey() });

  const [showForm, setShowForm] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [level, setLevel] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [targetStart, setTargetStart] = React.useState("");
  const [urgency, setUrgency] = React.useState<"low" | "medium" | "high">("medium");
  const [summary, setSummary] = React.useState("");

  const create = useAtelierCreateHireRole({
    mutation: {
      onSuccess: (r) => {
        invalidate();
        setShowForm(false);
        setTitle(""); setLevel(""); setLocation(""); setTargetStart(""); setSummary(""); setUrgency("medium");
        toast({ title: "Position opened", description: `${r.title} is now open.` });
      },
      onError: (err: unknown) =>
        toast({ title: "Could not open the position", description: errMsg(err, "Check the fields and try again."), variant: "destructive" }),
    },
  });
  const update = useAtelierUpdateHireRole({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (err: unknown) =>
        toast({ title: "Could not update the position", description: errMsg(err, "Try again."), variant: "destructive" }),
    },
  });

  const [editingId, setEditingId] = React.useState<string | null>(null);

  if (error) return <AccessNote />;

  const roles = data?.items ?? [];
  return (
    <div className="space-y-4" data-testid="hire-roles-view">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-mute">
          {isLoading ? "Loading…" : `${roles.filter((r) => r.status === "open").length} open position(s)`}
        </p>
        <PillButton onClick={() => setShowForm((v) => !v)} data-testid="role-form-toggle">
          {showForm ? "Cancel" : "Open a position"}
        </PillButton>
      </div>

      {showForm ? (
        <Card className="p-4">
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim() || !level.trim() || !location.trim()) return;
              create.mutate({
                data: {
                  title: title.trim(),
                  level: level.trim(),
                  location: location.trim(),
                  targetStart: targetStart.trim() || undefined,
                  urgency,
                  summary: summary.trim() || undefined,
                },
              });
            }}
          >
            <input className={inputCls} placeholder="Title (e.g. Senior Consultant)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="role-title" />
            <input className={inputCls} placeholder="Level (e.g. Senior)" value={level} onChange={(e) => setLevel(e.target.value)} data-testid="role-level" />
            <input className={inputCls} placeholder="Location (e.g. Dubai)" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="role-location" />
            <input className={inputCls} placeholder="Target start (e.g. 2026-09)" value={targetStart} onChange={(e) => setTargetStart(e.target.value)} data-testid="role-target-start" />
            <select className={inputCls} value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)} data-testid="role-urgency">
              <option value="low">Low urgency</option>
              <option value="medium">Medium urgency</option>
              <option value="high">High urgency</option>
            </select>
            <textarea className={`${inputCls} md:col-span-2`} rows={2} placeholder="Short summary of the role (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} data-testid="role-summary" />
            <div className="md:col-span-2">
              <PillButton type="submit" disabled={create.isPending || !title.trim() || !level.trim() || !location.trim()} data-testid="role-submit">
                {create.isPending ? "Opening…" : "Open position"}
              </PillButton>
            </div>
          </form>
        </Card>
      ) : null}

      {!isLoading && roles.length === 0 ? (
        <Card className="p-6 text-sm text-text-mute" data-testid="roles-empty">
          No positions yet. Open one to start tracking candidates against it.
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map((r: AtelierHireRole) => (
            <Card key={r.id} className="p-4 space-y-2" data-testid={`role-card-${r.id}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text">{r.title}</div>
                  <div className="text-xs text-text-faint">
                    {r.level} · {r.location}{r.targetStart ? ` · target start ${r.targetStart}` : ""}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <MonoChip tone={r.status === "open" ? "green" : r.status === "filled" ? "gold" : "default"}>{r.status}</MonoChip>
                  <MonoChip tone={r.urgency === "high" ? "red" : r.urgency === "medium" ? "amber" : "default"}>{r.urgency} urgency</MonoChip>
                </div>
              </div>
              {r.summary ? <div className="text-sm text-text-mute">{r.summary}</div> : null}
              <div className="flex items-center justify-between">
                <MonoChip>{r.activeCandidates} active candidate(s)</MonoChip>
                <div className="flex gap-3">
                  <button className={smallBtnCls} onClick={() => setEditingId(editingId === r.id ? null : r.id)} data-testid={`role-edit-toggle-${r.id}`}>
                    {editingId === r.id ? "Discard" : "Edit"}
                  </button>
                  {r.status === "open" ? (
                    <>
                      <button className={goldBtnCls} disabled={update.isPending} onClick={() => update.mutate({ id: r.id, data: { status: "filled" } })} data-testid={`role-fill-${r.id}`}>
                        Mark filled
                      </button>
                      <button className={smallBtnCls} disabled={update.isPending} onClick={() => update.mutate({ id: r.id, data: { status: "closed" } })} data-testid={`role-close-${r.id}`}>
                        Close
                      </button>
                    </>
                  ) : (
                    <button className={smallBtnCls} disabled={update.isPending} onClick={() => update.mutate({ id: r.id, data: { status: "open" } })} data-testid={`role-reopen-${r.id}`}>
                      Reopen
                    </button>
                  )}
                </div>
              </div>
              {editingId === r.id ? (
                <RoleEditForm
                  role={r}
                  pending={update.isPending}
                  onSave={(patch) => update.mutate({ id: r.id, data: patch }, { onSuccess: () => setEditingId(null) })}
                />
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RoleEditForm({
  role,
  pending,
  onSave,
}: {
  role: AtelierHireRole;
  pending: boolean;
  onSave: (patch: {
    title: string;
    level: string;
    location: string;
    targetStart?: string;
    urgency: "low" | "medium" | "high";
    summary?: string;
  }) => void;
}) {
  const [title, setTitle] = React.useState(role.title);
  const [level, setLevel] = React.useState(role.level);
  const [location, setLocation] = React.useState(role.location);
  const [targetStart, setTargetStart] = React.useState(role.targetStart ?? "");
  const [urgency, setUrgency] = React.useState<"low" | "medium" | "high">(role.urgency);
  const [summary, setSummary] = React.useState(role.summary ?? "");

  return (
    <form
      className="grid gap-3 md:grid-cols-2 border-t border-border pt-3 mt-1"
      data-testid={`role-edit-form-${role.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !level.trim() || !location.trim()) return;
        onSave({
          title: title.trim(),
          level: level.trim(),
          location: location.trim(),
          targetStart: targetStart.trim() || undefined,
          urgency,
          summary: summary.trim() || undefined,
        });
      }}
    >
      <input className={inputCls} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid={`role-edit-title-${role.id}`} />
      <input className={inputCls} placeholder="Level" value={level} onChange={(e) => setLevel(e.target.value)} data-testid={`role-edit-level-${role.id}`} />
      <input className={inputCls} placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} data-testid={`role-edit-location-${role.id}`} />
      <input className={inputCls} placeholder="Target start (e.g. 2026-09)" value={targetStart} onChange={(e) => setTargetStart(e.target.value)} />
      <select className={inputCls} value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)}>
        <option value="low">Low urgency</option>
        <option value="medium">Medium urgency</option>
        <option value="high">High urgency</option>
      </select>
      <textarea className={`${inputCls} md:col-span-2`} rows={2} placeholder="Short summary (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} />
      <div className="md:col-span-2">
        <PillButton type="submit" disabled={pending || !title.trim() || !level.trim() || !location.trim()} data-testid={`role-edit-save-${role.id}`}>
          {pending ? "Saving…" : "Save changes"}
        </PillButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

const CANDIDATE_STAGES = ["sourced", "screening", "interview", "reference", "offer"] as const;

const CANDIDATE_SOURCES = [
  "referral",
  "linkedin",
  "agency",
  "inbound",
  "job_board",
  "networking",
  "other",
] as const;

function CandidatesView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useAtelierListHireCandidates();
  const { data: rolesData } = useAtelierListHireRoles();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListHireCandidatesQueryKey() });
    void qc.invalidateQueries({ queryKey: getAtelierListHireRolesQueryKey() });
  };

  const [showForm, setShowForm] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [roleId, setRoleId] = React.useState("");
  const [source, setSource] = React.useState("");
  const [currentRole, setCurrentRole] = React.useState("");
  const [currentEmployer, setCurrentEmployer] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const create = useAtelierCreateHireCandidate({
    mutation: {
      onSuccess: (c) => {
        invalidate();
        setShowForm(false);
        setName(""); setEmail(""); setPhone(""); setRoleId(""); setSource(""); setCurrentRole(""); setCurrentEmployer(""); setNotes("");
        toast({ title: "Candidate added", description: `${c.name} is in the pipeline.` });
      },
      onError: (err: unknown) =>
        toast({ title: "Could not add the candidate", description: errMsg(err, "Check the fields and try again."), variant: "destructive" }),
    },
  });
  const update = useAtelierUpdateHireCandidate({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (err: unknown) =>
        toast({ title: "Could not update the candidate", description: errMsg(err, "Try again."), variant: "destructive" }),
    },
  });

  if (error) return <AccessNote />;

  const candidates = data?.items ?? [];
  const openRoles = (rolesData?.items ?? []).filter((r) => r.status === "open");
  const live = candidates.filter((c) => c.stage !== "hired" && c.stage !== "rejected");

  return (
    <div className="space-y-4" data-testid="hire-candidates-view">
      <div className="grid gap-3 md:grid-cols-5">
        {CANDIDATE_STAGES.map((st) => (
          <Card key={st} className="p-3">
            <div className="text-xs text-text-faint capitalize">{st}</div>
            <div className="text-2xl font-mono text-text mt-1">{live.filter((c) => c.stage === st).length}</div>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-text-mute">{isLoading ? "Loading…" : `${live.length} candidate(s) in the pipeline`}</p>
        <PillButton onClick={() => setShowForm((v) => !v)} data-testid="candidate-form-toggle">
          {showForm ? "Cancel" : "Add candidate"}
        </PillButton>
      </div>

      {showForm ? (
        <Card className="p-4">
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              create.mutate({
                data: {
                  name: name.trim(),
                  email: email.trim() || undefined,
                  phone: phone.trim() || undefined,
                  roleId: roleId || undefined,
                  source: source.trim() || undefined,
                  currentRole: currentRole.trim() || undefined,
                  currentEmployer: currentEmployer.trim() || undefined,
                  notes: notes.trim() || undefined,
                },
              });
            }}
          >
            <input className={inputCls} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} data-testid="candidate-name" />
            <input className={inputCls} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="candidate-email" />
            <input className={inputCls} placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="candidate-phone" />
            <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)} data-testid="candidate-role">
              <option value="">No position yet</option>
              {openRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.title} — {r.level}</option>
              ))}
            </select>
            <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} data-testid="candidate-source">
              <option value="">Source…</option>
              {CANDIDATE_SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input className={inputCls} placeholder="Current role (optional)" value={currentRole} onChange={(e) => setCurrentRole(e.target.value)} />
            <input className={inputCls} placeholder="Current employer (optional)" value={currentEmployer} onChange={(e) => setCurrentEmployer(e.target.value)} />
            <textarea className={`${inputCls} md:col-span-2`} rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="md:col-span-2">
              <PillButton type="submit" disabled={create.isPending || !name.trim()} data-testid="candidate-submit">
                {create.isPending ? "Adding…" : "Add candidate"}
              </PillButton>
            </div>
          </form>
        </Card>
      ) : null}

      {!isLoading && candidates.length === 0 ? (
        <Card className="p-6 text-sm text-text-mute" data-testid="candidates-empty">
          No candidates yet. Add one to start the pipeline.
        </Card>
      ) : (
        <div className="space-y-2">
          {candidates.map((c: AtelierHireCandidate) => (
            <Card key={c.id} className="p-4" data-testid={`candidate-card-${c.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-text">{c.name}</div>
                  <div className="text-xs text-text-faint mt-1">
                    {[c.currentRole, c.currentEmployer].filter(Boolean).join(" · ")}
                    {c.source ? `${c.currentRole || c.currentEmployer ? " · " : ""}via ${c.source}` : ""}
                  </div>
                  <div className="text-xs text-text-faint mt-0.5">
                    {[c.email, c.phone ? formatPhoneDisplay(c.phone) : null].filter(Boolean).join(" · ")}
                  </div>
                  {c.roleTitle ? (
                    <div className="text-sm text-text-mute mt-1">For position: <span className="text-gold">{c.roleTitle}</span></div>
                  ) : null}
                  {c.notes ? <div className="text-xs text-text-mute mt-1">{c.notes}</div> : null}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <MonoChip tone={c.stage === "hired" ? "gold" : c.stage === "rejected" ? "red" : "green"}>{c.stage}</MonoChip>
                  <select
                    className="rounded border border-border bg-bg-elevate px-2 py-1 text-xs text-text"
                    value={c.stage}
                    onChange={(e) => update.mutate({ id: c.id, data: { stage: e.target.value as never } })}
                    disabled={update.isPending}
                    data-testid={`candidate-stage-${c.id}`}
                  >
                    {[...CANDIDATE_STAGES, "hired", "rejected"].map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                  <button className={smallBtnCls} onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} data-testid={`candidate-docs-toggle-${c.id}`}>
                    {expandedId === c.id ? "Hide files" : "Files / CV"}
                  </button>
                  <button className={smallBtnCls} onClick={() => setEditingId(editingId === c.id ? null : c.id)} data-testid={`candidate-edit-toggle-${c.id}`}>
                    {editingId === c.id ? "Discard" : "Edit"}
                  </button>
                </div>
              </div>
              {editingId === c.id ? (
                <CandidateEditForm
                  candidate={c}
                  openRoles={openRoles}
                  pending={update.isPending}
                  onSave={(patch) => update.mutate({ id: c.id, data: patch }, { onSuccess: () => setEditingId(null) })}
                />
              ) : null}
              {expandedId === c.id ? <CandidateDocuments candidateId={c.id} /> : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateEditForm({
  candidate,
  openRoles,
  pending,
  onSave,
}: {
  candidate: AtelierHireCandidate;
  openRoles: AtelierHireRole[];
  pending: boolean;
  onSave: (patch: {
    name: string;
    email?: string;
    phone?: string;
    roleId?: string | null;
    source?: string;
    currentRole?: string;
    currentEmployer?: string;
    notes?: string;
  }) => void;
}) {
  const [name, setName] = React.useState(candidate.name);
  const [email, setEmail] = React.useState(candidate.email ?? "");
  const [phone, setPhone] = React.useState(candidate.phone ?? "");
  const [roleId, setRoleId] = React.useState(candidate.roleId ?? "");
  const [source, setSource] = React.useState(candidate.source ?? "");
  const [currentRole, setCurrentRole] = React.useState(candidate.currentRole ?? "");
  const [currentEmployer, setCurrentEmployer] = React.useState(candidate.currentEmployer ?? "");
  const [notes, setNotes] = React.useState(candidate.notes ?? "");

  const roleOptions = React.useMemo(() => {
    // Keep the candidate's current role selectable even if it is no longer open.
    if (candidate.roleId && !openRoles.some((r) => r.id === candidate.roleId)) {
      return [
        { id: candidate.roleId, title: candidate.roleTitle || "Current position", level: "" },
        ...openRoles,
      ];
    }
    return openRoles;
  }, [candidate.roleId, candidate.roleTitle, openRoles]);

  return (
    <form
      className="grid gap-3 md:grid-cols-2 border-t border-border pt-3 mt-3"
      data-testid={`candidate-edit-form-${candidate.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          roleId: roleId || null,
          source: source.trim(),
          currentRole: currentRole.trim(),
          currentEmployer: currentEmployer.trim(),
          notes: notes.trim(),
        });
      }}
    >
      <input className={inputCls} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} data-testid={`candidate-edit-name-${candidate.id}`} />
      <input className={inputCls} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid={`candidate-edit-email-${candidate.id}`} />
      <input className={inputCls} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)} data-testid={`candidate-edit-role-${candidate.id}`}>
        <option value="">No position</option>
        {roleOptions.map((r) => (
          <option key={r.id} value={r.id}>{r.title}{r.level ? ` — ${r.level}` : ""}</option>
        ))}
      </select>
      <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
        <option value="">Source…</option>
        {CANDIDATE_SOURCES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <input className={inputCls} placeholder="Current role" value={currentRole} onChange={(e) => setCurrentRole(e.target.value)} />
      <input className={inputCls} placeholder="Current employer" value={currentEmployer} onChange={(e) => setCurrentEmployer(e.target.value)} />
      <textarea className={`${inputCls} md:col-span-2`} rows={2} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="md:col-span-2">
        <PillButton type="submit" disabled={pending || !name.trim()} data-testid={`candidate-edit-save-${candidate.id}`}>
          {pending ? "Saving…" : "Save changes"}
        </PillButton>
      </div>
    </form>
  );
}

function CandidateDocuments({ candidateId }: { candidateId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useAtelierListCandidateDocuments(candidateId);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [kind, setKind] = React.useState<"cv" | "cover_letter" | "portfolio" | "other">("cv");

  const upload = useAtelierUploadCandidateDocument({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAtelierListCandidateDocumentsQueryKey(candidateId) });
        if (fileRef.current) fileRef.current.value = "";
        toast({ title: "File uploaded" });
      },
      onError: (err: unknown) =>
        toast({ title: "Upload failed", description: errMsg(err, "Upload a PDF, Word document or image."), variant: "destructive" }),
    },
  });

  const base = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");
  const docs = data?.documents ?? [];

  return (
    <div className="mt-3 rounded border border-border bg-bg-elevate/50 p-3 space-y-2" data-testid={`candidate-docs-${candidateId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded border border-border bg-bg-elevate px-2 py-1 text-xs text-text" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="cv">CV</option>
          <option value="cover_letter">Cover letter</option>
          <option value="portfolio">Portfolio</option>
          <option value="other">Other</option>
        </select>
        <input ref={fileRef} type="file" accept=".pdf,.docx,image/jpeg,image/png,image/webp" className="text-xs text-text-mute" data-testid={`candidate-file-input-${candidateId}`} />
        <button
          className={goldBtnCls}
          disabled={upload.isPending}
          onClick={() => {
            const file = fileRef.current?.files?.[0];
            if (!file) {
              toast({ title: "Pick a file first", variant: "destructive" });
              return;
            }
            upload.mutate({ id: candidateId, data: { file, kind } });
          }}
          data-testid={`candidate-file-upload-${candidateId}`}
        >
          {upload.isPending ? "Uploading…" : "Upload"}
        </button>
      </div>
      {isLoading ? (
        <p className="text-xs text-text-faint">Loading files…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-text-mute">No files yet. Upload the CV as a PDF, Word document or image.</p>
      ) : (
        <ul className="divide-y divide-border-soft">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-text truncate">
                {d.title} <span className="text-text-faint">· {d.kind}{d.sizeBytes ? ` · ${Math.max(1, Math.round(d.sizeBytes / 1024))} KB` : ""}</span>
              </span>
              <a
                className={goldBtnCls}
                href={`${base}/api/atelier/hire/candidates/${candidateId}/documents/${d.id}/download`}
                data-testid={`candidate-doc-download-${d.id}`}
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

type StageDraft = { stage: string; interviewer: string; durationMin: number; focus: string };

function InterviewsView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useAtelierListHireInterviews();
  const { data: candData } = useAtelierListHireCandidates();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListHireInterviewsQueryKey() });

  const [showForm, setShowForm] = React.useState(false);
  const [candidateId, setCandidateId] = React.useState("");
  const [scheduledFor, setScheduledFor] = React.useState("");
  const [stages, setStages] = React.useState<StageDraft[]>([
    { stage: "Screen", interviewer: "", durationMin: 30, focus: "" },
  ]);

  const create = useAtelierCreateHireInterview({
    mutation: {
      onSuccess: () => {
        invalidate();
        setShowForm(false);
        setCandidateId(""); setScheduledFor("");
        setStages([{ stage: "Screen", interviewer: "", durationMin: 30, focus: "" }]);
        toast({ title: "Interview scheduled" });
      },
      onError: (err: unknown) =>
        toast({ title: "Could not schedule", description: errMsg(err, "Check the fields and try again."), variant: "destructive" }),
    },
  });
  const update = useAtelierUpdateHireInterview({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Interview updated" }); },
      onError: (err: unknown) =>
        toast({ title: "Could not update", description: errMsg(err, "Try again."), variant: "destructive" }),
    },
  });

  if (error) return <AccessNote />;

  const panels = data?.items ?? [];
  const candidates = (candData?.items ?? []).filter((c) => c.stage !== "hired" && c.stage !== "rejected");

  return (
    <div className="space-y-4" data-testid="hire-interviews-view">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-mute">{isLoading ? "Loading…" : `${panels.length} interview panel(s)`}</p>
        <PillButton onClick={() => setShowForm((v) => !v)} data-testid="interview-form-toggle">
          {showForm ? "Cancel" : "Schedule interview"}
        </PillButton>
      </div>

      {showForm ? (
        <Card className="p-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const clean = stages
                .map((s) => ({ ...s, stage: s.stage.trim(), interviewer: s.interviewer.trim(), focus: s.focus.trim() }))
                .filter((s) => s.stage && s.interviewer);
              if (!candidateId || !scheduledFor.trim() || clean.length === 0) return;
              create.mutate({ data: { candidateId, scheduledFor: scheduledFor.trim(), stages: clean } });
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <select className={inputCls} value={candidateId} onChange={(e) => setCandidateId(e.target.value)} data-testid="interview-candidate">
                <option value="">Pick a candidate…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.roleTitle ? ` — ${c.roleTitle}` : ""}</option>
                ))}
              </select>
              <input className={inputCls} type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} data-testid="interview-date" />
            </div>
            <div className="space-y-2">
              {stages.map((s, i) => (
                <div key={i} className="grid gap-2 md:grid-cols-[1fr,1fr,90px,1fr,auto]">
                  <input className={inputCls} placeholder="Stage (e.g. Case)" value={s.stage} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, stage: e.target.value } : x)))} />
                  <input className={inputCls} placeholder="Interviewer" value={s.interviewer} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, interviewer: e.target.value } : x)))} />
                  <input className={inputCls} type="number" min={5} max={480} value={s.durationMin} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, durationMin: Number(e.target.value) || 30 } : x)))} />
                  <input className={inputCls} placeholder="Focus (optional)" value={s.focus} onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, focus: e.target.value } : x)))} />
                  <button type="button" className={smallBtnCls} disabled={stages.length === 1} onClick={() => setStages(stages.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className={goldBtnCls} onClick={() => setStages([...stages, { stage: "", interviewer: "", durationMin: 45, focus: "" }])}>
                + Add stage
              </button>
            </div>
            <PillButton type="submit" disabled={create.isPending || !candidateId || !scheduledFor.trim()} data-testid="interview-submit">
              {create.isPending ? "Scheduling…" : "Schedule"}
            </PillButton>
          </form>
        </Card>
      ) : null}

      {!isLoading && panels.length === 0 ? (
        <Card className="p-6 text-sm text-text-mute" data-testid="interviews-empty">
          No interviews yet. Schedule one against a candidate in the pipeline.
        </Card>
      ) : (
        panels.map((p: AtelierHireInterview) => (
          <InterviewCard key={p.id} panel={p} onSave={(patch) => update.mutate({ id: p.id, data: patch })} saving={update.isPending} />
        ))
      )}
    </div>
  );
}

function InterviewCard({
  panel,
  onSave,
  saving,
}: {
  panel: AtelierHireInterview;
  onSave: (patch: { status?: "draft" | "scheduled" | "completed" | "cancelled"; stages?: AtelierHireInterview["stages"] }) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(panel.stages);

  React.useEffect(() => {
    if (!editing) setDraft(panel.stages);
  }, [panel.stages, editing]);

  return (
    <Card className="p-4 space-y-3" data-testid={`interview-card-${panel.id}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-text">{panel.candidateName}</div>
          <div className="text-xs text-text-faint">{panel.roleTitle || "No position"} · scheduled {panel.scheduledFor}</div>
        </div>
        <div className="flex items-center gap-2">
          <MonoChip tone={panel.status === "completed" ? "green" : panel.status === "scheduled" ? "gold" : panel.status === "cancelled" ? "red" : "amber"}>{panel.status}</MonoChip>
          {panel.status === "scheduled" ? (
            <>
              <button className={goldBtnCls} disabled={saving} onClick={() => onSave({ status: "completed" })} data-testid={`interview-complete-${panel.id}`}>
                Mark completed
              </button>
              <button className={smallBtnCls} disabled={saving} onClick={() => onSave({ status: "cancelled" })}>
                Cancel it
              </button>
            </>
          ) : null}
          <button className={smallBtnCls} onClick={() => setEditing((v) => !v)} data-testid={`interview-feedback-toggle-${panel.id}`}>
            {editing ? "Discard" : "Record feedback"}
          </button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-2">
          {draft.map((s, i) => (
            <div key={i} className="border-l-2 border-l-border pl-3 space-y-1">
              <div className="text-sm text-text font-medium">{s.stage} · {s.interviewer}</div>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  className="rounded border border-border bg-bg-elevate px-2 py-1 text-xs text-text"
                  value={s.score ?? ""}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, score: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                  data-testid={`interview-score-${panel.id}-${i}`}
                >
                  <option value="">No score</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
                </select>
                <input
                  className={`${inputCls} flex-1 min-w-[200px]`}
                  placeholder="Feedback notes"
                  value={s.notes ?? ""}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                  data-testid={`interview-notes-${panel.id}-${i}`}
                />
              </div>
            </div>
          ))}
          <PillButton disabled={saving} onClick={() => { onSave({ stages: draft }); setEditing(false); }} data-testid={`interview-feedback-save-${panel.id}`}>
            {saving ? "Saving…" : "Save feedback"}
          </PillButton>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {panel.stages.map((s, i) => (
            <div key={i} className="text-sm border-l-2 border-l-border pl-3">
              <div className="text-text font-medium">{s.stage} · {s.interviewer}</div>
              <div className="text-xs text-text-faint">{s.durationMin} min{s.focus ? ` · focus: ${s.focus}` : ""}</div>
              {s.score != null ? <div className="text-xs text-gold mt-1">score {s.score}/5</div> : null}
              {s.notes ? <div className="text-xs text-text-mute mt-1">{s.notes}</div> : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// References (read-only record view)
// ---------------------------------------------------------------------------

function ReferencesView() {
  const refs = useReferenceChecks();
  return (
    <div className="space-y-3" data-testid="hire-references-view">
      {refs.length === 0 ? (
        <Card className="p-6 text-sm text-text-mute" data-testid="references-empty">
          No reference checks recorded yet.
        </Card>
      ) : (
        refs.map((r) => (
          <Card key={r.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-text">{r.candidateName} ← {r.refererName}</div>
                <div className="text-xs text-text-faint">{r.relationship} · {r.callMode} · {r.completedAt ?? "scheduled " + r.scheduledFor}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <MonoChip tone={r.wouldRehire === "yes" ? "green" : r.wouldRehire === "no" ? "red" : "amber"}>rehire: {r.wouldRehire ?? "—"}</MonoChip>
                <MonoChip tone={r.fitForLevel === "above" ? "gold" : r.fitForLevel === "at" ? "green" : r.fitForLevel === "below" ? "red" : "default"}>fit: {r.fitForLevel ?? "—"}</MonoChip>
              </div>
            </div>
            {r.headlineQuote ? <div className="text-sm italic text-text-mute border-l-2 border-l-gold/40 pl-2">"{r.headlineQuote}"</div> : null}
          </Card>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

const OFFER_STATUSES = ["draft", "sent", "accepted", "declined", "withdrawn"] as const;

function OffersView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useAtelierListHireOffers();
  const { data: candData } = useAtelierListHireCandidates();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierListHireOffersQueryKey() });
    void qc.invalidateQueries({ queryKey: getAtelierListHireCandidatesQueryKey() });
  };

  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [candidateId, setCandidateId] = React.useState("");
  const [roleTitle, setRoleTitle] = React.useState("");
  const [jurisdiction, setJurisdiction] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [totalK, setTotalK] = React.useState("");

  const create = useAtelierCreateHireOffer({
    mutation: {
      onSuccess: () => {
        invalidate();
        setShowForm(false);
        setCandidateId(""); setRoleTitle(""); setJurisdiction(""); setStartDate(""); setTotalK("");
        toast({ title: "Offer drafted" });
      },
      onError: (err: unknown) =>
        toast({ title: "Could not draft the offer", description: errMsg(err, "Check the fields and try again."), variant: "destructive" }),
    },
  });
  const update = useAtelierUpdateHireOffer({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (err: unknown) =>
        toast({ title: "Could not update the offer", description: errMsg(err, "Try again."), variant: "destructive" }),
    },
  });

  if (error) return <AccessNote />;

  const offers = data?.items ?? [];
  const candidates = candData?.items ?? [];
  const candidateById = new Map(candidates.map((c) => [c.id, c]));

  return (
    <div className="space-y-4" data-testid="hire-offers-view">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-mute">{isLoading ? "Loading…" : `${offers.length} offer(s)`}</p>
        <PillButton onClick={() => setShowForm((v) => !v)} data-testid="offer-form-toggle">
          {showForm ? "Cancel" : "Draft offer"}
        </PillButton>
      </div>

      {showForm ? (
        <Card className="p-4">
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!candidateId || !roleTitle.trim() || !startDate.trim()) return;
              const n = Number(totalK);
              create.mutate({
                data: {
                  candidateId,
                  roleTitle: roleTitle.trim(),
                  jurisdiction: jurisdiction.trim() || undefined,
                  startDate: startDate.trim(),
                  totalAtTargetUsdK: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined,
                },
              });
            }}
          >
            <select
              className={inputCls}
              value={candidateId}
              onChange={(e) => {
                setCandidateId(e.target.value);
                const c = candidateById.get(e.target.value);
                if (c?.roleTitle && !roleTitle.trim()) setRoleTitle(c.roleTitle);
              }}
              data-testid="offer-candidate"
            >
              <option value="">Pick a candidate…</option>
              {candidates.filter((c) => c.stage !== "rejected").map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.roleTitle ? ` — ${c.roleTitle}` : ""}</option>
              ))}
            </select>
            <input className={inputCls} placeholder="Position title on the offer" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} data-testid="offer-role-title" />
            <input className={inputCls} placeholder="Jurisdiction (e.g. UAE)" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
            <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="offer-start-date" />
            <input className={inputCls} type="number" min={0} placeholder="Total comp at target ($K, optional)" value={totalK} onChange={(e) => setTotalK(e.target.value)} />
            <div className="md:col-span-2">
              <PillButton type="submit" disabled={create.isPending || !candidateId || !roleTitle.trim() || !startDate.trim()} data-testid="offer-submit">
                {create.isPending ? "Drafting…" : "Draft offer"}
              </PillButton>
            </div>
          </form>
        </Card>
      ) : null}

      {!isLoading && offers.length === 0 ? (
        <Card className="p-6 text-sm text-text-mute" data-testid="offers-empty">
          No offers yet. Draft one for a candidate who has cleared interviews.
        </Card>
      ) : (
        offers.map((o: AtelierHireOffer) => {
          const cand = o.candidateId ? candidateById.get(o.candidateId) : undefined;
          const joinerHref =
            "/people/onboard/invitations?" +
            new URLSearchParams({
              sourceKind: "accepted_offer",
              sourceId: o.id,
            }).toString();
          return (
            <Card key={o.id} className="p-4" data-testid={`offer-card-${o.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{o.candidateName}</div>
                  <div className="text-xs text-text-faint mt-1">{o.roleTitle}{o.jurisdiction ? ` · ${o.jurisdiction}` : ""} · start {o.startDate}</div>
                  {o.totalAtTargetUsdK > 0 ? (
                    <div className="text-sm text-text-mute mt-2">Total at target: <span className="text-text">${o.totalAtTargetUsdK}K</span></div>
                  ) : null}
                  {o.bandFlag ? <div className="text-xs text-amber-400 mt-1">⚠ {o.bandFlag}</div> : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <MonoChip tone={o.status === "accepted" ? "green" : o.status === "sent" ? "gold" : o.status === "draft" ? "amber" : "default"}>{o.status}</MonoChip>
                  <select
                    className="rounded border border-border bg-bg-elevate px-2 py-1 text-xs text-text"
                    value={o.status}
                    onChange={(e) => update.mutate({ id: o.id, data: { status: e.target.value as never } })}
                    disabled={update.isPending}
                    data-testid={`offer-status-${o.id}`}
                  >
                    {OFFER_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                  {o.status === "accepted" && !o.joinerUserId ? (
                    <Link href={joinerHref} className={goldBtnCls} data-testid={`offer-create-login-${o.id}`}>
                      Send invitation →
                    </Link>
                  ) : null}
                  {o.joinerUserId ? <MonoChip tone="gold">login created</MonoChip> : null}
                  <button className={smallBtnCls} onClick={() => setEditingId(editingId === o.id ? null : o.id)} data-testid={`offer-edit-toggle-${o.id}`}>
                    {editingId === o.id ? "Discard" : "Edit"}
                  </button>
                </div>
              </div>
              {editingId === o.id ? (
                <OfferEditForm
                  offer={o}
                  pending={update.isPending}
                  onSave={(patch) => update.mutate({ id: o.id, data: patch }, { onSuccess: () => setEditingId(null) })}
                />
              ) : null}
            </Card>
          );
        })
      )}
    </div>
  );
}

function OfferEditForm({
  offer,
  pending,
  onSave,
}: {
  offer: AtelierHireOffer;
  pending: boolean;
  onSave: (patch: {
    roleTitle: string;
    jurisdiction?: string;
    startDate: string;
    totalAtTargetUsdK?: number;
  }) => void;
}) {
  const [roleTitle, setRoleTitle] = React.useState(offer.roleTitle);
  const [jurisdiction, setJurisdiction] = React.useState(offer.jurisdiction ?? "");
  const [startDate, setStartDate] = React.useState(offer.startDate ?? "");
  const [totalK, setTotalK] = React.useState(offer.totalAtTargetUsdK > 0 ? String(offer.totalAtTargetUsdK) : "");

  return (
    <form
      className="grid gap-3 md:grid-cols-2 border-t border-border pt-3 mt-3"
      data-testid={`offer-edit-form-${offer.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!roleTitle.trim() || !startDate.trim()) return;
        const n = Number(totalK);
        onSave({
          roleTitle: roleTitle.trim(),
          jurisdiction: jurisdiction.trim(),
          startDate: startDate.trim(),
          totalAtTargetUsdK: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined,
        });
      }}
    >
      <input className={inputCls} placeholder="Position title on the offer" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} data-testid={`offer-edit-role-title-${offer.id}`} />
      <input className={inputCls} placeholder="Jurisdiction (e.g. UAE)" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
      <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid={`offer-edit-start-date-${offer.id}`} />
      <input className={inputCls} type="number" min={0} placeholder="Total comp at target ($K, optional)" value={totalK} onChange={(e) => setTotalK(e.target.value)} />
      <div className="md:col-span-2">
        <PillButton type="submit" disabled={pending || !roleTitle.trim() || !startDate.trim()} data-testid={`offer-edit-save-${offer.id}`}>
          {pending ? "Saving…" : "Save changes"}
        </PillButton>
      </div>
    </form>
  );
}
