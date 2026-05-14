// Seed data for the /guardhouse route (v5).

export const CONTROL_LIBRARY = [
  { id: "CC1.1", title: "Code of conduct exists, signed by every employee", framework: "SOC2", owner: "HR", status: "passing" as const, lastCollectedAt: "2026-05-12", remediation: null },
  { id: "CC2.1", title: "Information security policy reviewed annually", framework: "SOC2", owner: "Compliance Officer", status: "passing" as const, lastCollectedAt: "2026-05-01", remediation: null },
  { id: "CC6.1", title: "Logical access provisioning + deprovisioning controls", framework: "SOC2", owner: "Engineering", status: "passing" as const, lastCollectedAt: "2026-05-13", remediation: null },
  { id: "CC6.2", title: "Quarterly user access review", framework: "SOC2", owner: "Compliance Officer", status: "stale" as const, lastCollectedAt: "2026-04-08", remediation: "Q2 review due 2026-05-30" },
  { id: "CC6.6", title: "Encryption in transit + at rest enforced", framework: "SOC2", owner: "Engineering", status: "passing" as const, lastCollectedAt: "2026-05-13", remediation: null },
  { id: "CC7.2", title: "System monitoring + anomaly detection", framework: "SOC2", owner: "Engineering", status: "passing" as const, lastCollectedAt: "2026-05-13", remediation: null },
  { id: "CC7.3", title: "Incident response plan tested annually", framework: "SOC2", owner: "Compliance Officer", status: "gap" as const, lastCollectedAt: "2025-11-04", remediation: "Tabletop scheduled 2026-06-12" },
  { id: "CC8.1", title: "Change management approval workflow", framework: "SOC2", owner: "Engineering", status: "passing" as const, lastCollectedAt: "2026-05-13", remediation: null },
  { id: "A.5.1", title: "Information security policies (ISO)", framework: "ISO27001", owner: "Compliance Officer", status: "passing" as const, lastCollectedAt: "2026-05-01", remediation: null },
  { id: "A.8.2", title: "Asset classification + handling", framework: "ISO27001", owner: "Compliance Officer", status: "gap" as const, lastCollectedAt: "—", remediation: "Classification scheme drafted, rollout 2026-Q3" },
  { id: "A.12.3", title: "Backup integrity tested quarterly", framework: "ISO27001", owner: "Engineering", status: "passing" as const, lastCollectedAt: "2026-04-15", remediation: null },
  { id: "A.16.1", title: "Incident management procedures", framework: "ISO27001", owner: "Compliance Officer", status: "passing" as const, lastCollectedAt: "2026-05-09", remediation: null },
];

export const EVIDENCE_REGISTER = [
  { id: "ev_001", title: "Quarterly access review · 2026-Q1", kind: "access_review", controlIds: ["CC6.2"], collectedAt: "2026-04-08", freshness: "stale" as const },
  { id: "ev_002", title: "AWS CloudTrail logs · last 90d", kind: "audit_log", controlIds: ["CC6.1", "CC7.2"], collectedAt: "2026-05-13", freshness: "fresh" as const },
  { id: "ev_003", title: "Mandatory security training completion · 2026-Q2", kind: "training", controlIds: ["CC1.1"], collectedAt: "2026-05-10", freshness: "fresh" as const },
  { id: "ev_004", title: "Backup verification log · daily", kind: "backup_log", controlIds: ["A.12.3"], collectedAt: "2026-05-13", freshness: "fresh" as const },
  { id: "ev_005", title: "Pentest 2025-Q4 final report", kind: "pentest_report", controlIds: ["CC7.2"], collectedAt: "2025-12-15", freshness: "expired" as const },
  { id: "ev_006", title: "Encryption-at-rest config snapshot", kind: "config", controlIds: ["CC6.6"], collectedAt: "2026-05-13", freshness: "fresh" as const },
];

export const PENTEST_REGISTER = [
  { id: "pt_001", engagement: "Atelier portal · external pentest 2026-Q1", vendor: "Bishop Fox", windowStart: "2026-02-10", windowEnd: "2026-02-28", findingsHigh: 2, findingsMed: 6, findingsLow: 9, remediated: 14, status: "remediating" as const },
  { id: "pt_002", engagement: "API server + Comms Indexer 2025-Q4", vendor: "NCC Group", windowStart: "2025-10-12", windowEnd: "2025-11-02", findingsHigh: 1, findingsMed: 4, findingsLow: 11, remediated: 16, status: "complete" as const },
];

