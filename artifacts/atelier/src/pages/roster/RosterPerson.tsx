import * as React from "react";
import { useRoute, Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { BusinessCardQR } from "./BusinessCardQR";
// Task #159 — contract records linked to this roster person.
import { ContractsPanel } from "@/components/contracts/ContractsPanel";

interface Person {
  id: string;
  workerType: "employee" | "contractor" | "partner_firm_resource";
  fullName: string;
  email: string | null;
  role: string | null;
  seniority: string | null;
  title: string | null;
  country: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  partnerFirmName?: string | null;
  vendorEntity?: string | null;
  iban?: string | null;
  swift?: string | null;
  noticePeriodDays?: number | null;
  payrollCountry?: string | null;
  employeeIdExternal?: string | null;
  dayRateAmount?: number | null;
  dayRateCurrency?: string | null;
  employmentType?: string | null;
  homeOffice?: string | null;
  notes?: string | null;
  // Task #645 — public business-card contact fields (employees), feed vCard QR.
  cellPhones?: Array<{ country: string; number: string }> | null;
  officeAddress?: string | null;
  // Task #412 — self-identified demographics, optional.
  gender?: string | null;
  nationality?: string | null;
}

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "access", label: "Access" },
  { id: "engagements", label: "Engagements" },
  { id: "skills", label: "Skills" },
  { id: "learning", label: "Learning" },
  { id: "performance", label: "Performance" },
  { id: "compensation", label: "Compensation" },
  { id: "succession", label: "Succession" },
  { id: "timesheet", label: "Time" },
  { id: "documents", label: "Documents" },
  { id: "conflicts", label: "Conflicts" },
  { id: "audit", label: "Audit" },
];

