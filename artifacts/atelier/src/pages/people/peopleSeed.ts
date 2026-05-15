/**
 * People Studio — seed data for new lifecycle modules (Task #364).
 *
 * The Develop / Perform / Reward / Retain / Org / Approvals modules are
 * brand-new in this task and don't yet have backing API endpoints. We expose
 * them via tiny `useXxx()` list-shaped hooks so page components can stay
 * symmetric with the existing `v5-hooks` `listHook` pattern. When the real
 * Postgres-backed endpoints land, swap each hook body for a
 * `listHook<T>(key, path)` call without touching any page code.
 */

import { useMemo } from "react";

function staticList<T>(rows: readonly T[]) {
  return function useList(): T[] {
    // Return a stable reference; rows is module-scope so this is fine.
    return useMemo(() => [...rows], []);
  };
}

// ============================================================
// Develop
// ============================================================

export interface LearningCourse {
  id: string;
  title: string;
  provider: string;
  durationHours: number;
  format: "self-paced" | "cohort" | "in-person";
  skillTagIds: string[];
  level: "intro" | "core" | "advanced";
}
export const useLearningCatalogue = staticList<LearningCourse>([
  { id: "lc-001", title: "Pricing Intelligence Foundations", provider: "Atelier Academy", durationHours: 6,  format: "self-paced", skillTagIds: ["pricing", "analysis"], level: "core" },
  { id: "lc-002", title: "Reference Calling — Structured Interviews", provider: "Atelier Academy", durationHours: 3,  format: "cohort",     skillTagIds: ["interviewing"], level: "intro" },
  { id: "lc-003", title: "Partner Track — Practice Economics", provider: "Atelier Academy", durationHours: 12, format: "cohort",     skillTagIds: ["finance", "leadership"], level: "advanced" },
  { id: "lc-004", title: "AWS Solutions Architect (Associate)", provider: "AWS",            durationHours: 40, format: "self-paced", skillTagIds: ["cloud", "aws"], level: "core" },
  { id: "lc-005", title: "Generative AI Safety for Consultants",  provider: "Atelier Academy", durationHours: 4,  format: "in-person",  skillTagIds: ["ai", "ethics"], level: "core" },
]);

export interface MyLearningRow {
  id: string;
  courseTitle: string;
  status: "enrolled" | "in-progress" | "completed";
  progressPct: number;
  dueDate: string | null;
  completedAt: string | null;
}
export const useMyLearning = staticList<MyLearningRow>([
  { id: "ml-001", courseTitle: "Pricing Intelligence Foundations",   status: "in-progress", progressPct: 60, dueDate: "2026-06-15", completedAt: null },
  { id: "ml-002", courseTitle: "Reference Calling — Structured Interviews", status: "completed",   progressPct: 100, dueDate: null, completedAt: "2026-04-22" },
  { id: "ml-003", courseTitle: "Generative AI Safety for Consultants", status: "enrolled",    progressPct: 0,  dueDate: "2026-07-01", completedAt: null },
]);

export interface CertificationRow {
  id: string;
  personName: string;
  certName: string;
  issuer: string;
  issuedOn: string;
  expiresOn: string | null;
  status: "active" | "expiring" | "expired";
}
export const useCertifications = staticList<CertificationRow>([
  { id: "ct-001", personName: "Aliya N.",   certName: "AWS Solutions Architect — Pro", issuer: "AWS",       issuedOn: "2024-09-10", expiresOn: "2027-09-10", status: "active" },
  { id: "ct-002", personName: "Marcus L.",  certName: "PMP",                            issuer: "PMI",       issuedOn: "2022-03-05", expiresOn: "2026-06-05", status: "expiring" },
  { id: "ct-003", personName: "Tomás R.",   certName: "CFA Level III",                  issuer: "CFA",       issuedOn: "2023-08-19", expiresOn: null,        status: "active" },
  { id: "ct-004", personName: "Priya S.",   certName: "GCP Professional Data Engineer", issuer: "Google",    issuedOn: "2022-01-12", expiresOn: "2024-01-12", status: "expired" },
]);

