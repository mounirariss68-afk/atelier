import * as React from "react";
import { useRoute, Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";

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
}

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "engagements", label: "Engagements" },
  { id: "skills", label: "Skills" },
  { id: "timesheet", label: "Timesheet" },
  { id: "documents", label: "Documents" },
  { id: "audit", label: "Audit" },
];

export default function RosterPerson() {
  const [, params] = useRoute("/roster/people/:id");
  const [, paramsTab] = useRoute("/roster/people/:id/:tab");
  const personId = params?.id ?? paramsTab?.id;
  const activeTab = paramsTab?.tab ?? "profile";

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
        <Link href="/roster/people" className="text-text-mute hover:text-gold text-xs font-mono uppercase">
          ← The Roster
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
                ? `/roster/people/${personId}`
                : `/roster/people/${personId}/${t.id}`
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
          <ProfileTab person={person} viewerCanSeeComp={viewerCanSeeComp} />
        )}
        {activeTab === "engagements" && <EngagementsTab personId={personId} />}
        {activeTab === "skills" && <PlaceholderTab title="Skills & competencies" />}
        {activeTab === "timesheet" && <PlaceholderTab title="Timesheet summary" />}
        {activeTab === "documents" && <DocumentsTab personId={personId} />}
        {activeTab === "audit" && <AuditTab personId={personId} />}
      </div>
    </div>
  );
}

function ProfileTab({
  person,
  viewerCanSeeComp,
}: {
  person: Person;
  viewerCanSeeComp: boolean;
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
      <Card className="p-4 space-y-3 md:col-span-2">
        <h3 className="font-mono text-xs uppercase text-text-mute flex items-center gap-2">
          Compensation & banking
          {!viewerCanSeeComp && (
            <MonoChip className="text-warning border-warning/40">
              hidden — Partner / Operations only
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
                <Link href={`/engagements/${r.engagementId}`} className="hover:text-gold">
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
  fileUrl: string | null;
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
          <MonoChip>{d.kind}</MonoChip>
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
  if (!events) return <div className="text-text-mute">Loading…</div>;
  if (events.length === 0)
    return <Card className="p-6 text-text-mute">No audit events.</Card>;
  return (
    <div className="space-y-2">
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