export default function RosterPerson() {
  // Task #364 — same component is now mounted under both the legacy
  // `/roster/people/:id` and the new `/people/people/:id` paths. We match
  // either prefix and keep all generated hrefs on whichever prefix the user
  // arrived from.
  const [, rParams]    = useRoute("/roster/people/:id");
  const [, rParamsTab] = useRoute("/roster/people/:id/:tab");
  const [, pParams]    = useRoute("/people/people/:id");
  const [, pParamsTab] = useRoute("/people/people/:id/:tab");
  const personId = rParams?.id ?? rParamsTab?.id ?? pParams?.id ?? pParamsTab?.id;
  const activeTab = rParamsTab?.tab ?? pParamsTab?.tab ?? "profile";
  const underPeople = !!(pParams || pParamsTab);
  const dirHref = underPeople ? "/people/people" : "/roster/people";
  const tabBase = `${dirHref}/${personId}`;

  const [person, setPerson] = React.useState<Person | null>(null);
  const [viewerCanSeeComp, setViewerCanSeeComp] = React.useState(false);

  React.useEffect(() => {
    if (!personId) return;
    fetch(`/api/atelier/roster/people/${personId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setPerson(d.person ?? null);
        setViewerCanSeeComp(!!d.viewerCanSeeComp);
      });
  }, [personId]);

  if (!personId) return null;
  if (!person)
    return <div className="px-8 py-12 text-text-mute">Loading…</div>;

  return (
    <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">
      <PageHero>
        <Link href={dirHref} className="text-text-mute hover:text-gold text-xs font-mono uppercase">
          ← {underPeople ? "People directory" : "The Roster"}
        </Link>
        <SectionHead headline={person.fullName} />
        <div className="flex flex-wrap gap-2 mt-1">
          <MonoChip>
            {person.workerType === "partner_firm_resource"
              ? "Partner-firm"
              : person.workerType[0]!.toUpperCase() +
                person.workerType.slice(1)}
          </MonoChip>
          {person.title && <MonoChip>{person.title}</MonoChip>}
          {person.seniority && <MonoChip>{person.seniority}</MonoChip>}
          {person.country && <MonoChip>{person.country}</MonoChip>}
          <MonoChip>{person.status}</MonoChip>
        </div>
      </PageHero>

      <TabNav className="mt-6">
        {TABS.map((t) => (
          <TabNavLink
            key={t.id}
            href={
              t.id === "profile"
                ? tabBase
                : `${tabBase}/${t.id}`
            }
            active={activeTab === t.id}
            data-testid={`tab-${t.id}`}
          >
            {t.label}
          </TabNavLink>
        ))}
      </TabNav>

      <div className="mt-6">
        {activeTab === "profile" && (
          <ProfileTab person={person} viewerCanSeeComp={viewerCanSeeComp} onUpdated={setPerson} />
        )}
        {activeTab === "access" && <AccessTab personId={personId} />}
        {activeTab === "engagements" && <EngagementsTab personId={personId} />}
        {activeTab === "skills" && (
          person?.workerType === "partner_firm_resource" ? (
            <Card className="p-6 text-text-mute">
              Partner-firm resources are not part of the firm's skill graph by design.
            </Card>
          ) : (
            <SkillsTab personId={personId} />
          )
        )}
        {activeTab === "learning" && <PlaceholderTab title="Learning · enrollments, certifications, mentor pairing" />}
        {activeTab === "performance" && <PlaceholderTab title="Performance · goals, check-ins, reviews, calibration outcomes" />}
        {activeTab === "compensation" && <PlaceholderTab title="Compensation · band position, history, total rewards (Partner-only)" />}
        {activeTab === "succession" && <PlaceholderTab title="Succession · roles this person is in the slate for" />}
        {activeTab === "timesheet" && <PlaceholderTab title="Time · summary, recent weeks, approvals" />}
        {activeTab === "documents" && (
          <>
            <ContractsPanel personId={personId} title="Contracts" />
            <DocumentsTab personId={personId} />
          </>
        )}
        {activeTab === "conflicts" && <ConflictsTab personId={personId} />}
        {activeTab === "audit" && <AuditTab personId={personId} />}
      </div>
    </div>
  );
}

function ProfileTab({
  person,
  viewerCanSeeComp,
  onUpdated,
}: {
  person: Person;
  viewerCanSeeComp: boolean;
  onUpdated: (p: Person) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4 space-y-3">
        <h3 className="font-mono text-xs uppercase text-text-mute">
          Identity
        </h3>
        <Field label="Email" value={person.email} />
        <Field label="Role" value={person.role} />
        <Field label="Country" value={person.country} />
        <DemographicsEditor person={person} onUpdated={onUpdated} />
        <Field label="Status" value={person.status} />
        <Field label="Start" value={person.startDate} />
        <Field label="End" value={person.endDate} />
      </Card>
      <Card className="p-4 space-y-3">
        <h3 className="font-mono text-xs uppercase text-text-mute">
          Engagement
        </h3>
        <Field label="Employment type" value={person.employmentType} />
        <Field label="Home office" value={person.homeOffice} />
        <Field label="Vendor entity" value={person.vendorEntity} />
        <Field label="Partner firm" value={person.partnerFirmName} />
        <Field label="External employee id" value={person.employeeIdExternal} />
      </Card>
      {person.workerType === "employee" && (
        <BusinessCardQR
          person={person}
          onUpdated={(patch) => onUpdated({ ...person, ...patch })}
        />
      )}
      <Card className="p-4 space-y-3 md:col-span-2">
        <h3 className="font-mono text-xs uppercase text-text-mute flex items-center gap-2">
          Compensation & banking
          {!viewerCanSeeComp && (
            <MonoChip className="text-warning border-warning/40">
              hidden — Partner / Operations only (comp-policy lock)
            </MonoChip>
          )}
        </h3>
        {viewerCanSeeComp ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payroll country" value={person.payrollCountry} />
            <Field
              label="Notice period (days)"
              value={
                person.noticePeriodDays != null
                  ? String(person.noticePeriodDays)
                  : null
              }
            />
            <Field label="IBAN" value={person.iban} mono />
            <Field label="SWIFT" value={person.swift} mono />
            <Field
              label="Day rate"
              value={
                person.dayRateAmount != null
                  ? `${(person.dayRateAmount / 100).toLocaleString()} ${person.dayRateCurrency ?? ""}`
                  : null
              }
            />
          </div>
        ) : (
          <p className="text-sm text-text-mute">
            Bank, IBAN, SWIFT, day-rate, and notice-period details are locked
            behind the compensation policy. Switch to a Partner or Operations
            persona to view.
          </p>
        )}
      </Card>
      {person.notes && (
        <Card className="p-4 md:col-span-2">
          <h3 className="font-mono text-xs uppercase text-text-mute mb-2">
            Notes
          </h3>
          <p className="text-sm text-text whitespace-pre-line">
            {person.notes}
          </p>
        </Card>
      )}
    </div>
  );
}

/**
 * Task #412 — HR/Partner-only inline editor for the demographic columns
 * surfaced by the People Lens Composition dashboard. Renders as plain
 * Field rows for everyone else; a 403 from the PATCH endpoint flips the
 * row back to read-only with a hint.
 */
function DemographicsEditor({
  person,
  onUpdated,
}: {
  person: Person;
  onUpdated: (p: Person) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [gender, setGender] = React.useState(person.gender ?? "unspecified");
  const [nationality, setNationality] = React.useState(person.nationality ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setGender(person.gender ?? "unspecified");
    setNationality(person.nationality ?? "");
  }, [person.id, person.gender, person.nationality]);

  if (!editing) {
    return (
      <>
        <Field label="Nationality" value={person.nationality} />
        <Field
          label="Gender (self-identified)"
          value={
            person.gender && person.gender !== "unspecified"
              ? person.gender.replace("_", "-")
              : null
          }
        />
        <button
          onClick={() => { setError(null); setEditing(true); }}
          className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-gold"
          data-testid="demographics-edit"
        >
          Edit demographics
        </button>
      </>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/atelier/roster/people/${person.id}/demographics`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            gender,
            nationality: nationality.trim() ? nationality.trim().toUpperCase() : null,
          }),
        },
      );
      if (r.status === 403) { setError("HR / Partner only."); setEditing(false); return; }
      if (!r.ok) { setError(`Save failed (${r.status}).`); return; }
      const d = await r.json();
      if (d.person) onUpdated(d.person as Person);
      setEditing(false);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border border-border-soft rounded p-2" data-testid="demographics-editor">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-text-mute">Nationality (ISO α-2)</span>
        <input
          value={nationality}
          onChange={(e) => setNationality(e.target.value.toUpperCase())}
          maxLength={2}
          placeholder="EG"
          className="bg-bg-elevate border border-border-soft rounded px-2 py-0.5 text-text font-mono text-xs w-16 text-center"
          data-testid="demographics-nationality"
        />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-text-mute">Gender (self-identified)</span>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="bg-bg-elevate border border-border-soft rounded px-2 py-0.5 text-text text-xs"
          data-testid="demographics-gender"
        >
          <option value="unspecified">unspecified</option>
          <option value="female">female</option>
          <option value="male">male</option>
          <option value="non_binary">non-binary</option>
        </select>
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
          data-testid="demographics-save"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-text-mute">{label}</span>
      <span
        className={`text-text text-right ${mono ? "font-mono text-xs" : ""}`}
      >
        {value || "—"}
      </span>
    </div>
  );
}