export interface MentoringPair {
  id: string;
  mentor: string;
  mentee: string;
  cadence: "weekly" | "biweekly" | "monthly";
  startedOn: string;
  focus: string;
}
export const useMentoringPairs = staticList<MentoringPair>([
  { id: "mp-001", mentor: "Hala K.",   mentee: "Aliya N.", cadence: "biweekly", startedOn: "2026-01-15", focus: "Partner-track readiness" },
  { id: "mp-002", mentor: "Marcus L.", mentee: "Tomás R.", cadence: "monthly",  startedOn: "2025-10-01", focus: "Client-facing presence" },
  { id: "mp-003", mentor: "Sara P.",   mentee: "Priya S.", cadence: "weekly",   startedOn: "2026-03-04", focus: "Data-engineering ramp" },
]);

export interface SkillGapRow {
  id: string;
  skill: string;
  demandRoles: number;
  internalSupply: number;
  gap: number;
  topCandidates: string[];
}
export const useSkillGaps = staticList<SkillGapRow>([
  { id: "sg-001", skill: "Generative AI tooling", demandRoles: 8, internalSupply: 3, gap: 5, topCandidates: ["Aliya N.", "Tomás R."] },
  { id: "sg-002", skill: "FP&A modelling",        demandRoles: 5, internalSupply: 2, gap: 3, topCandidates: ["Marcus L."] },
  { id: "sg-003", skill: "Public-sector procurement", demandRoles: 4, internalSupply: 1, gap: 3, topCandidates: ["Hala K."] },
]);

// ============================================================
// Perform
// ============================================================

export interface GoalRow {
  id: string;
  personName: string;
  cycle: string;
  goal: string;
  weight: number;
  status: "on-track" | "at-risk" | "off-track" | "complete";
  evidenceCount: number;
}
export const useGoals = staticList<GoalRow>([
  { id: "g-001", personName: "Aliya N.",  cycle: "H1-2026", goal: "Lead 2 pricing engagements end-to-end",           weight: 0.4, status: "on-track", evidenceCount: 3 },
  { id: "g-002", personName: "Aliya N.",  cycle: "H1-2026", goal: "Reach AWS SA-Pro within the cycle",                weight: 0.2, status: "complete", evidenceCount: 1 },
  { id: "g-003", personName: "Marcus L.", cycle: "H1-2026", goal: "Convert 3 partner-firm referrals to paid pilots",  weight: 0.3, status: "at-risk",   evidenceCount: 1 },
  { id: "g-004", personName: "Tomás R.",  cycle: "H1-2026", goal: "Author 4 published research notes",                weight: 0.3, status: "on-track", evidenceCount: 2 },
]);

export interface CheckInRow {
  id: string;
  personName: string;
  managerName: string;
  scheduledFor: string;
  status: "scheduled" | "completed" | "missed";
  topicCount: number;
}
export const useCheckIns = staticList<CheckInRow>([
  { id: "ci-001", personName: "Aliya N.",  managerName: "Hala K.",   scheduledFor: "2026-05-20", status: "scheduled", topicCount: 4 },
  { id: "ci-002", personName: "Marcus L.", managerName: "Hala K.",   scheduledFor: "2026-05-22", status: "scheduled", topicCount: 3 },
  { id: "ci-003", personName: "Tomás R.",  managerName: "Sara P.",   scheduledFor: "2026-05-12", status: "completed", topicCount: 5 },
]);

