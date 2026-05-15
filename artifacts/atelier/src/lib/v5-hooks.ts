/**
 * Atelier v5 — React Query hooks for the Postgres-backed Press, Alliances,
 * Studio, Guardhouse, and IP-catalog surfaces (Task #354).
 *
 * The hooks return plain arrays / objects (defaulted to empty) so the page
 * components can keep iterating directly without an extra null-guard. Cookies
 * are sent so the active persona on the API side resolves correctly.
 */
import { useQuery } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api/atelier`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Atelier API ${path} failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

function listHook<T>(key: string, path: string) {
  return function useList(): T[] {
    const q = useQuery<{ items: T[] }>({
      queryKey: ["atelier-v5", key],
      queryFn: () => get<{ items: T[] }>(path),
      staleTime: 30_000,
    });
    return q.data?.items ?? [];
  };
}

// ============================================================
// Press
// ============================================================
export interface EditorialCalendarRow {
  id: string;
  workingTitle: string;
  publication: string;
  byline: string;
  publishOn: string;
  status: string;
  thesis: string;
  themeId: string | null;
}
export const useEditorialCalendar = listHook<EditorialCalendarRow>(
  "press-editorial",
  "/press/editorial-calendar",
);

export interface InFlightRow {
  id: string;
  title: string;
  kind: string;
  byline: string;
  wordCount: number;
  sourceArtifact: string;
  phase: string;
  citationCoverage: number;
}
export const useInFlightContent = listHook<InFlightRow>(
  "press-inflight",
  "/press/in-flight",
);

export interface PartnerCadenceRow {
  id: string;
  partnerId: string;
  partnerName: string;
  voiceProfile: string;
  targetPer90d: number;
  postsThis90d: number;
  cadenceMet: boolean;
  queue: Array<{
    id: string;
    status: string;
    voiceMatchScore: number;
    draftBody: string;
  }>;
}
export const usePartnerCadence = listHook<PartnerCadenceRow>(
  "press-partner-cadence",
  "/press/partner-cadence",
);

export interface NewsletterRow {
  id: string;
  totalSubscribers: number;
  netGrowthLast90d: number;
  avgOpenRate: number;
  avgClickRate: number;
  currentIssue: {
    id: string;
    subjectLine: string;
    status: string;
    scheduledSendAt: string;
    sections: Array<{ id: string; label: string; summary: string }>;
  } | null;
}
export function useNewsletter(): NewsletterRow | null {
  const q = useQuery<{ newsletter: NewsletterRow | null }>({
    queryKey: ["atelier-v5", "press-newsletter"],
    queryFn: () => get<{ newsletter: NewsletterRow | null }>("/press/newsletter"),
    staleTime: 30_000,
  });
  return q.data?.newsletter ?? null;
}

export interface SpeakingOpportunityRow {
  id: string;
  event: string;
  kind: string;
  location: string;
  date: string;
  audience: string;
  ask: string;
  decision: string;
  owner: string;
}
export const useSpeakingOpportunities = listHook<SpeakingOpportunityRow>(
  "press-speaking",
  "/press/speaking-opportunities",
);

export interface PressMentionRow {
  id: string;
  headline: string;
  publication: string;
  date: string;
  about: string;
  summary: string;
  sentiment: string;
}
export const usePressMentions = listHook<PressMentionRow>(
  "press-mentions",
  "/press/mentions",
);

// ============================================================
// Alliances
// ============================================================
export interface AlliancePartnerFirmRow {
  id: string;
  name: string;
  kind: string;
  country: string;
  speciality: string;
  relationshipStrength: number;
  anchorAico: string;
  anchorPartner: string;
  lastTouchAt: string | null;
  openJointOpps: number;
  lifetimeJointRevenueMm: number;
  recentMoves: string[];
}
export const useAlliancePartnerFirms = listHook<AlliancePartnerFirmRow>(
  "alliance-firms",
  "/alliances/partner-firms",
);

export interface JointPipelineRow {
  id: string;
  opportunityName: string;
  client: string;
  partnerFirm: string;
  leadParty: string;
  stage: string;
  acvUsdK: number;
  aicoPct: number;
  partnerPct: number;
  splitRationale: string;
  allianceLetterStatus: string;
}
export const useJointPipeline = listHook<JointPipelineRow>(
  "alliance-pipeline",
  "/alliances/joint-pipeline",
);

export interface CertificationRow {
  id: string;
  credential: string;
  platform: string;
  holder: string;
  status: string;
  expiresAt: string;
}
export const useCertifications = listHook<CertificationRow>(
  "alliance-certs",
  "/alliances/certifications",
);

export interface AllianceConflictRow {
  id: string;
  headline: string;
  partnerFirm: string;
  detectedAt: string;
  severity: string;
  detail: string;
  recommendation: string;
}
export const useAllianceConflicts = listHook<AllianceConflictRow>(
  "alliance-conflicts",
  "/alliances/conflicts",
);

// ============================================================
// Partners lens — lifecycle scaffolds (Task #371)
// ============================================================
export interface PartnerTargetRow {
  id: string;
  name: string;
  ecosystem: string;
  country: string;
  rationale: string;
  priority: string;
  stage: string;
  lastContact: string | null;
}
export const usePartnerTargets = listHook<PartnerTargetRow>(
  "partners-targets",
  "/partners/target-partners",
);

export interface PartnerCapabilityRow {
  id: string;
  partnerFirm: string;
  capabilities: Record<string, number>;
  ndaStatus: string;
  mutualEvalStatus: string;
  lastReviewed: string;
}
export const usePartnerCapabilities = listHook<PartnerCapabilityRow>(
  "partners-capabilities",
  "/partners/capability-matrix",
);

export interface PartnerMdfRow {
  id: string;
  partnerFirm: string;
  program: string;
  periodEnds: string;
  allocatedUsdK: number;
  spentUsdK: number;
  status: string;
  focus: string;
}
export const usePartnerMdf = listHook<PartnerMdfRow>(
  "partners-mdf",
  "/partners/mdf",
);

export interface PartnerJointMarketingRow {
  id: string;
  title: string;
  kind: string;
  partnerFirm: string;
  date: string;
  status: string;
  expectedAttendees: number;
  leadOwner: string;
}
export const usePartnerJointMarketing = listHook<PartnerJointMarketingRow>(
  "partners-joint-marketing",
  "/partners/joint-marketing",
);

export interface PartnerSubcontractRow {
  id: string;
  engagement: string;
  partnerFirm: string;
  scope: string;
  sowStatus: string;
  rateCardLockedAt: string | null;
  monthlyBurnUsdK: number;
  acceptanceGate: string;
}
export const usePartnerSubcontracts = listHook<PartnerSubcontractRow>(
  "partners-subcontracts",
  "/partners/sub-contracts",
);

export interface PartnerFrameworkRow {
  id: string;
  partnerFirm: string;
  agreementKind: string;
  effectiveFrom: string;
  effectiveTo: string;
  governingLaw: string;
  exclusivities: string[];
  status: string;
}
export const usePartnerFrameworks = listHook<PartnerFrameworkRow>(
  "partners-frameworks",
  "/partners/framework-agreements",
);

export interface PartnerQbrRow {
  id: string;
  partnerFirm: string;
  periodLabel: string;
  scheduledFor: string;
  status: string;
  attendees: string[];
  decisions: string[];
  artefactsUrl: string | null;
}
export const usePartnerQbrs = listHook<PartnerQbrRow>(
  "partners-qbrs",
  "/partners/qbrs",
);

export interface PartnerScorecardRow {
  id: string;
  partnerFirm: string;
  periodLabel: string;
  revenueUsdK: number;
  satisfaction: number;
  complianceFlags: number;
  jointWinRate: number;
  deliveryQuality: number;
  trend: string;
}
export const usePartnerScorecards = listHook<PartnerScorecardRow>(
  "partners-scorecards",
  "/partners/scorecards",
);

export interface PartnerRenewalRow {
  id: string;
  partnerFirm: string;
  agreementKind: string;
  expiresAt: string;
  daysUntil: number;
  stage: string;
  owner: string;
  recommendation: string;
  risk: string;
}
export const usePartnerRenewals = listHook<PartnerRenewalRow>(
  "partners-renewals",
  "/partners/renewals",
);

export interface PartnerTierChangeRow {
  id: string;
  partnerFirm: string;
  platform: string;
  fromTier: string;
  toTier: string;
  effectiveAt: string;
  driver: string;
  action: string;
}
export const usePartnerTierChanges = listHook<PartnerTierChangeRow>(
  "partners-tier-changes",
  "/partners/tier-changes",
);

export interface PartnerOffboardingRow {
  id: string;
  partnerFirm: string;
  reason: string;
  initiatedAt: string;
  phase: string;
  openObligationsUsdK: number;
  dataReturnDue: string;
}
export const usePartnerOffboardings = listHook<PartnerOffboardingRow>(
  "partners-offboardings",
  "/partners/offboardings",
);

// ============================================================
// Studio
// ============================================================
export interface OpenRoleRow {
  id: string;
  title: string;
  level: string;
  location: string;
  targetStart: string;
  urgency: string;
  summary: string;
  activeCandidates: number;
  panelTemplate: string;
  scorecardId: string;
  takeHomeId: string | null;
}
export const useOpenRoles = listHook<OpenRoleRow>("studio-roles", "/studio/open-roles");

export interface CandidateRow {
  id: string;
  name: string;
  currentRole: string;
  currentEmployer: string;
  source: string;
  roleTitle: string;
  stage: string;
  activeOrPassive: string;
  roleMatchScore: number;
  outreachHook: string;
}
export const useCandidates = listHook<CandidateRow>(
  "studio-candidates",
  "/studio/candidates",
);

export interface InterviewPanelRow {
  id: string;
  candidateName: string;
  roleTitle: string;
  scheduledFor: string;
  status: string;
  stages: Array<{
    stage: string;
    interviewer: string;
    durationMin: number;
    focus: string;
    score: number | null;
  }>;
}
export const useInterviewPanels = listHook<InterviewPanelRow>(
  "studio-panels",
  "/studio/interview-panels",
);

export interface ReferenceCheckRow {
  id: string;
  candidateName: string;
  refererName: string;
  relationship: string;
  callMode: string;
  scheduledFor: string;
  completedAt: string | null;
  wouldRehire: string | null;
  fitForLevel: string | null;
  headlineQuote: string;
  inconsistencies: Array<{ claim: string; evidence: string }>;
}
export const useReferenceChecks = listHook<ReferenceCheckRow>(
  "studio-refs",
  "/studio/reference-checks",
);

export interface OfferRow {
  id: string;
  candidateName: string;
  roleTitle: string;
  jurisdiction: string;
  startDate: string;
  totalAtTargetUsdK: number;
  marketP25: number;
  marketP75: number;
  status: string;
  bandFlag: string | null;
}
export const useOffers = listHook<OfferRow>("studio-offers", "/studio/offers");

export interface ReferralRow {
  id: string;
  referrer: string;
  candidate: string;
  via: string;
  roleTitle: string;
  status: string;
}
export const useReferrals = listHook<ReferralRow>(
  "studio-referrals",
  "/studio/referrals",
);

// ============================================================
// Guardhouse
// ============================================================
export interface ControlRow {
  id: string;
  title: string;
  framework: string;
  owner: string;
  status: string;
  lastCollectedAt: string;
  remediation: string | null;
}
export const useGuardhouseControls = listHook<ControlRow>(
  "gh-controls",
  "/guardhouse/controls",
);

export interface EvidenceRow {
  id: string;
  title: string;
  kind: string;
  controlIds: string[];
  collectedAt: string;
  freshness: string;
}
export const useGuardhouseEvidence = listHook<EvidenceRow>(
  "gh-evidence",
  "/guardhouse/evidence",
);

export interface PentestRow {
  id: string;
  engagement: string;
  vendor: string;
  windowStart: string;
  windowEnd: string;
  findingsHigh: number;
  findingsMed: number;
  findingsLow: number;
  remediated: number;
  status: string;
}
export const useGuardhousePentests = listHook<PentestRow>(
  "gh-pentests",
  "/guardhouse/pentests",
);

export interface VendorRow {
  id: string;
  vendor: string;
  direction: string;
  dataClass: string;
  owner: string;
  risk: string;
  renewsAt: string;
}
export const useGuardhouseVendors = listHook<VendorRow>(
  "gh-vendors",
  "/guardhouse/vendors",
);

export interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  detectedAt: string;
  phase: string;
  summary: string;
  postmortemUrl: string | null;
}
export const useGuardhouseIncidents = listHook<IncidentRow>(
  "gh-incidents",
  "/guardhouse/incidents",
);

export interface DsarRow {
  id: string;
  subjectMasked: string;
  jurisdiction: string;
  requestKind: string;
  intakeAt: string;
  statutoryDueAt: string;
  daysToDeadline: number;
  phase: string;
  discoveredArtifacts: number;
}
export const useGuardhouseDsars = listHook<DsarRow>(
  "gh-dsars",
  "/guardhouse/dsars",
);

export interface BackupRow {
  id: string;
  store: string;
  kind: string;
  lastSuccessAt: string;
  status: string;
  rtoMinutes: number;
  rpoMinutes: number;
}
export const useGuardhouseBackups = listHook<BackupRow>(
  "gh-backups",
  "/guardhouse/backups",
);

// ============================================================
// IP catalog
// ============================================================
export interface CodeAssetRow {
  id: string;
  name: string;
  repoUrl: string;
  owner: string;
  license: string;
  summary: string;
  usedInEngagements: string[];
  freshness: string;
}
export const useCodeAssets = listHook<CodeAssetRow>("ip-code", "/ip/code-assets");

export interface OssDependencyRow {
  id: string;
  name: string;
  version: string;
  ecosystem: string;
  license: string;
  compatibility: string;
  repos: string[];
  rationale: string | null;
  exceptionUntil: string | null;
}
export const useOssDependencies = listHook<OssDependencyRow>(
  "ip-oss",
  "/ip/oss-dependencies",
);

export interface DemoEnvironmentRow {
  id: string;
  name: string;
  url: string;
  owner: string;
  lastDeployAt: string;
  shows: string;
  uptime30d: number;
  scriptDrift: number;
  freshness: string;
}
export const useDemoEnvironments = listHook<DemoEnvironmentRow>(
  "ip-demos",
  "/ip/demo-environments",
);

export interface IpLicenseGrantRow {
  id: string;
  assetName: string;
  grantee: string;
  engagementId: string;
  grantedAt: string;
  expiresAt: string;
  scope: string;
  approvedBy: string;
  status: string;
}
export const useIpLicenseGrants = listHook<IpLicenseGrantRow>(
  "ip-grants",
  "/ip/license-grants",
);
