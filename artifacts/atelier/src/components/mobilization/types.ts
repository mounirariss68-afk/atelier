/**
 * Shared mobilization types — used across TeamTab sub-modules and the
 * MyProjectAssignmentsCard on the Me overview.
 */

export interface StaffingRequirement {
  id: string;
  role: string;
  seniority: string;
  allocationPct: number;
  startDate: string;
  endDate: string;
  required: boolean;
  /** Only present for costing-viewers; undefined/null otherwise. */
  rateSource?: string | null;
  /** Only present for costing-viewers; undefined/null otherwise. */
  rateAmount?: number | null;
  /** Only present for costing-viewers; undefined/null otherwise. */
  rateCurrency?: string | null;
  availabilityStatus: string;
  status: string;
  notes: string | null;
}

export interface StaffingAssignment {
  id: string;
  requirementId: string | null;
  personId: string;
  userId: string | null;
  role: string;
  seniority: string;
  allocationPct: number;
  startDate: string;
  endDate: string;
  /** Only present for costing-viewers; undefined/null otherwise. */
  rateSource?: string | null;
  /** Only present for costing-viewers; undefined/null otherwise. */
  rateAmount?: number | null;
  /** Only present for costing-viewers; undefined/null otherwise. */
  rateCurrency?: string | null;
  availabilityStatus: string;
  state: "proposed" | "accepted" | "declined" | "replaced" | "ended";
  stateReason: string | null;
}

export interface MobilizationHandoff {
  id: string;
  kind: string;
  toUserId: string;
  status: string;
  notes: string | null;
}

export interface MobilizationEngagement {
  id: string;
  name: string;
  mobilizationStatus: string | null;
  startDate: string;
  plannedEndDate: string;
  /** atelier_users.id of the partner owner — used for canMobilize check. */
  partnerOwnerId: string | null;
  /** atelier_users.id of the engagement lead — used for canMobilize check. */
  engagementLeadId: string | null;
}

export interface MobilizationData {
  engagement: MobilizationEngagement;
  requirements: StaffingRequirement[];
  assignments: StaffingAssignment[];
  handoffs: MobilizationHandoff[];
}

/** Shape returned by GET /me/mobilization-assignments */
export interface MyAssignment {
  id: string;
  engagementId: string;
  engagementName: string;
  engagementStartDate: string;
  engagementEndDate: string;
  role: string;
  seniority: string;
  allocationPct: number;
  startDate: string;
  endDate: string;
  state: "proposed" | "accepted";
}