interface SkillRow {
  id: string;
  skill: { id: string; name: string; kind: string; slug: string };
  proficiency: number;
  source: string;
  evidenceArtifactIds: string[];
  evidenceSummary: string | null;
  confidence: number | null;
  status: string;
  verifiedByName: string | null;
  verifiedAt: string | null;
  proposedByAgentId: string | null;
  proposedAt: string | null;
}

const SKILL_SOURCE_LABEL: Record<string, string> = {
  certification: "Certification",
  partner_attested: "Partner attested",
  evidence_atelier: "Atelier evidence",
  self: "Self",
  agent_inferred: "Agent inferred",
};

function SkillsTab({ personId }: { personId: string }) {
  const [rows, setRows] = React.useState<SkillRow[] | null>(null);
  const [canVerify, setCanVerify] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    fetch(`/api/atelier/roster/people/${personId}/skills`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => {
        setRows(d.skills ?? []);
        setCanVerify(!!d.viewerCanVerify);
      });
  }, [personId]);

  React.useEffect(() => refresh(), [refresh]);

  const act = async (
    rowId: string,
    action: "verify" | "dismiss",
  ): Promise<void> => {
    setBusy(`${rowId}:${action}`);
    try {
      const r = await fetch(
        `/api/atelier/roster/people/${personId}/skills/row/${rowId}/${action}`,
        { method: "POST", credentials: "include" },
      );
      const d = await r.json();
      if (r.ok && d.skills) {
        setRows(d.skills);
      }
    } finally {
      setBusy(null);
    }
  };

  if (!rows) return <div className="text-text-mute">Loading…</div>;

  // Group by source for clean visual hierarchy: verified evidence first.
  const order = [
    "certification",
    "partner_attested",
    "evidence_atelier",
    "self",
    "agent_inferred",
  ];
  const grouped = new Map<string, SkillRow[]>();
  for (const r of rows) {
    const arr = grouped.get(r.source) ?? [];
    arr.push(r);
    grouped.set(r.source, arr);
  }

  return (
    <div className="space-y-4" data-testid="skills-tab">
      <div className="text-xs text-text-mute font-mono uppercase">
        Skills · {rows.length} · grouped by source
      </div>
      {order
        .filter((s) => grouped.has(s))
        .map((src) => (
          <div key={src} className="space-y-2">
            <div className="text-xs font-mono uppercase text-text-mute">
              {SKILL_SOURCE_LABEL[src] ?? src}
            </div>
            {(grouped.get(src) ?? []).map((r) => (
              <Card
                key={r.id}
                className={`p-3 ${r.status === "dismissed" ? "opacity-50" : ""}`}
                data-testid={`skill-row-${r.skill.id}`}
              >
                <div className="flex flex-wrap justify-between gap-3 items-center">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-sm">{r.skill.name}</span>
                    <MonoChip>{r.skill.kind}</MonoChip>
                    <MonoChip>p{r.proficiency}/5</MonoChip>
                    {r.confidence != null && (
                      <MonoChip>conf {(r.confidence * 100).toFixed(0)}%</MonoChip>
                    )}
                    {r.status !== "active" && (
                      <MonoChip className="text-warning border-warning/40">
                        {r.status}
                      </MonoChip>
                    )}
                  </div>
                  {canVerify && r.source === "agent_inferred" && (
                    <div className="flex gap-2">
                      {r.status === "dismissed" && (
                        <button
                          onClick={() => act(r.id, "verify")}
                          disabled={busy === `${r.id}:verify`}
                          className="text-xs px-2 py-1 border border-line rounded hover:border-gold hover:text-gold"
                          data-testid={`verify-${r.id}`}
                        >
                          Reinstate
                        </button>
                      )}
                      {r.status === "active" && (
                        <button
                          onClick={() => act(r.id, "verify")}
                          disabled={busy === `${r.id}:verify`}
                          className="text-xs px-2 py-1 border border-line rounded hover:border-gold hover:text-gold"
                          data-testid={`verify-${r.id}`}
                        >
                          Verify
                        </button>
                      )}
                      {r.status === "active" && (
                        <button
                          onClick={() => act(r.id, "dismiss")}
                          disabled={busy === `${r.id}:dismiss`}
                          className="text-xs px-2 py-1 border border-line rounded hover:border-warning hover:text-warning"
                          data-testid={`dismiss-${r.id}`}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {(r.evidenceSummary || r.verifiedByName) && (
                  <div className="text-xs text-text-mute mt-1">
                    {r.evidenceSummary && <span>{r.evidenceSummary}</span>}
                    {r.verifiedByName && (
                      <span>
                        {r.evidenceSummary ? " · " : ""}
                        verified by {r.verifiedByName}
                      </span>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        ))}
      {rows.length === 0 && (
        <Card className="p-6 text-text-mute">
          No skills recorded yet. Self-attest from this dossier, or run the Skill
          Mapper from <Link href="/roster/skill-graph" className="text-gold">/roster/skill-graph</Link>.
        </Card>
      )}
    </div>
  );
}

function PlaceholderTab({ title }: { title: string }) {
  return (
    <Card className="p-8 text-center text-text-mute">
      <p className="text-sm">
        <strong>{title}</strong> — coming online in a follow-up task. The
        skeleton table is wired so the dossier shape is stable for downstream
        work (timesheet rollup, skill matching, allocation planner).
      </p>
    </Card>
  );
}

interface EngagementGrant {
  id: string;
  engagementId: string;
  engagementName: string | null;
  accountName: string | null;
  plmStage: string | null;
  roleOnEngagement: string;
  allocationPct: number | null;
  scope: string[] | null;
  status: string;
  grantedAt: string | null;
  endDate: string | null;
}

function AccessTab({ personId }: { personId: string }) {
  // PRD §1 IA — Access tab shows engagements the person is on with role + scope chips.
  // Same data shape as /engagements endpoint, but rendered as a flatter access ledger.
  const [rows, setRows] = React.useState<EngagementGrant[] | null>(null);
  React.useEffect(() => {
    fetch(`/api/atelier/roster/people/${personId}/access`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setRows(d.grants ?? d.access ?? d.engagements ?? []));
  }, [personId]);
  if (!rows) return <div className="text-text-mute">Loading…</div>;
  if (rows.length === 0)
    return (
      <Card className="p-6 text-text-mute">
        No engagement-access grants. Use the Roster admin (Partner-only) to grant access.
      </Card>
    );
  return (
    <div className="space-y-2" data-testid="access-tab-rows">
      <div className="text-xs text-text-mute font-mono uppercase mb-2">
        Access ledger — role · allocation · scope chips · status
      </div>
      {rows.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex justify-between gap-3 items-center">
            <div className="text-sm text-text">
              <Link href={`/clients/deliver/engagements/${r.engagementId}`} className="hover:text-gold">
                {r.engagementName ?? r.engagementId}
              </Link>
              <span className="text-text-mute"> · {r.accountName ?? ""}</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              <MonoChip>{r.roleOnEngagement}</MonoChip>
              {r.allocationPct != null && r.allocationPct > 0 && (
                <MonoChip>{r.allocationPct}%</MonoChip>
              )}
              <MonoChip
                className={
                  r.status === "active"
                    ? ""
                    : "text-warning border-warning/40"
                }
              >
                {r.status}
              </MonoChip>
            </div>
          </div>
          {r.scope && r.scope.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {r.scope.map((s) => (
                <MonoChip key={s}>{s}</MonoChip>
              ))}
            </div>
          )}
          <div className="text-xs text-text-faint mt-1">
            {r.grantedAt && `granted ${new Date(r.grantedAt).toLocaleDateString()}`}
            {r.endDate && ` · ends ${new Date(r.endDate).toLocaleDateString()}`}
          </div>
        </Card>
      ))}
    </div>
  );
}

function EngagementsTab({ personId }: { personId: string }) {
  const [rows, setRows] = React.useState<EngagementGrant[] | null>(null);
  React.useEffect(() => {
    fetch(`/api/atelier/roster/people/${personId}/engagements`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setRows(d.engagements ?? []));
  }, [personId]);
  if (!rows) return <div className="text-text-mute">Loading…</div>;
  if (rows.length === 0)
    return (
      <Card className="p-6 text-text-mute">
        Not currently staffed on any engagement.
      </Card>
    );
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex justify-between gap-3">
            <div>
              <div className="font-medium text-text">
                <Link href={`/clients/deliver/engagements/${r.engagementId}`} className="hover:text-gold">
                  {r.engagementName}
                </Link>
              </div>
              <div className="text-xs text-text-mute">{r.accountName}</div>
            </div>
            <div className="flex gap-1 flex-wrap">
              <MonoChip>{r.roleOnEngagement}</MonoChip>
              {r.allocationPct != null && r.allocationPct > 0 && (
                <MonoChip>{r.allocationPct}%</MonoChip>
              )}
              <MonoChip>{r.status}</MonoChip>
              {r.plmStage && <MonoChip>{r.plmStage}</MonoChip>}
            </div>
          </div>
          {r.scope && r.scope.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2 text-xs">
              {r.scope.map((s) => (
                <MonoChip key={s}>{s}</MonoChip>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

interface DocRow {
  id: string;
  kind: string;
  title: string;
  // Task #254 — short-lived HMAC-signed download URL minted by the API
  // (5-min TTL, persona-bound). Backend audits every download and 302s
  // to the resolved object key (placeholder until #255 wires storage).
  downloadUrl: string;
  uploadedAt: string;
  expiresAt: string | null;
}

function DocumentsTab({ personId }: { personId: string }) {
  const [docs, setDocs] = React.useState<DocRow[] | null>(null);
  React.useEffect(() => {
    fetch(`/api/atelier/roster/people/${personId}/documents`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setDocs(d.documents ?? []));
  }, [personId]);
  if (!docs) return <div className="text-text-mute">Loading…</div>;
  if (docs.length === 0)
    return (
      <Card className="p-6 text-text-mute">
        No documents on file. Upload UI ships in the next Roster task.
      </Card>
    );
  return (
    <div className="space-y-2">
      {docs.map((d) => (
        <Card key={d.id} className="p-3 flex justify-between items-center">
          <div>
            <div className="text-sm text-text">{d.title}</div>
            <div className="text-xs text-text-faint">
              {d.kind} · uploaded {new Date(d.uploadedAt).toLocaleDateString()}
              {d.expiresAt && ` · expires ${new Date(d.expiresAt).toLocaleDateString()}`}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <MonoChip>{d.kind}</MonoChip>
            <a
              href={d.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs uppercase text-accent hover:underline"
              data-testid={`doc-download-${d.id}`}
            >
              Download ↓
            </a>
          </div>
        </Card>
      ))}
    </div>
  );
}

interface AuditEvent {
  id: string;
  ts: string;
  actorLabel: string | null;
  actorType: string;
  action: string;
  entityType: string;
  payloadSummary: string | null;
}

function AuditTab({ personId }: { personId: string }) {
  const [events, setEvents] = React.useState<AuditEvent[] | null>(null);
  React.useEffect(() => {
    fetch(`/api/atelier/roster/people/${personId}/audit`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []));
  }, [personId]);
  // PRD §1 IA — Audit tab owns the per-person Audit Pack export CTA.
  // The export pipeline lands in a follow-up; the placeholder hook is wired
  // here so QA + downstream tasks have a stable target.
  const ExportCta = (
    <div className="flex justify-end mb-3">
      <button
        type="button"
        disabled
        title="Audit Pack PDF export ships in a follow-up task"
        data-testid="export-audit-pack-pdf"
        className="px-3 py-1.5 text-xs font-mono uppercase border border-border rounded text-text-mute hover:text-gold hover:border-gold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Export Audit Pack PDF
      </button>
    </div>
  );
  if (!events)
    return (
      <>
        {ExportCta}
        <div className="text-text-mute">Loading…</div>
      </>
    );
  if (events.length === 0)
    return (
      <>
        {ExportCta}
        <Card className="p-6 text-text-mute">No audit events.</Card>
      </>
    );
  return (
    <div className="space-y-2">
      {ExportCta}
      {events.map((e) => (
        <Card key={e.id} className="p-3">
          <div className="flex justify-between gap-3 text-xs text-text-mute">
            <span>{new Date(e.ts).toLocaleString()}</span>
            <MonoChip>{e.action}</MonoChip>
          </div>
          <div className="text-sm text-text mt-1">{e.payloadSummary}</div>
          <div className="text-xs text-text-faint mt-1">
            {e.actorType}: {e.actorLabel}
          </div>
        </Card>
      ))}
    </div>
  );
}

interface ConflictRow {
  id: string;
  declaredParty: string | null;
  disclosureText: string;
  nature: string | null;
  scopeImpact: string | null;
  status: string;
  declaredAt: string | null;
  lastReviewedAt: string | null;
  notes: string | null;
}

function ConflictsTab({ personId }: { personId: string }) {
  const [rows, setRows] = React.useState<ConflictRow[] | null>(null);
  const [draft, setDraft] = React.useState({
    declaredParty: "",
    disclosureText: "",
    nature: "",
    scopeImpact: "",
  });
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(() => {
    fetch(`/api/atelier/roster/people/${personId}/conflicts`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setRows(d.conflicts ?? []))
      .catch(() => setRows([]));
  }, [personId]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const submit = async () => {
    setBusy(true);
    try {
      await fetch(`/api/atelier/roster/people/${personId}/conflicts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setDraft({ declaredParty: "", disclosureText: "", nature: "", scopeImpact: "" });
      reload();
    } finally {
      setBusy(false);
    }
  };

  const update = async (conflictId: string, status: string) => {
    await fetch(`/api/atelier/roster/people/${personId}/conflicts/${conflictId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    reload();
  };

  return (
    <div className="space-y-4" data-testid="conflicts-tab">
      <Card className="p-4 space-y-3">
        <h3 className="font-mono text-xs uppercase text-text-mute">
          Declare a conflict
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">
              Declared party (account name or id)
            </span>
            <input
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={draft.declaredParty}
              onChange={(e) =>
                setDraft({ ...draft, declaredParty: e.target.value })
              }
              data-testid="conflict-party"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">
              Nature
            </span>
            <input
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={draft.nature}
              onChange={(e) => setDraft({ ...draft, nature: e.target.value })}
              placeholder="prior employer · family · investor · …"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="font-mono text-[11px] uppercase text-text-mute">
              Disclosure text
            </span>
            <textarea
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm min-h-[80px]"
              value={draft.disclosureText}
              onChange={(e) =>
                setDraft({ ...draft, disclosureText: e.target.value })
              }
              data-testid="conflict-text"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="font-mono text-[11px] uppercase text-text-mute">
              Scope impact
            </span>
            <input
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={draft.scopeImpact}
              onChange={(e) =>
                setDraft({ ...draft, scopeImpact: e.target.value })
              }
              placeholder="e.g. cannot view pricing on this account"
            />
          </label>
        </div>
        <button
          onClick={submit}
          disabled={busy || !draft.declaredParty || !draft.disclosureText}
          className="px-3 py-1 rounded text-xs font-mono bg-gold text-bg disabled:opacity-50"
          data-testid="conflict-submit"
        >
          {busy ? "Recording…" : "Declare"}
        </button>
      </Card>

      {rows === null && <div className="text-text-mute py-8">Loading…</div>}
      {rows?.length === 0 && (
        <div className="text-text-mute italic py-4">
          No conflicts declared for this person.
        </div>
      )}
      {rows?.map((c) => (
        <Card
          key={c.id}
          className="p-4 flex items-start justify-between gap-4"
          data-testid={`conflict-row-${c.id}`}
        >
          <div className="space-y-1 flex-1">
            <div className="font-medium">
              {c.declaredParty ?? "—"}
              <span className="ml-2">
                <MonoChip
                  tone={
                    c.status === "active"
                      ? "red"
                      : c.status === "escalated"
                        ? "amber"
                        : "green"
                  }
                >
                  {c.status}
                </MonoChip>
              </span>
            </div>
            {c.nature && (
              <div className="text-text-mute text-xs">Nature: {c.nature}</div>
            )}
            <div className="text-sm">{c.disclosureText}</div>
            {c.scopeImpact && (
              <div className="text-text-mute text-xs italic">
                Impact: {c.scopeImpact}
              </div>
            )}
          </div>
          {c.status === "active" && (
            <div className="flex flex-col gap-1">
              <button
                onClick={() => update(c.id, "cleared")}
                className="px-2 py-1 rounded text-[11px] font-mono border border-line hover:bg-bg-elev"
                data-testid={`conflict-clear-${c.id}`}
              >
                Clear
              </button>
              <button
                onClick={() => update(c.id, "escalated")}
                className="px-2 py-1 rounded text-[11px] font-mono border border-line hover:bg-bg-elev"
              >
                Escalate
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