export const VENDOR_ASSESSMENTS = [
  { id: "vd_001", vendor: "Anthropic", direction: "outbound", dataClass: "Confidential (no PII)", owner: "Engineering", risk: "low" as const, renewsAt: "2026-09-30" },
  { id: "vd_002", vendor: "AWS (Bahrain region)", direction: "outbound", dataClass: "Confidential", owner: "Engineering", risk: "low" as const, renewsAt: "2026-12-31" },
  { id: "vd_003", vendor: "Linear", direction: "outbound", dataClass: "Internal", owner: "Operations", risk: "low" as const, renewsAt: "2026-08-12" },
  { id: "vd_004", vendor: "Notion", direction: "outbound", dataClass: "Internal", owner: "Operations", risk: "medium" as const, renewsAt: "2026-07-04" },
  { id: "vd_005", vendor: "Quanta Systems (partner firm)", direction: "inbound+outbound", dataClass: "Confidential (joint engagements)", owner: "Compliance Officer", risk: "medium" as const, renewsAt: "2027-01-15" },
];

export const INCIDENT_REGISTER = [
  { id: "in_001", title: "Anomalous Atelier login from new geo · auto-contained", severity: "sev3" as const, detectedAt: "2026-04-29 02:14", phase: "closed", summary: "Access Sentinel detected a successful login from Lagos, NG for a partner whose travel calendar showed Riyadh. Session revoked within 4 min; reset forced. Root cause: credential shared via WhatsApp screenshot during travel.", postmortemUrl: "/incidents/in_001/postmortem" },
  { id: "in_002", title: "Backup verification failure · object storage replica", severity: "sev2" as const, detectedAt: "2026-03-11 06:42", phase: "closed", summary: "Cross-region replica fell behind by 4h after a misconfigured retention policy. Restored within RPO; remediation: replication monitor added.", postmortemUrl: "/incidents/in_002/postmortem" },
  { id: "in_003", title: "Customer-reported data export anomaly", severity: "sev2" as const, detectedAt: "2026-05-08 10:22", phase: "eradicate", summary: "Engagement deliverable export included a row from a different engagement. Containment in progress; comms drafted, pending Partner sign-off.", postmortemUrl: null },
];

export const DSAR_QUEUE = [
  { id: "ds_001", subjectMasked: "subject_5b8…f12", jurisdiction: "KSA PDPL", requestKind: "access", intakeAt: "2026-05-08", statutoryDueAt: "2026-06-07", daysToDeadline: 24, phase: "discovery", discoveredArtifacts: 14 },
  { id: "ds_002", subjectMasked: "subject_a91…03c", jurisdiction: "UAE DIFC", requestKind: "delete", intakeAt: "2026-04-26", statutoryDueAt: "2026-05-26", daysToDeadline: 12, phase: "redact", discoveredArtifacts: 7 },
  { id: "ds_003", subjectMasked: "subject_1d4…7e9", jurisdiction: "GDPR", requestKind: "portability", intakeAt: "2026-04-19", statutoryDueAt: "2026-05-19", daysToDeadline: 5, phase: "respond", discoveredArtifacts: 21 },
];

export const BACKUP_RUNS = [
  { id: "bk_001", store: "Postgres · Atelier primary", kind: "postgres", lastSuccessAt: "2026-05-13 04:00", status: "ok" as const, rtoMinutes: 30, rpoMinutes: 5 },
  { id: "bk_002", store: "Postgres · Comms Indexer", kind: "postgres", lastSuccessAt: "2026-05-13 04:15", status: "ok" as const, rtoMinutes: 45, rpoMinutes: 5 },
  { id: "bk_003", store: "Object storage · engagement deliverables", kind: "object_storage", lastSuccessAt: "2026-05-13 03:30", status: "ok" as const, rtoMinutes: 60, rpoMinutes: 60 },
  { id: "bk_004", store: "Object storage · Atelier IP catalog", kind: "object_storage", lastSuccessAt: "2026-05-12 03:30", status: "warning" as const, rtoMinutes: 60, rpoMinutes: 60 },
  { id: "bk_005", store: "Code repos · GitHub mirror to S3", kind: "repo", lastSuccessAt: "2026-05-13 02:00", status: "ok" as const, rtoMinutes: 120, rpoMinutes: 1440 },
];