export interface ReviewRow {
  id: string;
  personName: string;
  cycle: string;
  managerRating: "exceeds" | "meets" | "developing" | null;
  selfRating: "exceeds" | "meets" | "developing" | null;
  status: "open" | "self-done" | "manager-done" | "calibrated";
  dueOn: string;
}
export const useReviews = staticList<ReviewRow>([
  { id: "rv-001", personName: "Aliya N.",  cycle: "H1-2026", managerRating: "exceeds", selfRating: "meets",   status: "calibrated",  dueOn: "2026-06-30" },
  { id: "rv-002", personName: "Marcus L.", cycle: "H1-2026", managerRating: "meets",   selfRating: "meets",   status: "manager-done", dueOn: "2026-06-30" },
  { id: "rv-003", personName: "Tomás R.",  cycle: "H1-2026", managerRating: null,      selfRating: "meets",   status: "self-done",   dueOn: "2026-06-30" },
  { id: "rv-004", personName: "Priya S.",  cycle: "H1-2026", managerRating: null,      selfRating: null,      status: "open",        dueOn: "2026-06-30" },
]);

export interface CalibrationCohort {
  id: string;
  cohort: string;
  population: number;
  proposedExceeds: number;
  proposedMeets: number;
  proposedDeveloping: number;
  status: "draft" | "in-review" | "locked";
}
export const useCalibrationCohorts = staticList<CalibrationCohort>([
  { id: "cl-001", cohort: "Senior Manager · MENA",   population: 12, proposedExceeds: 3, proposedMeets: 8, proposedDeveloping: 1, status: "in-review" },
  { id: "cl-002", cohort: "Consultant · MENA",        population: 24, proposedExceeds: 5, proposedMeets: 17, proposedDeveloping: 2, status: "draft" },
  { id: "cl-003", cohort: "Partner",                  population: 6,  proposedExceeds: 1, proposedMeets: 5,  proposedDeveloping: 0, status: "locked" },
]);

export interface SuccessionSlot {
  id: string;
  role: string;
  incumbent: string;
  readyNow: string[];
  readyOneYear: string[];
  readyTwoToThreeYears: string[];
  riskFlag: "low" | "medium" | "high";
}
export const useSuccession = staticList<SuccessionSlot>([
  { id: "ss-001", role: "Practice Lead — Pricing", incumbent: "Hala K.",   readyNow: ["Aliya N."], readyOneYear: ["Marcus L."], readyTwoToThreeYears: ["Tomás R."], riskFlag: "low" },
  { id: "ss-002", role: "CFO",                     incumbent: "Sara P.",   readyNow: [],           readyOneYear: ["Marcus L."], readyTwoToThreeYears: [],           riskFlag: "high" },
  { id: "ss-003", role: "Head of Talent",          incumbent: "Yara H.",   readyNow: ["Priya S."], readyOneYear: [],            readyTwoToThreeYears: ["Aliya N."], riskFlag: "medium" },
]);

// ============================================================
// Reward
// ============================================================

export interface CompBand {
  id: string;
  level: string;
  jurisdiction: string;
  baseP25K: number;
  baseP50K: number;
  baseP75K: number;
  bonusTargetPct: number;
  carryEligible: boolean;
}
export const useCompBands = staticList<CompBand>([
  { id: "cb-001", level: "Consultant",       jurisdiction: "UAE",  baseP25K: 110, baseP50K: 130, baseP75K: 155, bonusTargetPct: 10, carryEligible: false },
  { id: "cb-002", level: "Senior Consultant", jurisdiction: "UAE", baseP25K: 150, baseP50K: 175, baseP75K: 205, bonusTargetPct: 15, carryEligible: false },
  { id: "cb-003", level: "Senior Manager",   jurisdiction: "UAE",  baseP25K: 215, baseP50K: 250, baseP75K: 290, bonusTargetPct: 25, carryEligible: false },
  { id: "cb-004", level: "Partner",          jurisdiction: "UAE",  baseP25K: 320, baseP50K: 380, baseP75K: 460, bonusTargetPct: 40, carryEligible: true  },
]);

