import * as React from "react";
import { useRoute, Link } from "wouter";
import { BackLink, PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { BusinessCardQR } from "./BusinessCardQR";
// Task #159 — contract records linked to this roster person.
import { ContractsPanel } from "@/components/contracts/ContractsPanel";
// Task #199 — full "Edit person" form (hr / partner / founding_partner).
import { EditPersonForm } from "./EditPersonForm";
// Task #509 (T4) — full country-name display everywhere in HR.
import { countryName } from "@/lib/countries";
import { CountryCombobox } from "@/components/CountryCombobox";
// Task #744 — employee travel loyalty & preferences.
import {
  TravelProfileCard,
  type TravelProfileValue,
} from "@/components/travel/TravelProfileCard";

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
  // Task #199 — extra prefill fields for the full Edit Person form.
  preferredName?: string | null;
  employmentStatus?: string | null;
  employingEntity?: string | null;
  contractType?: string | null;
  partnerFirmId?: string | null;
  // Task #744 — employees only; membership numbers may arrive masked.
  travelProfile?: TravelProfileValue | null;
  // Task #1137 — whether current comp differs from the signed contract.
  compDiffersFromContract?: boolean | null;
}

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "access", label: "Access" },
  { id: "engagements", label: "Engagements" },
  { id: "skills", label: "Skills" },
  { id: "learning", label: "Learning" },
  { id: "performance", label: "Performance" },
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
  const [viewerCanEditTitle, setViewerCanEditTitle] = React.useState(false);
  const [viewerCanEdit, setViewerCanEdit] = React.useState(false);
  // Task #221 — sensitive-people gate (founding_partner | hr): drives the
  // Documents + Audit tabs; managers get a business-only "reports" scope.
  const [viewerCanSeeSensitive, setViewerCanSeeSensitive] = React.useState(false);
  const [viewerScope, setViewerScope] = React.useState<"full" | "reports">("full");

  React.useEffect(() => {
    if (!personId) return;
    fetch(`/api/atelier/roster/people/${personId}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setPerson(d.person ?? null);
        setViewerCanSeeComp(!!d.viewerCanSeeComp);
        setViewerCanEditTitle(!!d.viewerCanEditTitle);
        setViewerCanEdit(!!d.viewerCanEdit);
        setViewerCanSeeSensitive(!!d.viewerCanSeeSensitive);
        setViewerScope(d.viewerScope === "reports" ? "reports" : "full");
      });
  }, [personId]);

  if (!personId) return null;
  if (!person)
    return <div className="px-8 py-12 text-text-mute">Loading…</div>;

  // Task #1171 — partner contacts have no worker surfaces; direct deep
  // links to those tabs normalize to Profile instead of rendering them.
  const PFR_HIDDEN_TABS = ["timesheet", "skills", "learning", "performance", "conflicts"];
  const isPfr = person.workerType === "partner_firm_resource";
  const effectiveTab = isPfr && PFR_HIDDEN_TABS.includes(activeTab) ? "profile" : activeTab;

  return (
    <div>
      <PageHero>
        <BackLink href={dirHref} className="mb-4" data-testid="link-back">
          {underPeople ? "People directory" : "The Roster"}
        </BackLink>
        <SectionHead headline={person.fullName} />
        <div className="flex flex-wrap gap-2 mt-1">
          <MonoChip>
            {person.workerType === "partner_firm_resource"
              ? "Partner contact"
              : person.workerType[0]!.toUpperCase() +
                person.workerType.slice(1)}
          </MonoChip>
          {/* Task #1171 — partner contacts are badged with their firm and
              framed as external, never as our workers. */}
          {person.workerType === "partner_firm_resource" && person.partnerFirmName && (
            <MonoChip tone="gold">{person.partnerFirmName}</MonoChip>
          )}
          {person.title && <MonoChip>{person.title}</MonoChip>}
          {person.seniority && <MonoChip>{person.seniority}</MonoChip>}
          {person.country && <MonoChip>{countryName(person.country)}</MonoChip>}
          <MonoChip>{person.status}</MonoChip>
        </div>
      </PageHero>
      <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">

      <TabNav className="mt-6">
        {TABS.filter((t) => {
          // Task #221 — per-viewer tab visibility. Documents (contracts,
          // IDs, scans) + Audit are sensitive-people surfaces; Conflicts and
          // Compensation drop out of the manager (business-only) view.
          if ((t.id === "documents" || t.id === "audit") && !viewerCanSeeSensitive) return false;
          if (t.id === "conflicts" && viewerScope !== "full") return false;
          // Task #1171 — partner-firm contacts are not our workers: no
          // Time, skills, learning, performance or conflicts framing.
          // Documents/Audit stay (visas etc. legitimately live there).
          if (
            person.workerType === "partner_firm_resource" &&
            ["timesheet", "skills", "learning", "performance", "conflicts"].includes(t.id)
          )
            return false;
          return true;
        }).map((t) => (
          <TabNavLink
            key={t.id}
            href={
              t.id === "profile"
                ? tabBase
                : `${tabBase}/${t.id}`
            }
            active={effectiveTab === t.id}
            data-testid={`tab-${t.id}`}
          >
            {t.label}
          </TabNavLink>
        ))}
      </TabNav>

      <div className="mt-6">
        {effectiveTab === "profile" && (
          <ProfileTab person={person} viewerCanSeeComp={viewerCanSeeComp} viewerCanEdit={viewerCanEdit} viewerCanEditTitle={viewerCanEditTitle} onUpdated={setPerson} />
        )}
        {effectiveTab === "access" && <AccessTab personId={personId} />}
        {effectiveTab === "engagements" && <EngagementsTab personId={personId} />}
        {effectiveTab === "skills" && (
          person?.workerType === "partner_firm_resource" ? (
            <Card className="p-6 text-text-mute">
              Partner-firm resources are not part of the firm's skill graph by design.
            </Card>
          ) : (
            <SkillsTab personId={personId} />
          )
        )}
        {effectiveTab === "learning" && <LearningTab personId={personId} workerType={person.workerType} />}
        {effectiveTab === "performance" && <PerformanceTab personId={personId} workerType={person.workerType} />}
        {effectiveTab === "timesheet" && <TimeTab personId={personId} />}
        {effectiveTab === "documents" && (
          <>
            <ContractsPanel personId={personId} title="Contracts" />
            <DocumentsTab personId={personId} />
          </>
        )}
        {effectiveTab === "conflicts" && <ConflictsTab personId={personId} />}
        {effectiveTab === "audit" && <AuditTab personId={personId} />}
      </div>
      </div>
    </div>
  );
}

function ProfileTab({
  person,
  viewerCanSeeComp,
  viewerCanEdit,
  viewerCanEditTitle,
  onUpdated,
}: {
  person: Person;
  viewerCanSeeComp: boolean;
  viewerCanEdit: boolean;
  viewerCanEditTitle: boolean;
  onUpdated: (p: Person) => void;
}) {
  // Task #199 — the full edit form replaces the read-only cards while open.
  const [editing, setEditing] = React.useState(false);
  if (editing) {
    return (
      <EditPersonForm
        person={person}
        viewerCanEditTitle={viewerCanEditTitle}
        viewerCanSeeComp={viewerCanSeeComp}
        onSaved={(updated) => onUpdated({ ...person, ...(updated as Partial<Person>) })}
        onClose={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {viewerCanEdit && (
        <div className="md:col-span-2 flex justify-end">
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] font-mono uppercase tracking-widest border border-border-soft rounded px-3 py-1 text-text-mute hover:text-gold hover:border-gold/50"
            data-testid="button-edit-person"
          >
            Edit person
          </button>
        </div>
      )}
      <Card className="p-4 space-y-3">
        <h3 className="font-mono text-xs uppercase text-text-mute">
          Identity
        </h3>
        <Field label="Email" value={person.email} />
        <Field label="Role" value={person.role} />
        {person.workerType === "employee" && viewerCanEditTitle ? (
          <TitleEditor person={person} onUpdated={onUpdated} />
        ) : (
          <Field label="Title" value={person.title} />
        )}
        <Field label="Country" value={countryName(person.country)} />
        <Field label="Status" value={person.status} />
        <Field label="Start" value={person.startDate} />
        <Field label="End" value={person.endDate} />
        <DemographicsEditor person={person} onUpdated={onUpdated} />
      </Card>
      <Card className="p-4 space-y-3">
        <h3 className="font-mono text-xs uppercase text-text-mute">
          Employment details
        </h3>
        <Field label="Employment type" value={person.employmentType} />
        <Field label="Employing entity" value={person.employingEntity} />
        <Field label="Home office" value={person.homeOffice} />
        {person.workerType === "contractor" && (
          <Field label="Vendor entity" value={person.vendorEntity} />
        )}
        {person.workerType === "partner_firm_resource" && (
          <Field label="Partner firm" value={person.partnerFirmName} />
        )}
        <Field label="External employee id" value={person.employeeIdExternal} />
      </Card>
      {person.workerType === "employee" && (
        <BusinessCardQR
          person={person}
          onUpdated={(patch) => onUpdated({ ...person, ...patch })}
        />
      )}
      {/* Task #744 — travel loyalty & preferences (employees only; hidden
          for contractors and partner-firm resources). */}
      {person.workerType === "employee" && (
        <TravelProfileCard
          value={person.travelProfile ?? null}
          canEdit={viewerCanEdit}
          testIdPrefix="roster-travel"
          onSave={async (next) => {
            try {
              const r = await fetch(`/api/atelier/roster/people/${person.id}`, {
                method: "PATCH",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ travelProfile: next }),
              });
              if (!r.ok) {
                const d = await r.json().catch(() => null);
                return { ok: false, error: d?.error ?? `Save failed (${r.status}).` };
              }
              const d = await r.json();
              if (d.person) onUpdated(d.person as Person);
              return { ok: true };
            } catch {
              return { ok: false, error: "Network error." };
            }
          }}
        />
      )}
      {/* Task #1171 — partner contacts have no personal comp/banking with
          us; commercials run firm-level through partner billing (RCTI). */}
      {person.workerType === "partner_firm_resource" ? (
        <Card className="p-4 md:col-span-2" data-testid="partner-contact-commercials-note">
          <h3 className="font-mono text-xs uppercase text-text-mute mb-2">Commercials</h3>
          <p className="text-sm text-text-mute">
            This person works for {person.partnerFirmName ?? "a partner firm"}. Rates,
            invoicing and payments are handled at the firm level under{" "}
            <Link href="/partners/co-deliver" className="text-gold hover:underline">
              Partners · Co-deliver
            </Link>
            , not as personal compensation.
          </p>
        </Card>
      ) : (
      <Card className="p-4 space-y-3 md:col-span-2">
        <h3 className="font-mono text-xs uppercase text-text-mute flex items-center gap-2">
          Compensation & banking
          {!viewerCanSeeComp && (
            <MonoChip className="text-warning border-warning/40">
              hidden — comp-policy lock (Founding Partner / HR / Finance)
            </MonoChip>
          )}
          {/* Task #1137 — comp differs from the signed contract: link to the
              salary review queue so HR/finance can reconcile. */}
          {viewerCanSeeComp && person.compDiffersFromContract === true && (
            <Link href="/people/reward/salary" data-testid="comp-differs-badge">
              <MonoChip tone="amber">differs from signed contract →</MonoChip>
            </Link>
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
            behind the compensation policy (Founding Partner, HR and Finance
            only).
          </p>
        )}
      </Card>
      )}
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
      <div
        className="space-y-2 border border-border-soft rounded p-2"
        data-testid="demographics-group"
      >
        <Field label="Nationality" value={countryName(person.nationality)} />
        <Field
          label="Gender (self-identified)"
          value={
            person.gender && person.gender !== "unspecified"
              ? person.gender.replace("_", "-")
              : null
          }
        />
        <div className="flex justify-end">
          <button
            onClick={() => { setError(null); setEditing(true); }}
            className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-gold"
            data-testid="demographics-edit"
          >
            Edit demographics
          </button>
        </div>
      </div>
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
        <span className="text-text-mute">Nationality</span>
        <span className="w-48">
          <CountryCombobox
            value={nationality || null}
            allowClear
            testIdPrefix="demographics-nationality"
            onChange={(iso) => setNationality(iso)}
          />
        </span>
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

/**
 * Task #189 — founding_partner / HR-only inline editor for an employee's job
 * title. Renders as a plain Field row for everyone else; a 403 from the
 * PATCH endpoint flips the row back to read-only with a hint.
 */
function TitleEditor({
  person,
  onUpdated,
}: {
  person: Person;
  onUpdated: (p: Person) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(person.title ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setTitle(person.title ?? "");
  }, [person.id, person.title]);

  if (!editing) {
    return (
      <div
        className="space-y-2 border border-border-soft rounded p-2"
        data-testid="title-group"
      >
        <Field label="Title" value={person.title} />
        <div className="flex items-center justify-end gap-2">
          {error && <span className="text-warn text-[10px] mr-auto">{error}</span>}
          <button
            onClick={() => { setError(null); setEditing(true); }}
            className="text-[10px] font-mono uppercase tracking-widest border border-border-soft rounded px-2 py-0.5 text-text-mute hover:text-gold hover:border-gold/50"
            data-testid="title-edit"
          >
            Edit title
          </button>
        </div>
      </div>
    );
  }

  const save = async () => {
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/atelier/roster/people/${person.id}/title`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (r.status === 403) { setError("Founding Partner / HR only."); setEditing(false); return; }
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
    <div className="space-y-2 border border-border-soft rounded p-2" data-testid="title-editor">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-text-mute">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="e.g. Senior Consultant"
          className="bg-bg-elevate border border-border-soft rounded px-2 py-0.5 text-text text-xs flex-1"
          data-testid="title-input"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        {error && <span className="text-warn text-[10px] mr-auto">{error}</span>}
        <button
          onClick={() => { setEditing(false); setTitle(person.title ?? ""); }}
          disabled={saving}
          className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-text px-2 py-0.5"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="text-[10px] font-mono uppercase tracking-widest bg-gold text-bg px-2 py-0.5 rounded disabled:opacity-50"
          data-testid="title-save"
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

// Task #509 (T4) — shared fetch helper for the read-only person tabs below.
// These HR-gated endpoints 403 for out-of-scope viewers; we surface that
// cleanly rather than spinning forever.
function useTabFetch<T>(url: string): { data: T | null; state: "loading" | "ready" | "forbidden" | "error" } {
  const [data, setData] = React.useState<T | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "forbidden" | "error">("loading");
  React.useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(url, { credentials: "include" })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 403) { setState("forbidden"); return; }
        if (!r.ok) { setState("error"); return; }
        const d = await r.json();
        setData(d as T);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [url]);
  return { data, state };
}

function TabNotice({ state, kind }: { state: "loading" | "forbidden" | "error"; kind: string }) {
  if (state === "loading") return <div className="text-text-mute">Loading…</div>;
  if (state === "forbidden")
    return (
      <Card className="p-6 text-text-mute text-sm">
        {kind} records are restricted to HR / partners for this person.
      </Card>
    );
  return <Card className="p-6 text-warning text-sm">Could not load {kind.toLowerCase()} records.</Card>;
}

interface PerfGoalRow { id: string; cycle: string; title: string; description: string; weightPct: number; status: string; }
interface CheckInRow { id: string; managerName: string | null; scheduledFor: string; status: string; notes: string | null; }
interface ReviewRow { id: string; cycle: string; reviewedOn: string | null; selfRating: number | null; managerRating: number | null; managerSummary: string | null; status: string; releasedAt: string | null; }
interface CertRow { id: string; certName: string; issuer: string | null; issuedOn: string | null; expiresOn: string | null; status: string; }
interface MaterialRow { id: string; title: string; description: string | null; topic: string | null; kind: string; url: string | null; audience: string; completionCount: number; }

function PerformanceTab({ personId, workerType }: { personId: string; workerType: string }) {
  const goals = useTabFetch<PerfGoalRow[]>(`/api/atelier/people/performance/goals?employeeId=${personId}`);
  const checkIns = useTabFetch<CheckInRow[]>(`/api/atelier/people/check-ins?employeeId=${personId}`);
  const reviews = useTabFetch<ReviewRow[]>(`/api/atelier/people/performance/reviews?employeeId=${personId}`);

  if (goals.state === "forbidden") return <TabNotice state="forbidden" kind="Performance" />;
  if (goals.state === "loading") return <TabNotice state="loading" kind="Performance" />;

  return (
    <div className="space-y-6" data-testid="performance-tab">
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase text-text-mute">Goals · {goals.data?.length ?? 0}</div>
        {(goals.data ?? []).map((g) => (
          <Card key={g.id} className="p-3" data-testid={`perf-goal-${g.id}`}>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm">{g.title}</span>
              <MonoChip>{g.cycle}</MonoChip>
              <MonoChip>{g.status.replace("_", " ")}</MonoChip>
              {g.weightPct > 0 && <MonoChip>{g.weightPct}%</MonoChip>}
            </div>
            {g.description && <div className="text-xs text-text-mute mt-1">{g.description}</div>}
          </Card>
        ))}
        {(goals.data?.length ?? 0) === 0 && <Card className="p-4 text-text-mute text-sm">No goals recorded.</Card>}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase text-text-mute">Check-ins · {checkIns.data?.length ?? 0}</div>
        {(checkIns.data ?? []).map((c) => (
          <Card key={c.id} className="p-3" data-testid={`perf-checkin-${c.id}`}>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm">{c.scheduledFor}</span>
              <MonoChip>{c.status}</MonoChip>
              {c.managerName && <span className="text-xs text-text-mute">with {c.managerName}</span>}
            </div>
            {c.notes && <div className="text-xs text-text-mute mt-1">{c.notes}</div>}
          </Card>
        ))}
        {(checkIns.data?.length ?? 0) === 0 && <Card className="p-4 text-text-mute text-sm">No check-ins scheduled.</Card>}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase text-text-mute">Reviews · {reviews.data?.length ?? 0}</div>
        {(reviews.data ?? []).map((r) => (
          <Card key={r.id} className="p-3" data-testid={`perf-review-${r.id}`}>
            <div className="flex flex-wrap gap-2 items-center">
              <MonoChip>{r.cycle}</MonoChip>
              <MonoChip>{r.status}</MonoChip>
              {r.managerRating != null && <MonoChip>mgr {r.managerRating}/5</MonoChip>}
              {r.selfRating != null && <MonoChip>self {r.selfRating}/5</MonoChip>}
            </div>
            {r.managerSummary && <div className="text-xs text-text-mute mt-1">{r.managerSummary}</div>}
          </Card>
        ))}
        {(reviews.data?.length ?? 0) === 0 && <Card className="p-4 text-text-mute text-sm">No reviews recorded.</Card>}
      </div>
      {workerType !== "employee" && (
        <div className="text-xs text-text-faint">Performance tracking is primarily maintained for employees.</div>
      )}
    </div>
  );
}

function LearningTab({ personId, workerType }: { personId: string; workerType: string }) {
  const certs = useTabFetch<CertRow[]>(`/api/atelier/people/certifications?employeeId=${personId}`);
  const materials = useTabFetch<MaterialRow[]>(`/api/atelier/people/training-materials`);

  if (certs.state === "forbidden") return <TabNotice state="forbidden" kind="Learning" />;
  if (certs.state === "loading") return <TabNotice state="loading" kind="Learning" />;

  return (
    <div className="space-y-6" data-testid="learning-tab">
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase text-text-mute">Certifications · {certs.data?.length ?? 0}</div>
        {(certs.data ?? []).map((c) => (
          <Card key={c.id} className="p-3" data-testid={`cert-${c.id}`}>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm">{c.certName}</span>
              {c.issuer && <MonoChip>{c.issuer}</MonoChip>}
              <MonoChip className={c.status === "expired" ? "text-warning border-warning/40" : ""}>{c.status}</MonoChip>
            </div>
            <div className="text-xs text-text-mute mt-1">
              {c.issuedOn && <span>issued {c.issuedOn}</span>}
              {c.expiresOn && <span>{c.issuedOn ? " · " : ""}expires {c.expiresOn}</span>}
            </div>
          </Card>
        ))}
        {(certs.data?.length ?? 0) === 0 && <Card className="p-4 text-text-mute text-sm">No certifications recorded.</Card>}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase text-text-mute">Training library · {materials.data?.length ?? 0}</div>
        {(materials.data ?? [])
          .filter((m) => m.audience === "all" || m.audience === (workerType === "employee" ? "employees" : "contractors"))
          .map((m) => (
            <Card key={m.id} className="p-3" data-testid={`training-${m.id}`}>
              <div className="flex flex-wrap gap-2 items-center">
                {m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-sm text-gold hover:underline">{m.title}</a>
                ) : (
                  <span className="text-sm">{m.title}</span>
                )}
                {m.topic && <MonoChip>{m.topic}</MonoChip>}
                <MonoChip>{m.kind}</MonoChip>
              </div>
              {m.description && <div className="text-xs text-text-mute mt-1">{m.description}</div>}
            </Card>
          ))}
        {(materials.data?.length ?? 0) === 0 && <Card className="p-4 text-text-mute text-sm">No training materials published.</Card>}
      </div>
    </div>
  );
}

