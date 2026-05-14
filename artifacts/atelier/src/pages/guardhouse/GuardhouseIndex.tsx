import { useRoute } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { ShieldCheck, FileSearch, AlertOctagon, Database, ScrollText, ClipboardList } from "lucide-react";
import {
  useGuardhouseControls,
  useGuardhouseEvidence,
  useGuardhousePentests,
  useGuardhouseVendors,
  useGuardhouseIncidents,
  useGuardhouseDsars,
  useGuardhouseBackups,
} from "@/lib/v5-hooks";

const SUB_ROUTES = [
  { id: "controls", label: "Control Library" },
  { id: "evidence", label: "Evidence" },
  { id: "pentest", label: "Pentest" },
  { id: "vendors", label: "Vendor Risk" },
  { id: "incidents", label: "Incidents" },
  { id: "dsar", label: "DSAR" },
  { id: "backups", label: "Backups" },
];

export default function GuardhouseIndex() {
  const [, params] = useRoute("/guardhouse/:section");
  const section = params?.section ?? "controls";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="The Guardhouse"
          headline="SOC2-ready posture, statutory DSAR clock, vendor & incident register"
          lede="Control library mapped to SOC2 Type II + ISO 27001 with Compliance Sentinel auto-collecting evidence. Incident Responder runs the playbook end-to-end; DSAR Concierge drives the response within KSA PDPL / UAE DIFC windows; Backup Auditor verifies restorability quarterly. Owned by the Compliance Officer persona."
        />
      </PageHero>
      <div className="container-atelier py-6">
        <TabNav>
          {SUB_ROUTES.map((r) => (
            <TabNavLink key={r.id} href={`/guardhouse/${r.id}`} active={section === r.id}>{r.label}</TabNavLink>
          ))}
        </TabNav>
        <div className="mt-8">
          {section === "controls" && <ControlsView />}
          {section === "evidence" && <EvidenceView />}
          {section === "pentest" && <PentestView />}
          {section === "vendors" && <VendorsView />}
          {section === "incidents" && <IncidentsView />}
          {section === "dsar" && <DsarView />}
          {section === "backups" && <BackupsView />}
        </div>
      </div>
    </div>
  );
}