export interface CompReviewRow {
  id: string;
  personName: string;
  currentBaseK: number;
  proposedBaseK: number;
  deltaPct: number;
  bandPosition: "below" | "p25-p50" | "p50-p75" | "above";
  rationale: string;
  status: "draft" | "submitted" | "approved";
}
export const useCompReview = staticList<CompReviewRow>([
  { id: "cr-001", personName: "Aliya N.",  currentBaseK: 165, proposedBaseK: 188, deltaPct: 13.9, bandPosition: "p50-p75", rationale: "Promotion to Senior Consultant; H1 review = exceeds.", status: "submitted" },
  { id: "cr-002", personName: "Marcus L.", currentBaseK: 240, proposedBaseK: 258, deltaPct: 7.5,  bandPosition: "p50-p75", rationale: "Standard merit; meets in calibration.",                  status: "draft" },
  { id: "cr-003", personName: "Tomás R.",  currentBaseK: 130, proposedBaseK: 142, deltaPct: 9.2,  bandPosition: "p25-p50", rationale: "Strong cycle on research output.",                       status: "draft" },
]);

export interface RecognitionRow {
  id: string;
  givenBy: string;
  givenTo: string;
  category: "client-impact" | "internal" | "values" | "ip-contribution";
  citation: string;
  awardedOn: string;
}
export const useRecognition = staticList<RecognitionRow>([
  { id: "rk-001", givenBy: "Hala K.",   givenTo: "Aliya N.",  category: "client-impact",  citation: "Saved the GCC bank pilot the night before SteerCo.",                awardedOn: "2026-04-12" },
  { id: "rk-002", givenBy: "Marcus L.", givenTo: "Tomás R.",  category: "ip-contribution", citation: "Authored the rate-card teardown that closed two pilots.",          awardedOn: "2026-03-29" },
  { id: "rk-003", givenBy: "Sara P.",   givenTo: "Priya S.",  category: "values",         citation: "Lived the 'evidence over assertion' principle in close.",            awardedOn: "2026-02-18" },
]);

// ============================================================
// Retain
// ============================================================

export interface EngagementSurvey {
  id: string;
  cohort: string;
  participants: number;
  enpsScore: number;
  topThemes: string[];
  capturedOn: string;
}
export const useEngagementSurveys = staticList<EngagementSurvey>([
  { id: "es-001", cohort: "Firm-wide",    participants: 38, enpsScore: 42, topThemes: ["Career clarity", "Project variety"], capturedOn: "2026-04-30" },
  { id: "es-002", cohort: "Consultants",  participants: 22, enpsScore: 51, topThemes: ["Mentorship", "Comp transparency"],   capturedOn: "2026-04-30" },
  { id: "es-003", cohort: "Senior Managers", participants: 9, enpsScore: 28, topThemes: ["Span of control", "Bench depth"],   capturedOn: "2026-04-30" },
]);

export interface FlightRiskRow {
  id: string;
  personName: string;
  level: string;
  riskScore: number;
  signals: string[];
  lastConversation: string | null;
  ownerName: string;
}
export const useFlightRisk = staticList<FlightRiskRow>([
  { id: "fr-001", personName: "Marcus L.", level: "Senior Manager", riskScore: 0.78, signals: ["No promotion in 24mo", "Below-band comp", "Declined two staffings"], lastConversation: "2026-04-15", ownerName: "Hala K." },
  { id: "fr-002", personName: "Tomás R.",  level: "Consultant",     riskScore: 0.62, signals: ["LinkedIn signal", "Skipped last 1:1"],                              lastConversation: null,         ownerName: "Sara P." },
  { id: "fr-003", personName: "Priya S.",  level: "Consultant",     riskScore: 0.41, signals: ["Long bench"],                                                       lastConversation: "2026-05-02", ownerName: "Yara H." },
]);

export interface InternalMobilityRow {
  id: string;
  personName: string;
  fromRole: string;
  toRole: string;
  status: "interested" | "in-conversation" | "approved" | "moved";
  proposedStart: string | null;
}
export const useInternalMobility = staticList<InternalMobilityRow>([
  { id: "im-001", personName: "Priya S.",  fromRole: "Consultant — Data",     toRole: "Consultant — AI Pricing", status: "in-conversation", proposedStart: "2026-07-01" },
  { id: "im-002", personName: "Tomás R.",  fromRole: "Consultant — Research", toRole: "Senior Consultant — Pricing", status: "approved",    proposedStart: "2026-06-15" },
  { id: "im-003", personName: "Aliya N.",  fromRole: "Senior Consultant",     toRole: "Manager — Pricing",       status: "interested",      proposedStart: null         },
]);

