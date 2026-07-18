/**
 * People Studio — list-shaped hooks for lifecycle modules that do not yet
 * have backing API endpoints.
 *
 * These previously carried fictional demo data (fake employees, invented
 * metrics). That data has been removed (Task #96): every hook now returns
 * an empty list so pages render honest "no data yet" states. When a real
 * Postgres-backed endpoint lands, swap the hook body for a
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
export const useLearningCatalogue = staticList<LearningCourse>([]);

export interface MyLearningRow {
  id: string;
  courseTitle: string;
  status: "enrolled" | "in-progress" | "completed";
  progressPct: number;
  dueDate: string | null;
  completedAt: string | null;
}
export const useMyLearning = staticList<MyLearningRow>([]);

export interface CertificationRow {
  id: string;
  personName: string;
  certName: string;
  issuer: string;
  issuedOn: string;
  expiresOn: string | null;
  status: "active" | "expiring" | "expired";
}
export const useCertifications = staticList<CertificationRow>([]);

export interface MentoringPair {
  id: string;
  mentor: string;
  mentee: string;
  cadence: "weekly" | "biweekly" | "monthly";
  startedOn: string;
  focus: string;
}
export const useMentoringPairs = staticList<MentoringPair>([]);

export interface SkillGapRow {
  id: string;
  skill: string;
  demandRoles: number;
  internalSupply: number;
  gap: number;
  topCandidates: string[];
}
export const useSkillGaps = staticList<SkillGapRow>([]);

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
export const useGoals = staticList<GoalRow>([]);

export interface CheckInRow {
  id: string;
  personName: string;
  managerName: string;
  scheduledFor: string;
  status: "scheduled" | "completed" | "missed";
  topicCount: number;
}
export const useCheckIns = staticList<CheckInRow>([]);

export interface ReviewRow {
  id: string;
  personName: string;
  cycle: string;
  managerRating: "exceeds" | "meets" | "developing" | null;
  selfRating: "exceeds" | "meets" | "developing" | null;
  status: "open" | "self-done" | "manager-done" | "calibrated";
  dueOn: string;
}
export const useReviews = staticList<ReviewRow>([]);

export interface CalibrationCohort {
  id: string;
  cohort: string;
  population: number;
  proposedExceeds: number;
  proposedMeets: number;
  proposedDeveloping: number;
  status: "draft" | "in-review" | "locked";
}
export const useCalibrationCohorts = staticList<CalibrationCohort>([]);

export interface SuccessionSlot {
  id: string;
  role: string;
  incumbent: string;
  readyNow: string[];
  readyOneYear: string[];
  readyTwoToThreeYears: string[];
  riskFlag: "low" | "medium" | "high";
}
export const useSuccession = staticList<SuccessionSlot>([]);

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
export const useCompBands = staticList<CompBand>([]);

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
export const useCompReview = staticList<CompReviewRow>([]);

export interface RecognitionRow {
  id: string;
  givenBy: string;
  givenTo: string;
  category: "client-impact" | "internal" | "values" | "ip-contribution";
  citation: string;
  awardedOn: string;
}
export const useRecognition = staticList<RecognitionRow>([]);

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
export const useEngagementSurveys = staticList<EngagementSurvey>([]);

export interface FlightRiskRow {
  id: string;
  personName: string;
  level: string;
  riskScore: number;
  signals: string[];
  lastConversation: string | null;
  ownerName: string;
}
export const useFlightRisk = staticList<FlightRiskRow>([]);

export interface InternalMobilityRow {
  id: string;
  personName: string;
  fromRole: string;
  toRole: string;
  status: "interested" | "in-conversation" | "approved" | "moved";
  proposedStart: string | null;
}
export const useInternalMobility = staticList<InternalMobilityRow>([]);

export interface StayInterview {
  id: string;
  personName: string;
  conductedBy: string;
  conductedOn: string;
  themes: string[];
  commitments: string[];
}
export const useStayInterviews = staticList<StayInterview>([]);

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
export const useOrgUnits = staticList<OrgUnit>([]);

export interface RoleDefinitionRow {
  id: string;
  title: string;
  level: string;
  competencies: string[];
  bandId: string;
  draft: boolean;
}
export const useRoleDefinitions = staticList<RoleDefinitionRow>([]);

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
export const usePeopleApprovals = staticList<PeopleApprovalRow>([]);

/**
 * Per-stage lifecycle stats — count + a single "next action" sentence for
 * the People home tiles and the lifecycle ribbon. There is no real data
 * behind these stages yet, so every count is zero and the next actions are
 * honest pointers to where records will be created.
 */
export interface StageStat {
  id: string;
  count: number;
  countLabel: string;
  nextAction: string;
  nextActionHref: string;
}