interface TimesheetSummary {
  rolling4Week: { weeks: Array<{ weekIso: string; status: string; totalHours: number | string; billableHours: number | string }>; totalHours: number; billableHours: number; billablePct: number };
  ytd: { totalHours: number; billableHours: number; billablePct: number };
  missingWeeks: string[];
  lastSubmittedWeekStatus: string;
}

function TimeTab({ personId }: { personId: string }) {
  const { data, state } = useTabFetch<TimesheetSummary>(`/api/atelier/roster/people/${personId}/timesheet-summary`);
  if (state !== "ready" || !data) return <TabNotice state={state === "ready" ? "error" : state} kind="Time" />;

  return (
    <div className="space-y-6" data-testid="time-tab">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <div className="text-xs font-mono uppercase text-text-mute">Rolling 4 weeks</div>
          <div className="text-sm">Total {data.rolling4Week.totalHours}h · Billable {data.rolling4Week.billableHours}h ({data.rolling4Week.billablePct}%)</div>
        </Card>
        <Card className="p-4 space-y-2">
          <div className="text-xs font-mono uppercase text-text-mute">Year to date</div>
          <div className="text-sm">Total {data.ytd.totalHours}h · Billable {data.ytd.billableHours}h ({data.ytd.billablePct}%)</div>
        </Card>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-mono uppercase text-text-mute">Recent weeks</div>
        {data.rolling4Week.weeks.map((w) => (
          <Card key={w.weekIso} className="p-3 flex flex-wrap gap-2 items-center" data-testid={`ts-week-${w.weekIso}`}>
            <span className="text-sm font-mono">{w.weekIso}</span>
            <MonoChip>{w.status}</MonoChip>
            <span className="text-xs text-text-mute">{w.totalHours}h total · {w.billableHours}h billable</span>
          </Card>
        ))}
        {data.rolling4Week.weeks.length === 0 && <Card className="p-4 text-text-mute text-sm">No timesheet weeks recorded.</Card>}
      </div>
      {data.missingWeeks.length > 0 && (
        <Card className="p-3 text-warning text-sm" data-testid="ts-missing">
          Missing weeks: {data.missingWeeks.join(", ")}
        </Card>
      )}
    </div>
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

// Task #628 — Microsoft 365 account card: status, create / re-check actions
// and per-service toggles. Bespoke /m365 routes are not in the openapi spec,
// so everything here is raw fetch (matches the account-agent UI pattern).
interface M365Wire {
  status: string;
  email: string | null;
  msUserId: string | null;
  serviceProfile: string | null;
  skuId: string | null;
  disabledPlans: string[];
  signInBlocked: boolean;
  mailboxRetained: boolean;
  licenseFreed: boolean;
  lastError: string | null;
  provisionedAt: string | null;
  personEmail: string | null;
  defaultProfile: string;
}

interface M365Plan {
  servicePlanId: string;
  servicePlanName: string;
  enabled: boolean;
}

const M365_STATUS_LABEL: Record<string, string> = {
  not_provisioned: "Not provisioned",
  provisioning: "Provisioning…",
  provisioned: "Active",
  linked_existing: "Linked (existing account)",
  pending_license: "Created — no license seat free",
  blocked: "Blocked — needs manual action",
  deprovisioned: "Deprovisioned",
};

function M365Card({ personId }: { personId: string }) {
  const [wire, setWire] = React.useState<M365Wire | null>(null);
  const [plans, setPlans] = React.useState<M365Plan[] | null>(null);
  const [plansError, setPlansError] = React.useState<string | null>(null);
  const [showPlans, setShowPlans] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  // Service-profile override for the create action ("" = worker-type default).
  const [profileChoice, setProfileChoice] = React.useState<"" | "employee" | "contractor">("");

  const load = React.useCallback(async () => {
    const r = await fetch(`/api/atelier/roster/people/${personId}/m365`, { credentials: "include" });
    if (!r.ok) return null;
    const d = (await r.json()) as M365Wire;
    setWire(d);
    return d;
  }, [personId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Poll while an async provision run is in flight.
  React.useEffect(() => {
    if (wire?.status !== "provisioning") return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [wire?.status, load]);

  const act = async (path: string, body?: unknown) => {
    setBusy(path);
    setActionError(null);
    try {
      const r = await fetch(`/api/atelier/roster/people/${personId}/m365/${path}`, {
        method: path === "services" ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setActionError((d as { message?: string }).message ?? "Request failed.");
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const loadPlans = async () => {
    setPlansError(null);
    const r = await fetch(`/api/atelier/roster/people/${personId}/m365/plans`, { credentials: "include" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setPlansError((d as { message?: string }).message ?? "Could not load service plans.");
      setPlans(null);
      return;
    }
    setPlans((d as { plans: M365Plan[] }).plans);
  };

  const togglePlan = async (planId: string, enabled: boolean) => {
    if (!plans) return;
    const nextDisabled = plans.filter((p) => (p.servicePlanId === planId ? enabled : !p.enabled)).map((p) => p.servicePlanId);
    const ok = await act("services", { disabledPlans: nextDisabled });
    if (ok) await loadPlans();
  };

  if (!wire) return null;
  const statusTone =
    wire.status === "provisioned" || wire.status === "linked_existing"
      ? ""
      : wire.status === "blocked"
        ? "text-danger border-danger/40"
        : "text-warning border-warning/40";

  return (
    <Card className="p-4 space-y-3" data-testid="m365-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs font-mono uppercase text-text-mute">Microsoft 365</div>
        <MonoChip className={statusTone}>{M365_STATUS_LABEL[wire.status] ?? wire.status}</MonoChip>
      </div>
      <div className="text-sm text-text space-y-1">
        <div>
          <span className="text-text-mute">Account email: </span>
          {wire.email ?? wire.personEmail ?? "—"}
        </div>
        {wire.serviceProfile ? (
          <div className="text-xs text-text-mute">Service profile: {wire.serviceProfile}</div>
        ) : null}
        {wire.signInBlocked ? <div className="text-xs text-warning">Sign-in is blocked.</div> : null}
        {wire.status === "deprovisioned" ? (
          <div className="text-xs text-text-mute">
            Mailbox {wire.mailboxRetained ? "retained for handover" : "removed"} · license{" "}
            {wire.licenseFreed ? "freed" : "still assigned"}
          </div>
        ) : null}
        {wire.lastError ? (
          <div className="text-xs text-danger" data-testid="m365-last-error">
            {wire.lastError}
          </div>
        ) : null}
      </div>
      {actionError ? <div className="text-xs text-danger">{actionError}</div> : null}
      <div className="flex gap-3 flex-wrap items-center">
        {wire.status === "not_provisioned" || wire.status === "deprovisioned" ? (
          <>
            <label className="flex items-center gap-1 text-[10px] text-text-mute">
              Services:
              <select
                className="rounded border border-border bg-bg-elevate px-1 py-0.5 text-[10px] text-text"
                value={profileChoice}
                onChange={(e) => setProfileChoice(e.target.value as "" | "employee" | "contractor")}
                data-testid="m365-profile-select"
              >
                <option value="">Default ({wire.defaultProfile})</option>
                <option value="employee">Employee — full bundle</option>
                <option value="contractor">Contractor — email only</option>
              </select>
            </label>
            <button
              className="font-mono text-[10px] uppercase tracking-wider text-gold hover:underline disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void act("provision", { serviceProfile: profileChoice || wire.defaultProfile })}
              data-testid="m365-provision"
            >
              {busy === "provision" ? "Starting…" : "Create Microsoft account"}
            </button>
          </>
        ) : null}
        {wire.status !== "not_provisioned" && wire.status !== "provisioning" ? (
          <button
            className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void act("recheck")}
            data-testid="m365-recheck"
          >
            {busy === "recheck" ? "Re-checking…" : "Re-check"}
          </button>
        ) : null}
        {wire.skuId ? (
          <button
            className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-text"
            onClick={() => {
              setShowPlans((v) => !v);
              if (!showPlans) void loadPlans();
            }}
            data-testid="m365-toggle-plans"
          >
            {showPlans ? "Hide services" : "Services"}
          </button>
        ) : null}
      </div>
      {showPlans ? (
        <div className="space-y-1 border-t border-border-soft pt-2" data-testid="m365-plans">
          {plansError ? <div className="text-xs text-danger">{plansError}</div> : null}
          {!plans && !plansError ? <div className="text-xs text-text-mute">Loading services…</div> : null}
          {plans?.map((p) => (
            <label key={p.servicePlanId} className="flex items-center gap-2 text-xs text-text">
              <input
                type="checkbox"
                checked={p.enabled}
                disabled={busy !== null}
                onChange={() => void togglePlan(p.servicePlanId, p.enabled)}
                data-testid={`m365-plan-${p.servicePlanName}`}
              />
              {p.servicePlanName}
            </label>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function AccessTab({ personId }: { personId: string }) {
  // PRD §1 IA — Access tab shows engagements the person is on with role + scope chips.
  // Same data shape as /engagements endpoint, but rendered as a flatter access ledger.
  const [rows, setRows] = React.useState<EngagementGrant[] | null>(null);
  const [firmWide, setFirmWide] = React.useState(false);
  const [scopeNote, setScopeNote] = React.useState<string | null>(null);
  React.useEffect(() => {
    fetch(`/api/atelier/roster/people/${personId}/access`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => {
        setFirmWide(Boolean(d.firmWide));
        setScopeNote(d.scopeNote ?? null);
        setRows(d.grants ?? d.access ?? d.engagements ?? []);
      });
  }, [personId]);
  if (!rows) return <div className="text-text-mute">Loading…</div>;
  if (firmWide)
    return (
      <div className="space-y-4">
        <M365Card personId={personId} />
        <Card className="p-6" data-testid="access-firm-wide">
          <div className="text-gold font-mono text-sm">Full firm-wide access</div>
          <div className="text-text-mute text-xs mt-1">
            Founding Partners and Partners have access to all accounts,
            opportunities and engagements by role — no per-engagement grants
            apply.
          </div>
        </Card>
      </div>
    );
  if (rows.length === 0)
    return (
      <div className="space-y-4">
        <M365Card personId={personId} />
        <Card className="p-6 text-text-mute">
          {scopeNote ? (
            <div className="text-gold text-xs font-mono mb-2" data-testid="access-scope-note">{scopeNote}</div>
          ) : null}
          No engagement-access grants. Use the Roster admin (Partner-only) to grant access.
        </Card>
      </div>
    );
  return (
    <div className="space-y-2" data-testid="access-tab-rows">
      <M365Card personId={personId} />
      {scopeNote ? (
        <div className="text-gold text-xs font-mono" data-testid="access-scope-note">{scopeNote}</div>
      ) : null}
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
  // Task #531 — national ID cards carry a labeled back side.
  sides: "front_back" | "combined" | "front_only" | "none" | null;
  backDownloadUrl: string | null;
}

const SIDES_LABEL: Record<string, string> = {
  front_back: "front + back on file",
  combined: "combined PDF on file",
  front_only: "back side missing",
  none: "no scan on file",
};

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
              {d.sides ? (
                <span
                  className={d.sides === "front_only" ? "text-amber-400" : undefined}
                  data-testid={`doc-sides-${d.id}`}
                >
                  {" "}· {SIDES_LABEL[d.sides] ?? d.sides}
                </span>
              ) : null}
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
              {d.backDownloadUrl ? "Front ↓" : "Download ↓"}
            </a>
            {d.backDownloadUrl ? (
              <a
                href={d.backDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs uppercase text-accent hover:underline"
                data-testid={`doc-download-back-${d.id}`}
              >
                Back ↓
              </a>
            ) : null}
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