export interface StayInterview {
  id: string;
  personName: string;
  conductedBy: string;
  conductedOn: string;
  themes: string[];
  commitments: string[];
}
export const useStayInterviews = staticList<StayInterview>([
  { id: "si-001", personName: "Marcus L.", conductedBy: "Hala K.", conductedOn: "2026-05-08", themes: ["Promotion timing", "Carry visibility"], commitments: ["Carry deck by Jun-15", "Promo case opened"] },
  { id: "si-002", personName: "Tomás R.",  conductedBy: "Sara P.", conductedOn: "2026-04-29", themes: ["Mentor", "Project variety"],            commitments: ["New mentor pairing", "Move to AI staffing"] },
]);

// ============================================================
// Org & roles
// ============================================================

export interface OrgUnit {
  id: string;
  name: string;
  parentId: string | null;
  headName: string;
  headcount: number;
  openRoles: number;
}
export const useOrgUnits = staticList<OrgUnit>([
  { id: "ou-firm",     name: "AICo",            parentId: null,        headName: "Karim S.",  headcount: 38, openRoles: 6 },
  { id: "ou-pricing",  name: "Pricing practice", parentId: "ou-firm",   headName: "Hala K.",   headcount: 12, openRoles: 3 },
  { id: "ou-research", name: "Research",         parentId: "ou-firm",   headName: "Sara P.",   headcount: 6,  openRoles: 1 },
  { id: "ou-platform", name: "Platform & AI",    parentId: "ou-firm",   headName: "Marcus L.", headcount: 9,  openRoles: 2 },
  { id: "ou-ops",      name: "Operations",       parentId: "ou-firm",   headName: "Yara H.",   headcount: 11, openRoles: 0 },
]);

export interface RoleDefinitionRow {
  id: string;
  title: string;
  level: string;
  competencies: string[];
  bandId: string;
  draft: boolean;
}
export const useRoleDefinitions = staticList<RoleDefinitionRow>([
  { id: "rd-001", title: "Consultant — Pricing",        level: "Consultant",       competencies: ["pricing", "modelling", "client-presence"],          bandId: "cb-001", draft: false },
  { id: "rd-002", title: "Senior Consultant — Pricing", level: "Senior Consultant", competencies: ["pricing", "engagement-lead", "mentor"],            bandId: "cb-002", draft: false },
  { id: "rd-003", title: "Manager — Pricing",           level: "Senior Manager",   competencies: ["practice-build", "biz-dev", "team-lead"],           bandId: "cb-003", draft: true  },
  { id: "rd-004", title: "Partner — Practice",          level: "Partner",          competencies: ["origination", "carry-mgmt", "firm-leadership"],     bandId: "cb-004", draft: false },
]);

// ============================================================
// Approvals (people-shaped — see /people/approvals)
// ============================================================

export interface PeopleApprovalRow {
  id: string;
  kind: "promotion" | "comp-change" | "hire-offer" | "exit" | "leave" | "policy-exception";
  subject: string;
  requester: string;
  approver: string;
  submittedOn: string;
  status: "pending" | "approved" | "rejected";
  amount: string | null;
}
/**
 * Per-stage lifecycle stats — count + a single "next action" sentence for
 * the People home tiles and the lifecycle ribbon. Values are derived from
 * the seed data above plus a few sensible constants for stages whose
 * underlying signal lives in existing API endpoints we don't want to fan
 * out from the home page (Hire / Onboard / Offboard).
 */
export interface StageStat {
  id: string;
  count: number;
  countLabel: string;
  nextAction: string;
  nextActionHref: string;
}