export function useStageStats(): Record<string, StageStat> {
  return useMemo(
    () => ({
      attract: {
        id: "attract", count: 0, countLabel: "open requisitions",
        nextAction: "No requisitions recorded yet",
        nextActionHref: "/people/attract/plan",
      },
      hire: {
        id: "hire", count: 0, countLabel: "live candidates",
        nextAction: "No candidates in pipeline yet",
        nextActionHref: "/people/hire/candidates",
      },
      onboard: {
        id: "onboard", count: 0, countLabel: "starting in 30 days",
        nextAction: "No upcoming starts recorded",
        nextActionHref: "/people/onboard/joiners",
      },
      develop: {
        id: "develop", count: 0, countLabel: "learning items in flight",
        nextAction: "Add training materials to the library",
        nextActionHref: "/people/develop/library",
      },
      perform: {
        id: "perform", count: 0, countLabel: "reviews still open",
        nextAction: "Draft reviews and goals under Releases",
        nextActionHref: "/people/perform/releases",
      },
      reward: {
        id: "reward", count: 0, countLabel: "comp changes pending",
        nextAction: "No comp changes recorded yet",
        nextActionHref: "/people/reward/review",
      },
      retain: {
        id: "retain", count: 0, countLabel: "people flagged flight-risk",
        nextAction: "No flight-risk records yet",
        nextActionHref: "/people/retain/flight-risk",
      },
      offboard: {
        id: "offboard", count: 0, countLabel: "in offboarding",
        nextAction: "No offboarding in progress",
        nextActionHref: "/people/offboard/knowledge",
      },
    }),
    [],
  );
}

// ============================================================
// Headcount & attrition history
//
// No monthly HR snapshots have been captured yet, so the history series
// are empty and the dashboard shows "no data yet" instead of a trend.
// ============================================================

export interface HeadcountSnapshot {
  /** Month-end snapshot key, ISO YYYY-MM. Sorted ascending. */
  month: string;
  /** Headcount at month-end. */
  active: number;
  joiners: number;
  leavers: number;
  /** Subset of leavers who left voluntarily (resignations). */
  voluntaryLeavers: number;
  /** Subset of voluntaryLeavers we actively wanted to retain. */
  regrettableLeavers: number;
}

export const useHeadcountHistory = staticList<HeadcountSnapshot>([]);
/**
 * Same underlying series, exposed under a name that makes its intent
 * (rolling attrition trend) explicit at the call site.
 */
export const useAttritionHistory = staticList<HeadcountSnapshot>([]);

/** Quarterly firm-wide eNPS history. No surveys have been run yet. */
export interface EnpsSnapshot {
  capturedOn: string;
  enpsScore: number;
  participants: number;
}
export const useEnpsHistory = staticList<EnpsSnapshot>([]);

// ============================================================
// Team Composition
//
// The composition dashboard reads demographic / language / skill fields
// that are captured operationally in the roster. No seeded people —
// panels render from real records only.
// ============================================================

export type CompositionGender = "female" | "male" | "non_binary" | "unspecified";
export type LangProficiency = "basic" | "working" | "fluent" | "native";
export type WorkerKind = "employee" | "contractor" | "partner_firm_resource";
export type SeniorityLevel =
  | "Analyst"
  | "Consultant"
  | "Senior Consultant"
  | "Manager"
  | "Senior Manager"
  | "Principal"
  | "Partner";

export interface CompositionPerson {
  id: string;
  fullName: string;
  workerType: WorkerKind;
  seniority: SeniorityLevel;
  businessUnit: string;
  location: string;            // City — country shorthand
  country: string;             // ISO-3166 alpha-2
  /** ISO-3166 alpha-2 nationality code, or `null` if not yet captured. */
  nationality: string | null;
  gender: CompositionGender;
  startDate: string;           // ISO date — used for tenure bands.
  managerId: string | null;    // For span-of-control.
  /** Atelier skill-graph language slugs with proficiency. */
  languages: { slug: string; label: string; proficiency: LangProficiency }[];
  /** Hard skills (tech / function / industry / tool) with proficiency 1–5. */
  hardSkills: { slug: string; label: string; proficiency: number }[];
  /** Soft skills (atelier_skills.kind = 'soft') the person is tagged with. */
  softSkills: string[];
  /** Manager rating from useReviews (null when not yet rated). */
  performanceRating: "exceeds" | "meets" | "developing" | null;
  /** Succession-readiness band, used as 9-box potential proxy. */
  potential: "ready_now" | "ready_1y" | "ready_2_3y" | "not_yet";
}

export const COMPOSITION_SOFT_SKILLS = [
  "Collaboration",
  "Leadership",
  "Communication",
  "Ownership",
  "Mentorship",
  "Conflict resolution",
  "Client presence",
  "Critical thinking",
] as const;

export const useCompositionPeople = staticList<CompositionPerson>([]);

/** Snapshot timestamp for the dashboard "as of" stamp. Module-scope so the
 *  whole page sees the same value within a session. */
export const COMPOSITION_AS_OF = new Date().toISOString().slice(0, 10);