function ControlsView() {
  const CONTROL_LIBRARY = useGuardhouseControls();
  const passing = CONTROL_LIBRARY.filter(c => c.status === "passing").length;
  const gap = CONTROL_LIBRARY.filter(c => c.status === "gap").length;
  const stale = CONTROL_LIBRARY.filter(c => c.status === "stale").length;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4"><div className="text-xs text-text-faint">Total controls</div><div className="text-2xl font-mono text-text mt-1">{CONTROL_LIBRARY.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-text-faint">Passing</div><div className="text-2xl font-mono text-green-400 mt-1">{passing}</div></Card>
        <Card className="p-4"><div className="text-xs text-text-faint">Gap</div><div className="text-2xl font-mono text-red-400 mt-1">{gap}</div></Card>
        <Card className="p-4"><div className="text-xs text-text-faint">Stale</div><div className="text-2xl font-mono text-amber-400 mt-1">{stale}</div></Card>
      </div>
      <p className="text-sm text-text-mute flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Mapped to SOC2 Type II + ISO 27001. Compliance Sentinel collects evidence on a daily cron and tags status.</p>
      <div className="space-y-2">
        {CONTROL_LIBRARY.map((c) => (
          <Card key={c.id} className="p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-sm"><span className="font-mono text-gold mr-2">{c.id}</span><span className="text-text">{c.title}</span></div>
                <div className="text-xs text-text-faint mt-1">owner: {c.owner} · {c.framework} · last collected {c.lastCollectedAt}</div>
                {c.remediation && <div className="text-xs text-amber-400 mt-1">→ {c.remediation}</div>}
              </div>
              <MonoChip tone={c.status === "passing" ? "green" : c.status === "gap" ? "red" : c.status === "stale" ? "amber" : "default"}>{c.status}</MonoChip>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EvidenceView() {
  const EVIDENCE_REGISTER = useGuardhouseEvidence();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2"><FileSearch className="w-4 h-4" />Auto-collected artifacts tied to controls. Stale evidence (over 30 days) downgrades the control automatically.</p>
      {EVIDENCE_REGISTER.map((e) => (
        <Card key={e.id} className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text">{e.title}</div>
              <div className="text-xs text-text-faint">{e.kind} · controls: {e.controlIds.join(", ")} · collected {e.collectedAt}</div>
            </div>
            <MonoChip tone={e.freshness === "fresh" ? "green" : e.freshness === "stale" ? "amber" : "red"}>{e.freshness}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function PentestView() {
  const PENTEST_REGISTER = useGuardhousePentests();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute">Pentest engagements + remediation tracker. Each finding has an owner and a SLA tied to severity.</p>
      {PENTEST_REGISTER.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{p.engagement}</div>
              <div className="text-xs text-text-faint mt-1">{p.vendor} · {p.windowStart} → {p.windowEnd}</div>
              <div className="text-sm text-text-mute mt-2">{p.findingsHigh}H · {p.findingsMed}M · {p.findingsLow}L · {p.remediated}/{p.findingsHigh + p.findingsMed + p.findingsLow} remediated</div>
            </div>
            <MonoChip tone={p.status === "complete" ? "green" : p.status === "remediating" ? "amber" : "default"}>{p.status}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function VendorsView() {
  const VENDOR_ASSESSMENTS = useGuardhouseVendors();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute">Inbound + outbound vendor security assessments. Each vendor has a renewal date and the contract owner.</p>
      {VENDOR_ASSESSMENTS.map((v) => (
        <Card key={v.id} className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text">{v.vendor}</div>
              <div className="text-xs text-text-faint">{v.direction} · {v.dataClass} · owner {v.owner} · renews {v.renewsAt}</div>
            </div>
            <MonoChip tone={v.risk === "low" ? "green" : v.risk === "medium" ? "amber" : "red"}>{v.risk} risk</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function IncidentsView() {
  const INCIDENT_REGISTER = useGuardhouseIncidents();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2"><AlertOctagon className="w-4 h-4" />Incident register with post-mortems. Incident Responder agent drives the playbook; chain-of-custody preserved on every action.</p>
      {INCIDENT_REGISTER.map((i) => (
        <Card key={i.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{i.title}</div>
              <div className="text-xs text-text-faint mt-1">{i.severity} · detected {i.detectedAt} · {i.phase}</div>
              <div className="text-sm text-text-mute mt-2">{i.summary}</div>
              {i.postmortemUrl && <div className="text-xs text-gold mt-1">post-mortem · {i.postmortemUrl}</div>}
            </div>
            <MonoChip tone={i.severity === "sev1" ? "red" : i.severity === "sev2" ? "amber" : "default"}>{i.severity}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function DsarView() {
  const DSAR_QUEUE = useGuardhouseDsars();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2"><ScrollText className="w-4 h-4" />Data subject access requests under KSA PDPL / UAE DIFC / GDPR. Statutory clock is real — DSAR Concierge flags any request risking the response window.</p>
      {DSAR_QUEUE.map((d) => (
        <Card key={d.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{d.subjectMasked}</div>
              <div className="text-xs text-text-faint mt-1">{d.jurisdiction} · {d.requestKind} · intake {d.intakeAt}</div>
              <div className="text-sm text-text-mute mt-2">phase: {d.phase} · {d.discoveredArtifacts} artifacts found</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <MonoChip tone={d.daysToDeadline <= 5 ? "red" : d.daysToDeadline <= 10 ? "amber" : "green"}>{d.daysToDeadline}d to deadline</MonoChip>
              <span className="text-xs text-text-faint">due {d.statutoryDueAt}</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function BackupsView() {
  const BACKUP_RUNS = useGuardhouseBackups();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2"><Database className="w-4 h-4" />Backup Auditor verifies completeness daily and runs a quarterly restore drill against a sampled artifact.</p>
      {BACKUP_RUNS.map((b) => (
        <Card key={b.id} className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text">{b.store}</div>
              <div className="text-xs text-text-faint">{b.kind} · last success {b.lastSuccessAt} · RTO {b.rtoMinutes}m / RPO {b.rpoMinutes}m</div>
            </div>
            <MonoChip tone={b.status === "ok" ? "green" : b.status === "warning" ? "amber" : "red"}>{b.status}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}