export function useStageStats(): Record<string, StageStat> {
  const goals = useGoals();
  const reviews = useReviews();
  const calibration = useCalibrationCohorts();
  const compReview = useCompReview();
  const flightRisk = useFlightRisk();
  const myLearning = useMyLearning();
  const certifications = useCertifications();

  return useMemo(() => {
    const learningOpen = myLearning.filter((r) => r.status !== "completed").length;
    const certsExpiring = certifications.filter((c) => c.status === "expiring").length;
    const reviewsOpen = reviews.filter((r) => r.status === "open" || r.status === "self-done").length;
    const calibInReview = calibration.filter((c) => c.status === "in-review").length;
    const compPending = compReview.filter((r) => r.status === "submitted" || r.status === "draft").length;
    const flightRiskHigh = flightRisk.filter((r) => r.riskScore >= 0.5).length;
    const goalsAtRisk = goals.filter((g) => g.status === "at-risk" || g.status === "off-track").length;

    return {
      attract: {
        id: "attract", count: 4, countLabel: "open requisitions",
        nextAction: "Refresh Q3 workforce plan",
        nextActionHref: "/people/attract/plan",
      },
      hire: {
        id: "hire", count: 12, countLabel: "live candidates",
        nextAction: "3 candidates need reference calls scheduled",
        nextActionHref: "/people/hire/references",
      },
      onboard: {
        id: "onboard", count: 2, countLabel: "starting in 30 days",
        nextAction: "L. Tan — day-1 plan needs your review",
        nextActionHref: "/people/onboard/day-one",
      },
      develop: {
        id: "develop", count: learningOpen, countLabel: "learning items in flight",
        nextAction: certsExpiring > 0
          ? `${certsExpiring} certification${certsExpiring === 1 ? "" : "s"} expiring this quarter`
          : "Plan H2 cohort enrolment",
        nextActionHref: "/people/develop/certifications",
      },
      perform: {
        id: "perform", count: reviewsOpen, countLabel: "reviews still open",
        nextAction: calibInReview > 0
          ? `Calibration: ${calibInReview} cohort${calibInReview === 1 ? "" : "s"} in-review`
          : `${goalsAtRisk} goal${goalsAtRisk === 1 ? "" : "s"} marked at-risk`,
        nextActionHref: calibInReview > 0 ? "/people/perform/calibration" : "/people/perform/goals",
      },
      reward: {
        id: "reward", count: compPending, countLabel: "comp changes pending",
        nextAction: "Approve Aliya N. promotion comp",
        nextActionHref: "/people/reward/review",
      },
      retain: {
        id: "retain", count: flightRiskHigh, countLabel: "people flagged flight-risk",
        nextAction: "Schedule stay interview with Marcus L.",
        nextActionHref: "/people/retain/stay",
      },
      offboard: {
        id: "offboard", count: 1, countLabel: "in offboarding",
        nextAction: "Confirm knowledge-transfer owner",
        nextActionHref: "/people/offboard/knowledge",
      },
    };
  }, [goals, reviews, calibration, compReview, flightRisk, myLearning, certifications]);
}

export const usePeopleApprovals = staticList<PeopleApprovalRow>([
  { id: "pa-001", kind: "promotion",     subject: "Aliya N. → Senior Consultant", requester: "Hala K.",  approver: "Karim S.", submittedOn: "2026-05-10", status: "pending",  amount: null },
  { id: "pa-002", kind: "comp-change",   subject: "Marcus L. — band-mid merit",   requester: "Hala K.",  approver: "Sara P.",  submittedOn: "2026-05-09", status: "pending",  amount: "+7.5% base" },
  { id: "pa-003", kind: "hire-offer",    subject: "Offer · L. Tan — SC",          requester: "Yara H.",  approver: "Karim S.", submittedOn: "2026-05-07", status: "approved", amount: "$172K total" },
  { id: "pa-004", kind: "leave",         subject: "Priya S. — parental leave",    requester: "Priya S.", approver: "Yara H.",  submittedOn: "2026-05-05", status: "approved", amount: "12 weeks" },
  { id: "pa-005", kind: "policy-exception", subject: "Tomás R. — remote-from-PT", requester: "Sara P.",  approver: "Karim S.", submittedOn: "2026-05-03", status: "pending",  amount: "90 days" },
]);
